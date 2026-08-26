#!/usr/bin/env node
/**
 * construir-base.js — corrida semanal de la base de búsqueda
 *
 * Corre en el mismo repo que generar-catalogos.js y reusa su conexión, sus
 * secrets y su limpiarCodigo. Lee los relojes Casio con stock desde Odoo,
 * analiza con visión SOLO las fotos nuevas o cambiadas, y escribe
 * catalogo.json con precio, ficha técnica y atributos visuales.
 *
 * Dos niveles de cache para no gastar de más:
 *   1. write_date de Odoo decide si vale la pena bajar la foto.
 *   2. hash de la foto decide si vale la pena analizarla.
 * Si solo cambió el precio, no se baja ni se analiza nada.
 */

const fs      = require('fs');
const crypto  = require('crypto');
const xmlrpc  = require('xmlrpc');

// ── Configuración: mismos nombres que generar-catalogos.js ───────────────────
const ODOO_URL      = process.env.ODOO_URL      || 'https://temponovo.odoo.com';
const ODOO_DB       = process.env.ODOO_DB       || 'cmcorpcl-temponovo-main-24490235';
const ODOO_USERNAME = process.env.ODOO_USERNAME;
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;
const API_KEY       = process.env.ANTHROPIC_API_KEY;

const FAMILIA  = process.env.FAMILIA || 'Relojes Casio';
const SALIDA   = process.env.SALIDA  || './catalogo.json';
const MODELO   = 'claude-sonnet-4-6';
const LOTE     = 6;   // fotos por llamada
const PARALELO = 3;   // llamadas simultáneas

if (!ODOO_USERNAME || !ODOO_PASSWORD) {
  console.error('❌ Faltan credenciales Odoo. Define ODOO_USERNAME y ODOO_PASSWORD.');
  process.exit(1);
}
if (!API_KEY) {
  console.error('❌ Falta ANTHROPIC_API_KEY.');
  process.exit(1);
}

// ── Odoo (idéntico al generador de catálogos) ────────────────────────────────
let _uid = null, _objectClient = null;

async function getUID() {
  if (_uid) return _uid;
  console.log('🔐 Autenticando con Odoo...');
  const commonClient = xmlrpc.createSecureClient({
    host: new URL(ODOO_URL).hostname, port: 443, path: '/xmlrpc/2/common'
  });
  return new Promise((resolve, reject) => {
    commonClient.methodCall('authenticate', [ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD, {}],
      (err, uid) => {
        if (err) return reject(err);
        _uid = uid;
        _objectClient = xmlrpc.createSecureClient({
          host: new URL(ODOO_URL).hostname, port: 443, path: '/xmlrpc/2/object'
        });
        console.log('✅ Odoo UID:', uid);
        resolve(uid);
      });
  });
}

async function odooCall(model, method, args) {
  const uid = await getUID();
  return new Promise((resolve, reject) => {
    _objectClient.methodCall('execute_kw', [ODOO_DB, uid, ODOO_PASSWORD, model, method, args],
      (err, res) => err ? reject(err) : resolve(res));
  });
}

// ── Helpers copiados del generador ───────────────────────────────────────────
function limpiarCodigo(code) {
  if (!code) return '';
  for (const p of ['CA-CA-','CA-','RL-','QQ-','CC-','ES-','PI-','LI-','CO-','CS-','ZI-']) {
    if (code.startsWith(p)) return code.slice(p.length);
  }
  return code;
}

function perteneceAFamilia(categoriaProducto, familia) {
  const cat = (categoriaProducto || '').trim();
  return cat === familia || cat.startsWith(familia + ' /');
}

const limpiarHTML = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
                                        .replace(/\s+/g, ' ').trim();

// ── Lectura de Odoo ──────────────────────────────────────────────────────────
async function fetchProductos() {
  console.log('📦 Obteniendo productos de Odoo...');
  const raw = await odooCall('product.product', 'search_read', [
    [], ['default_code','name','list_price','qty_available','virtual_available',
         'categ_id','product_tmpl_id','write_date']
  ]);
  const productos = raw
    .map(p => ({
      codigo:   limpiarCodigo(p.default_code || ''),
      raw_code: p.default_code || '',
      nombre:   p.name || '',
      precio:   Math.round(p.list_price || 0),
      stock:    p.qty_available || 0,
      incoming: Math.max(0, (p.virtual_available || 0) - (p.qty_available || 0)),
      categoria: p.categ_id ? p.categ_id[1].trim() : '',
      tmplId:   p.product_tmpl_id ? p.product_tmpl_id[0] : null,
      write_date: p.write_date || '',
    }))
    .filter(p => p.stock > 0 || p.incoming > 0)
    .filter(p => !/mal estado/i.test(p.nombre))
    .filter(p => p.codigo && perteneceAFamilia(p.categoria, FAMILIA));
  console.log(`✅ ${productos.length} productos de "${FAMILIA}" con stock`);
  return productos;
}

async function fetchCaracteristicas() {
  try {
    console.log('📋 Obteniendo fichas técnicas...');
    const raw = await odooCall('product.template', 'search_read', [
      [['description_ecommerce', '!=', false]], ['id', 'description_ecommerce']
    ]);
    const map = {};
    for (const t of raw) if (t.description_ecommerce) map[t.id] = limpiarHTML(t.description_ecommerce);
    console.log(`✅ ${Object.keys(map).length} fichas obtenidas`);
    return map;
  } catch (e) { console.log('  ⚠️  Sin fichas técnicas:', e.message); return {}; }
}

// image_256 en vez de image_512: cuatro veces más liviano y suficiente para
// distinguir color y material. Lotes chicos y backoff largo, porque Odoo corta
// las llamadas XML-RPC pesadas y antes se perdían en silencio.
const CAMPO_IMG  = process.env.CAMPO_IMG || 'image_256';
const BATCH_IMG  = Number(process.env.BATCH_IMG || 4);
const REINTENTOS = 5;
const espera = ms => new Promise(r => setTimeout(r, ms));

async function fetchImagenesEnLote(codes) {
  if (!codes.length) return {};
  const imgs = {}, fallidos = [];
  for (let i = 0; i < codes.length; i += BATCH_IMG) {
    const batch = codes.slice(i, i + BATCH_IMG);
    let ok = false, ultimoError = '';
    for (let intento = 1; intento <= REINTENTOS; intento++) {
      try {
        const raw = await odooCall('product.product', 'search_read', [
          [['default_code', 'in', batch]], ['default_code', CAMPO_IMG]
        ]);
        for (const p of raw) if (p[CAMPO_IMG]) imgs[p.default_code] = p[CAMPO_IMG];
        ok = true;
        break;
      } catch (e) {
        ultimoError = e.message || String(e);
        if (intento < REINTENTOS) await espera(1500 * Math.pow(2, intento - 1));
      }
    }
    if (!ok) { fallidos.push(...batch); console.log(`\n  ⚠️  ${batch.join(', ')} → ${ultimoError}`); }
    await espera(250);
    process.stdout.write(`\r  Fotos: ${Object.keys(imgs).length} bajadas de ${Math.min(i + BATCH_IMG, codes.length)} pedidas`);
  }
  console.log('');
  if (fallidos.length) console.log(`  ⚠️  ${fallidos.length} imágenes no se bajaron. Quedan pendientes para la próxima corrida.`);
  return imgs;
}

// ── Análisis visual ──────────────────────────────────────────────────────────
const INSTRUCCIONES = `Eres un vendedor de relojes describiendo el inventario para un buscador.

Mira CADA foto y describe lo que realmente ves, no lo que sugiere el código.

Devuelve SOLO un array JSON, un objeto por foto y en el mismo orden en que aparecen:
{"correa":"acero|resina|cuero|malla|tela|bicolor|","tono":"plateado|dorado|negro|azul|verde|rojo|rosa|blanco|beige|gris|marron|oro rosa|transparente|multicolor","caja":"color de la caja en una palabra","esfera":"color de la esfera en una palabra","estilo":"vestir|casual|deportivo|vintage|militar|urbano"}

Reglas:
- "tono" es el color dominante de la correa.
- Si la caja y la correa son de dos metales distintos (plata y oro), correa es "bicolor".
- "caja" va aparte del tono: caja dorada con correa de cuero café es correa "cuero", tono "marron", caja "dorado".
- Los despertadores y relojes murales no tienen correa: usa "" en correa.
Sin texto fuera del JSON.`;

async function analizarLote(lote) {
  const content = [];
  lote.forEach((p, i) => {
    content.push({ type: 'text', text: `Foto ${i + 1} — ${p.codigo}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: p.img } });
  });
  content.push({ type: 'text', text: INSTRUCCIONES });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODELO, max_tokens: 1500, messages: [{ role: 'user', content }] }),
  });
  if (!r.ok) throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const d = await r.json();
  const txt = d.content.filter(x => x.type === 'text').map(x => x.text).join('');
  const limpio = txt.replace(/```json|```/g, '').trim();
  const arr = JSON.parse(limpio.slice(limpio.search(/[[{]/)));
  if (!Array.isArray(arr) || arr.length !== lote.length) {
    throw new Error(`Se esperaban ${lote.length} fichas y llegaron ${arr.length}`);
  }
  return arr;
}

const hash = b64 => crypto.createHash('sha256').update(b64 || '').digest('hex').slice(0, 16);

// ── Corrida ──────────────────────────────────────────────────────────────────
async function main() {
  const previo = fs.existsSync(SALIDA)
    ? JSON.parse(fs.readFileSync(SALIDA, 'utf8')) : { productos: {} };
  const cache = previo.productos || {};

  const filas  = await fetchProductos();
  const fichas = await fetchCaracteristicas();

  const productos = {};
  const revisar = [];   // códigos cuya foto hay que bajar

  for (const f of filas) {
    const antes = cache[f.codigo];
    productos[f.codigo] = {
      codigo: f.codigo,
      nombre: f.nombre,
      categoria: f.categoria,
      precio: f.precio,
      disponible: f.stock > 0,
      spec: fichas[f.tmplId] || '',
      write_date: f.write_date,
      hash_foto: antes ? antes.hash_foto : null,
      atributos: antes ? antes.atributos : null,
    };
    // Nivel 1: solo bajamos la foto si nunca la vimos o si el producto se tocó.
    if (!antes || !antes.atributos || antes.write_date !== f.write_date) {
      revisar.push(f.raw_code);
    }
  }

  const total = Object.keys(productos).length;
  const yaListos = Object.values(productos).filter(p => p.atributos).length;
  console.log(`${total} productos · ${yaListos} ya tenían atributos · ${revisar.length} a revisar`);

  const porRaw = {};
  filas.forEach(f => porRaw[f.raw_code] = f.codigo);
  const imgs = await fetchImagenesEnLote(revisar);

  // Nivel 2: de los revisados, solo analizamos los que además cambiaron de foto.
  const pendientes = [];
  for (const [rawCode, img] of Object.entries(imgs)) {
    const codigo = porRaw[rawCode];
    const h = hash(img);
    if (productos[codigo].hash_foto === h && productos[codigo].atributos) {
      productos[codigo].hash_foto = h;
      continue;
    }
    productos[codigo].hash_foto = h;
    pendientes.push({ codigo, img });
  }
  console.log(`🖼️  ${pendientes.length} fotos nuevas o cambiadas por analizar`);

  const lotes = [];
  for (let i = 0; i < pendientes.length; i += LOTE) lotes.push(pendientes.slice(i, i + LOTE));

  let hechos = 0, fallidos = 0;
  const cola = [...lotes];
  async function worker() {
    while (cola.length) {
      const lote = cola.shift();
      try {
        const fichasVis = await analizarLote(lote);
        lote.forEach((p, i) => { productos[p.codigo].atributos = fichasVis[i]; });
      } catch (e) {
        fallidos += lote.length;
        lote.forEach(p => { productos[p.codigo].hash_foto = null; });  // reintentar la próxima
        console.error(`\n  ${lote.map(p => p.codigo).join(', ')} → ${e.message}`);
      }
      hechos += lote.length;
      process.stdout.write(`\r  Analizando: ${hechos}/${pendientes.length}`);
      if (hechos % 60 < LOTE) escribir(productos);
    }
  }
  await Promise.all(Array.from({ length: PARALELO }, worker));
  if (pendientes.length) console.log('');

  escribir(productos);
  const sin = Object.values(productos).filter(p => !p.atributos).length;
  console.log(`✅ ${SALIDA} · ${total} productos · ${sin} sin atributos` +
              (fallidos ? ` · ${fallidos} fallaron en el análisis` : ''));
  if (sin > total * 0.1) {
    console.log(`⚠️  Quedan ${sin} productos sin atributos (más del 10%). Vuelve a correr el workflow: retoma solo los que faltan.`);
  }
}

function escribir(productos) {
  fs.writeFileSync(SALIDA, JSON.stringify({
    generado: new Date().toISOString(), familia: FAMILIA, productos,
  }, null, 1));
}

main().catch(e => { console.error('\n❌ ' + (e.message || e)); process.exit(1); });
