// ══════════════════════════════════════════════════════════════════════════════
// TEMPONOVO — Generador de catálogos PDF → Dropbox
// Uso: DROPBOX_TOKEN=xxx node generar-catalogos.js
//      DROPBOX_TOKEN=xxx node generar-catalogos.js "Gshock"
// ══════════════════════════════════════════════════════════════════════════════

const PDFDocument = require('pdfkit');
const axios       = require('axios');
const https       = require('https');
const fs          = require('fs');
const path        = require('path');
const xmlrpc      = require('xmlrpc');

const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;
const DROPBOX_APP_KEY       = process.env.DROPBOX_APP_KEY;
const DROPBOX_APP_SECRET    = process.env.DROPBOX_APP_SECRET;
const DROPBOX_FOLDER        = '/Catalogos Temponovo';
let   _dropboxAccessToken   = null;
const CACHE_PATH     = path.join(__dirname, 'imagenes_cache.json');

const ODOO_URL      = 'https://temponovo.odoo.com';
const ODOO_DB       = 'cmcorpcl-temponovo-main-24490235';
const ODOO_USERNAME = 'natalia@temponovo.cl';
const ODOO_PASSWORD = 'Contraodoo94+';

const HEADER_PATH = path.join(__dirname, 'header.png');
const HEADER_IMG  = fs.existsSync(HEADER_PATH) ? fs.readFileSync(HEADER_PATH) : null;

if (!DROPBOX_REFRESH_TOKEN || !DROPBOX_APP_KEY || !DROPBOX_APP_SECRET) {
  console.error('❌ Faltan variables: DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY, DROPBOX_APP_SECRET');
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════════════════════
// MAPA DE CATÁLOGOS
// ══════════════════════════════════════════════════════════════════════════════
const CATALOGOS = [
  {
    archivo: 'Catalogo_Relojes _Casio _Completo.pdf',
    categorias: ['Relojes Casio / Clasico','Relojes Casio / Despertadores','Relojes Casio / Edifice','Relojes Casio / G-Shock','Relojes Casio / Murales y Crono','Relojes Casio / Protex'],
    orden: 'categoria',
  },
  {
    archivo: 'Catalogo_Relojes_Casio_Clasico_A-L.pdf',
    categorias: ['Relojes Casio / Clasico'],
    orden: 'alfabetico',
    filtro: p => limpiarCodigo(p.Default_code).toUpperCase() < 'M',
  },
  {
    archivo: 'Catalogo_Relojes_Casio_Clasico_M_W.pdf',
    categorias: ['Relojes Casio / Clasico'],
    orden: 'alfabetico',
    filtro: p => limpiarCodigo(p.Default_code).toUpperCase() >= 'M',
  },
  { archivo: 'Catalogo_Relojes_Casio_Despertadores.pdf', categorias: ['Relojes Casio / Despertadores'], orden: 'categoria' },
  { archivo: 'Catalogo_Relojes_Casio_EdificeyDuro.pdf', categorias: ['Relojes Casio / Edifice','Relojes Casio / G-Shock'], orden: 'categoria' },
  { archivo: 'Catalogo_Relojes_Casio_Gshock.pdf', categorias: ['Relojes Casio / G-Shock'], orden: 'categoria' },
  { archivo: 'Catalogo_Relojes_Casio_Murales y Crono.pdf', categorias: ['Relojes Casio / Murales y Crono'], orden: 'categoria' },
  { archivo: 'Catalogo_Relojes_Casio_Protreck.pdf', categorias: ['Relojes Casio / Protex'], orden: 'categoria' },
  {
    archivo: 'Catalogo_Relojes_QQ_Alfabeto.pdf',
    categorias: ['Relojes QQ / Cronografos','Relojes QQ / Dama Cuero','Relojes QQ / Dama Digital','Relojes QQ / Dama Metal','Relojes QQ / Dama Resina','Relojes QQ / Niño','Relojes QQ / Smart Watch','Relojes QQ / Varon Cuero','Relojes QQ / Varon Digital','Relojes QQ / Varon Metal','Relojes QQ / Varon Resina'],
    orden: 'alfabetico',
  },
  {
    archivo: 'Catalogo_Relojes_QQ Familia.pdf',
    categorias: ['Relojes QQ / Cronografos','Relojes QQ / Dama Cuero','Relojes QQ / Dama Digital','Relojes QQ / Dama Metal','Relojes QQ / Dama Resina','Relojes QQ / Niño','Relojes QQ / Smart Watch','Relojes QQ / Varon Cuero','Relojes QQ / Varon Digital','Relojes QQ / Varon Metal','Relojes QQ / Varon Resina'],
    orden: 'categoria',
  },
  { archivo: 'Catalogo Relojes Guess.pdf', categorias: ['Relojes Guess / Dama','Relojes Guess / Varon'], orden: 'categoria' },
  { archivo: 'Catalogo_Relojes_Suizos.pdf', categorias: ['Relojes Suizo / Dama','Relojes Suizo / Varon'], orden: 'categoria' },
  { archivo: 'Catalogo_RelojesEconomicos.pdf', categorias: ['Relojes Económicos / Despertadores','Relojes Económicos / Modulos','Relojes Económicos / Murales'], orden: 'categoria' },
  { archivo: 'Catalogo_Relojes_Timesonic.pdf', categorias: ['Relojes Murales / Relojes Timesonic'], orden: 'categoria' },
  { archivo: 'Catalogo_Calculadoras_Casio.pdf', categorias: ['Calculadoras Casio / Cientifica','Calculadoras Casio / Escritorio','Calculadoras Casio / Financieras y graficas','Calculadoras Casio / Portatiles','Calculadoras Casio / Rollo','Calculadoras Casio / Suplementos'], orden: 'categoria' },
  { archivo: 'Catalogo_Calculadoras_Economicas.pdf', categorias: ['Calculadoras Económicas / Calculadora Bolsillo','Calculadoras Económicas / Calculadora Cientifica','Calculadoras Económicas / Calculadora Doble Visor','Calculadoras Económicas / Calculadora Escritorio'], orden: 'categoria' },
  { archivo: 'Catalogo_Correas de Cuero.pdf', categorias: ['Correas / Correas para Reloj de Cuero'], orden: 'categoria' },
  { archivo: 'Catalogo_Correas PU.pdf', categorias: ['Correas / Correas para Reloj PU'], orden: 'categoria' },
  { archivo: 'Catalogo_Estuches_Joyas.pdf', categorias: ['Estuches / Capricho','Estuches / Creta','Estuches / Madera','Estuches / Marina','Estuches / Milos','Estuches / Nature','Estuches / Roma','Estuches / Targa','Estuches / Termal','Estuches / Yuppie','Estuches / Zante'], orden: 'categoria' },
  { archivo: 'Catalogo_LimpiezaJoyas.pdf', categorias: ['Limpieza / Limpieza Connoisseurs'], orden: 'categoria' },
  { archivo: 'Catalogo_Pilas_De_Reloj.pdf', categorias: ['Pilas / Alcalinas','Pilas / Litio','Pilas / Oxido de Plata','Pilas / Zinc'], orden: 'categoria' },
  { archivo: 'Catalogo_Encendedores_Zippo.pdf', categorias: ['Encendedores / Encendedores Zippo'], orden: 'alfabetico' },
  { archivo: 'Catalogo_Encendedores_Zippo_Familia.pdf', categorias: ['Encendedores / Encendedores Zippo'], orden: 'categoria' },
];

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function limpiarCodigo(code) {
  if (!code) return '';
  for (const p of ['RL-','QQ-','CC-','ES-','PI-','LI-','CO-','CS-']) {
    if (code.startsWith(p)) return code.slice(p.length);
  }
  return code;
}

function ordenarProductos(productos, orden) {
  return [...productos].sort((a, b) => {
    if (orden === 'alfabetico')
      return limpiarCodigo(a.Default_code).localeCompare(limpiarCodigo(b.Default_code), 'es');
    const catA = (a.Category||'').trim();
    const catB = (b.Category||'').trim();
    if (catA !== catB) return catA.localeCompare(catB, 'es');
    return limpiarCodigo(a.Default_code).localeCompare(limpiarCodigo(b.Default_code), 'es');
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// ODOO
// ══════════════════════════════════════════════════════════════════════════════
let _uid = null;
let _objectClient = null;

async function getUID() {
  if (_uid) return _uid;
  console.log('🔐 Autenticando con Odoo...');
  const commonClient = xmlrpc.createSecureClient({
    host: new URL(ODOO_URL).hostname, port: 443, path: '/xmlrpc/2/common'
  });
  return new Promise((resolve, reject) => {
    commonClient.methodCall('authenticate',
      [ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD, {}],
      (err, uid) => {
        if (err) return reject(err);
        _uid = uid;
        _objectClient = xmlrpc.createSecureClient({
          host: new URL(ODOO_URL).hostname, port: 443, path: '/xmlrpc/2/object'
        });
        console.log('✅ Odoo UID:', uid);
        resolve(uid);
      }
    );
  });
}

async function odooCall(model, method, args) {
  const uid = await getUID();
  return new Promise((resolve, reject) => {
    _objectClient.methodCall('execute_kw',
      [ODOO_DB, uid, ODOO_PASSWORD, model, method, args],
      (err, res) => err ? reject(err) : resolve(res)
    );
  });
}

// Solo stock y precio — rápido
async function fetchProductos() {
  console.log('📦 Obteniendo productos de Odoo...');
  const raw = await odooCall('product.product', 'search_read', [
    [], ['default_code','name','list_price','qty_available','virtual_available','categ_id']
  ]);
  const productos = raw
    .map(p => ({
      Default_code: p.default_code || '',
      Name:         p.name || '',
      Price:        p.list_price || 0,
      Stock:        p.qty_available || 0,
      Incoming:     Math.max(0, (p.virtual_available||0) - (p.qty_available||0)),
      Category:     p.categ_id ? p.categ_id[1].trim() : '',
    }))
    // Solo productos con stock > 0 o incoming > 0
    .filter(p => p.Stock > 0 || p.Incoming > 0);
  console.log(`✅ ${productos.length} productos con stock`);
  return productos;
}

async function fetchCaracteristicas() {
  try {
    return await new Promise((resolve, reject) => {
      https.get('https://temponovo-api.onrender.com/api/caracteristicas', res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
      }).on('error', reject);
    });
  } catch(e) { console.log('  ⚠️  Sin características'); return {}; }
}

// Descarga imágenes en lote desde Odoo — solo los códigos que se pidan
async function fetchImagenesEnLote(codes) {
  if (!codes.length) return {};
  const BATCH = 10;
  const imgs  = {};
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    const raw = await odooCall('product.product', 'search_read', [
      [['default_code', 'in', batch]], ['default_code', 'image_512']
    ]);
    for (const p of raw) {
      if (p.image_512) imgs[p.default_code] = p.image_512;
    }
    process.stdout.write(`\r  📸 ${Math.min(i+BATCH, codes.length)}/${codes.length}`);
  }
  console.log('');
  return imgs;
}

// ══════════════════════════════════════════════════════════════════════════════
// CACHE DE IMÁGENES (archivo local imagenes_cache.json)
// ══════════════════════════════════════════════════════════════════════════════
function cargarCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
      console.log(`📂 Cache cargado: ${Object.keys(cache).length} imágenes`);
      return cache;
    }
  } catch(e) {}
  console.log('📂 Cache vacío — primera ejecución');
  return {};
}

function guardarCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
  console.log(`💾 Cache guardado: ${Object.keys(cache).length} imágenes`);
}

// ══════════════════════════════════════════════════════════════════════════════
// GENERADOR PDF
// ══════════════════════════════════════════════════════════════════════════════
async function generarPDF(nombreArchivo, productos, orden, caracteristicas, imgs) {
  const MM     = 2.8346;
  const PAGE_W = 210 * MM;
  const PAGE_H = 297 * MM;
  const mg     = 4   * MM;
  const headerH  = (210 * (200/1866)) * MM;
  const footerH  = 10  * MM;
  const COLS     = 4;
  const ROWS     = 4;
  const PER_PG   = 16;
  const cellW    = (PAGE_W - mg*2) / COLS;
  const cellH    = 58  * MM;
  const imgAreaH = 42  * MM;
  const totalH   = ROWS * cellH;
  const available = PAGE_H - mg*2 - headerH - footerH;
  const vOffset  = (available - totalH) / 2;
  const hasIncoming = productos.some(p => p.Incoming > 0 && p.Stock === 0);

  const doc    = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
  const chunks = [];
  doc.on('data', c => chunks.push(c));

  const fecha = new Date().toLocaleDateString('es-CL', {day:'2-digit',month:'2-digit',year:'numeric'});
  const hora  = new Date().toLocaleTimeString('es-CL', {hour:'2-digit',minute:'2-digit'});

  function drawHeader() {
    doc.addPage();
    const hdrTop = 3 * MM;
    if (HEADER_IMG) {
      try { doc.image(HEADER_IMG, 0, hdrTop, { width: PAGE_W, height: headerH }); }
      catch(e) { doc.fontSize(10).fillColor('#2c7873').font('Helvetica-Bold').text('TEMPONOVO', mg, hdrTop+8); }
    }
    doc.moveTo(0, hdrTop+headerH).lineTo(PAGE_W, hdrTop+headerH)
      .strokeColor('#cccccc').lineWidth(0.5*MM).stroke();
  }

  function drawFooter() {
    const fy = PAGE_H - mg - footerH;
    doc.moveTo(mg, fy).lineTo(PAGE_W-mg, fy)
      .strokeColor('#cccccc').lineWidth(0.15*MM).stroke();
    doc.fontSize(8).fillColor('#888888').font('Helvetica')
      .text(`Precios sin IVA  ·  ${fecha}  ${hora}  |  TEMPONOVO`,
        mg, fy+1.5*MM, { width: PAGE_W-mg*2, align: 'center' });
    if (hasIncoming) {
      doc.fontSize(7.5).fillColor('#888888').font('Helvetica-Oblique')
        .text('* Productos no disponibles para despacho inmediato',
          mg, fy+5.5*MM, { width: PAGE_W-mg*2, align: 'center' });
    }
  }

  let pageIdx    = 0;
  let currentCat = null;

  for (const p of productos) {
    const cat      = (p.Category||'').trim();
    const subcat   = cat.includes('/') ? cat.split('/')[1].trim() : cat;
    const prevSub  = currentCat?.includes('/') ? currentCat.split('/')[1].trim() : currentCat;
    const catChanged = orden === 'categoria' && currentCat !== null && subcat !== prevSub;

    if (pageIdx === 0 || pageIdx >= PER_PG || catChanged) {
      if (pageIdx > 0) drawFooter();
      drawHeader();
      pageIdx = 0;
    }
    currentCat = cat;

    const col = pageIdx % COLS;
    const row = Math.floor(pageIdx / COLS);
    const x   = mg + col * cellW;
    const y   = 3*MM + headerH + vOffset + row * cellH;

    doc.rect(x, y, cellW, cellH).fill('#ffffff');

    const b64 = imgs[p.Default_code];
    if (b64) {
      try {
        doc.rect(x, y, cellW, imgAreaH).fill('#ffffff');
        doc.image(Buffer.from(b64, 'base64'), x+1*MM, y+1*MM, {
          fit: [cellW-2*MM, imgAreaH-2*MM],
          align: 'center', valign: 'center'
        });
      } catch(e) { doc.rect(x, y, cellW, imgAreaH).fill('#f5f5f5'); }
    } else {
      doc.rect(x, y, cellW, imgAreaH).fill('#f5f5f5');
    }

    const conStar = p.Incoming > 0 && p.Stock === 0;
    const codigo  = limpiarCodigo(p.Default_code) || '';
    const infoY   = y + imgAreaH + 1.5*MM;

    doc.fontSize(9).fillColor('#000000').font('Helvetica-Bold')
      .text(codigo + (conStar ? ' *' : ''), x, infoY,
        { width: cellW, align: 'center', lineBreak: false });

    doc.fontSize(8.5).fillColor('#000000').font('Helvetica')
      .text(`$${Math.round(p.Price||0).toLocaleString('es-CL')} + IVA`,
        x, infoY+3.5*MM, { width: cellW, align: 'center', lineBreak: false });

    const caract = caracteristicas[p.Default_code];
    if (caract) {
      const specs = [
        caract.genero, caract.tamano_esfera, caract.resistencia_agua,
        caract.tamano_calculadora,
        caract.digitos ? `${caract.digitos} Dígitos` : '',
        caract.tamano_otro, caract.color
      ].filter(Boolean);
      if (specs.length) {
        doc.fontSize(8).fillColor('#787878').font('Helvetica')
          .text(specs.join(' · '), x, infoY+7*MM,
            { width: cellW, align: 'center', lineBreak: false });
      }
    }

    pageIdx++;
  }

  if (pageIdx > 0) drawFooter();
  doc.end();
  return new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));
}

// ══════════════════════════════════════════════════════════════════════════════
// DROPBOX
// ══════════════════════════════════════════════════════════════════════════════
async function getDropboxToken() {
  if (_dropboxAccessToken) return _dropboxAccessToken;
  const res = await axios.post('https://api.dropbox.com/oauth2/token',
    `grant_type=refresh_token&refresh_token=${DROPBOX_REFRESH_TOKEN}&client_id=${DROPBOX_APP_KEY}&client_secret=${DROPBOX_APP_SECRET}`,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  _dropboxAccessToken = res.data.access_token;
  console.log('✅ Dropbox token renovado');
  return _dropboxAccessToken;
}

async function subirADropbox(buffer, nombreArchivo) {
  const token = await getDropboxToken();
  const res = await axios.post(
    'https://content.dropboxapi.com/2/files/upload', buffer,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({
          path: `${DROPBOX_FOLDER}/${nombreArchivo}`,
          mode: 'overwrite', autorename: false, mute: true
        }),
        'Content-Type': 'application/octet-stream'
      },
      maxBodyLength: Infinity
    }
  );
  return res.data;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  const filtroArg = process.argv[2];

  // 1. Obtener stock y características en paralelo
  console.log('📦 Obteniendo datos de Odoo...');
  const [todos, caracteristicas] = await Promise.all([
    fetchProductos(),
    fetchCaracteristicas()
  ]);
  console.log(`✅ ${todos.length} productos con stock | ${Object.keys(caracteristicas).length} con características\n`);

  // 2. Determinar qué catálogos generar
  const catalogos = filtroArg
    ? CATALOGOS.filter(c => c.archivo.toLowerCase().includes(filtroArg.toLowerCase()))
    : CATALOGOS;

  if (!catalogos.length) {
    console.error(`❌ No se encontró catálogo con: ${filtroArg}`);
    process.exit(1);
  }

  // 3. Determinar todos los códigos necesarios para esta corrida
  const codigosNecesarios = new Set();
  for (const cat of catalogos) {
    let prods = todos.filter(p => cat.categorias.includes(p.Category));
    if (cat.filtro) prods = prods.filter(cat.filtro);
    prods.forEach(p => { if (p.Default_code) codigosNecesarios.add(p.Default_code); });
  }
  console.log(`🖼  Productos que necesitan imagen: ${codigosNecesarios.size}`);

  // 4. Cargar cache y descargar solo las que faltan
  const cache = cargarCache();
  const sinCache = [...codigosNecesarios].filter(c => !cache[c]);

  if (sinCache.length > 0) {
    console.log(`  ⬇️  Descargando ${sinCache.length} imágenes nuevas...`);
    const nuevas = await fetchImagenesEnLote(sinCache);
    Object.assign(cache, nuevas);
    guardarCache(cache);
    console.log(`  ✅ ${Object.keys(nuevas).length} imágenes descargadas`);
  } else {
    console.log('  ✅ Todas las imágenes en cache\n');
  }

  // 5. Generar y subir PDFs
  const resultados = { ok: [], error: [] };

  for (const cat of catalogos) {
    console.log(`\n📄 ${cat.archivo}`);

    let prods = todos.filter(p => cat.categorias.includes(p.Category));
    if (cat.filtro) prods = prods.filter(cat.filtro);

    if (!prods.length) {
      console.log('  ⚠️  Sin productos — saltando');
      continue;
    }

    prods = ordenarProductos(prods, cat.orden);
    console.log(`  📊 ${prods.length} productos, orden: ${cat.orden}`);

    try {
      const buffer = await generarPDF(cat.archivo, prods, cat.orden, caracteristicas, cache);
      console.log(`  ✅ PDF: ${(buffer.length/1024).toFixed(0)} KB`);
      const result = await subirADropbox(buffer, cat.archivo);
      console.log(`  ☁️  Dropbox: ${result.path_display}`);
      resultados.ok.push(cat.archivo);
    } catch(err) {
      console.error(`  ❌ ${err.response?.data?.error_summary || err.message}`);
      resultados.error.push({ archivo: cat.archivo, error: err.message });
    }
  }

  console.log('\n══════════════════════════════════════════════');
  console.log(`✅ OK: ${resultados.ok.length} | ❌ Errores: ${resultados.error.length}`);
  resultados.error.forEach(e => console.log(`   ${e.archivo}: ${e.error}`));
  console.log('══════════════════════════════════════════════');
}

main().catch(err => { console.error('❌ Fatal:', err.message); process.exit(1); });
