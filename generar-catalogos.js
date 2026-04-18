// ══════════════════════════════════════════════════════════════════════════════
// TEMPONOVO — Generador de catálogos PDF → Dropbox
// Uso: DROPBOX_TOKEN=xxx node generar-catalogos.js
//      DROPBOX_TOKEN=xxx node generar-catalogos.js "Gshock"  ← solo uno
// ══════════════════════════════════════════════════════════════════════════════

const PDFDocument = require('pdfkit');
const axios       = require('axios');
const https       = require('https');
const fs          = require('fs');
const path        = require('path');
const xmlrpc      = require('xmlrpc');

const DROPBOX_TOKEN  = process.env.DROPBOX_TOKEN;
const DROPBOX_FOLDER = '/Catalogos Temponovo';

// Conexión directa a Odoo
const ODOO_URL      = 'https://temponovo.odoo.com';
const ODOO_DB       = 'cmcorpcl-temponovo-main-24490235';
const ODOO_USERNAME = 'natalia@temponovo.cl';
const ODOO_PASSWORD = 'Contraodoo94+';

// Header PNG (mismo que usa la app)
const HEADER_PATH = path.join(__dirname, 'header.png');
const HEADER_IMG  = fs.existsSync(HEADER_PATH) ? fs.readFileSync(HEADER_PATH) : null;

if (!DROPBOX_TOKEN) {
  console.error('❌ Falta DROPBOX_TOKEN');
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════════════════════
// MAPA DE CATÁLOGOS
// ══════════════════════════════════════════════════════════════════════════════
const CATALOGOS = [
  // ── RELOJES CASIO ──────────────────────────────────────────────────────────
  {
    archivo: 'Catalogo_Relojes _Casio _Completo.pdf',
    categorias: ['Relojes Casio / Clasico','Relojes Casio / Despertadores','Relojes Casio / Edifice','Relojes Casio / G-Shock','Relojes Casio / Murales y Crono','Relojes Casio / Protex'],
    orden: 'categoria',
  },
  {
    archivo: 'Catalogo_Relojes_Casio_Clasico_A-L.pdf',
    categorias: ['Relojes Casio / Clasico'],
    orden: 'alfabetico',
    filtro: p => { const c = limpiarCodigo(p.Default_code).toUpperCase(); return c < 'M'; },
  },
  {
    archivo: 'Catalogo_Relojes_Casio_Clasico_M_W.pdf',
    categorias: ['Relojes Casio / Clasico'],
    orden: 'alfabetico',
    filtro: p => { const c = limpiarCodigo(p.Default_code).toUpperCase(); return c >= 'M'; },
  },
  { archivo: 'Catalogo_Relojes_Casio_Despertadores.pdf', categorias: ['Relojes Casio / Despertadores'], orden: 'categoria' },
  { archivo: 'Catalogo_Relojes_Casio_EdificeyDuro.pdf', categorias: ['Relojes Casio / Edifice','Relojes Casio / G-Shock'], orden: 'categoria' },
  { archivo: 'Catalogo_Relojes_Casio_Gshock.pdf', categorias: ['Relojes Casio / G-Shock'], orden: 'categoria' },
  { archivo: 'Catalogo_Relojes_Casio_Murales y Crono.pdf', categorias: ['Relojes Casio / Murales y Crono'], orden: 'categoria' },
  { archivo: 'Catalogo_Relojes_Casio_Protreck.pdf', categorias: ['Relojes Casio / Protex'], orden: 'categoria' },
  // ── RELOJES QQ ─────────────────────────────────────────────────────────────
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
  // ── OTROS RELOJES ──────────────────────────────────────────────────────────
  { archivo: 'Catalogo Relojes Guess.pdf', categorias: ['Relojes Guess / Dama','Relojes Guess / Varon'], orden: 'categoria' },
  { archivo: 'Catalogo_Relojes_Suizos.pdf', categorias: ['Relojes Suizo / Dama','Relojes Suizo / Varon'], orden: 'categoria' },
  { archivo: 'Catalogo_RelojesEconomicos.pdf', categorias: ['Relojes Económicos / Despertadores','Relojes Económicos / Modulos','Relojes Económicos / Murales'], orden: 'categoria' },
  { archivo: 'Catalogo_Relojes_Timesonic.pdf', categorias: ['Relojes Murales / Relojes Timesonic'], orden: 'categoria' },
  // ── CALCULADORAS ───────────────────────────────────────────────────────────
  { archivo: 'Catalogo_Calculadoras_Casio.pdf', categorias: ['Calculadoras Casio / Cientifica','Calculadoras Casio / Escritorio','Calculadoras Casio / Financieras y graficas','Calculadoras Casio / Portatiles','Calculadoras Casio / Rollo','Calculadoras Casio / Suplementos'], orden: 'categoria' },
  { archivo: 'Catalogo_Calculadoras_Economicas.pdf', categorias: ['Calculadoras Económicas / Calculadora Bolsillo','Calculadoras Económicas / Calculadora Cientifica','Calculadoras Económicas / Calculadora Doble Visor','Calculadoras Económicas / Calculadora Escritorio'], orden: 'categoria' },
  // ── CORREAS ────────────────────────────────────────────────────────────────
  { archivo: 'Catalogo_Correas de Cuero.pdf', categorias: ['Correas / Correas para Reloj de Cuero'], orden: 'categoria' },
  { archivo: 'Catalogo_Correas PU.pdf', categorias: ['Correas / Correas para Reloj PU'], orden: 'categoria' },
  // ── RESTO ──────────────────────────────────────────────────────────────────
  { archivo: 'Catalogo_Estuches_Joyas.pdf', categorias: ['Estuches / Capricho','Estuches / Creta','Estuches / Madera','Estuches / Marina','Estuches / Milos','Estuches / Nature','Estuches / Roma','Estuches / Targa','Estuches / Termal','Estuches / Yuppie','Estuches / Zante'], orden: 'categoria' },
  { archivo: 'Catalogo_LimpiezaJoyas.pdf', categorias: ['Limpieza / Limpieza Connoisseurs'], orden: 'categoria' },
  { archivo: 'Catalogo_Pilas_De_Reloj.pdf', categorias: ['Pilas / Alcalinas','Pilas / Litio','Pilas / Oxido de Plata','Pilas / Zinc'], orden: 'categoria' },
  { archivo: 'Catalogo_Encendedores_Zippo.pdf', categorias: ['Encendedores / Encendedores Zippo'], orden: 'alfabetico' },
  { archivo: 'Catalogo_Encendedores_Zippo_Familia.pdf', categorias: ['Encendedores / Encendedores Zippo'], orden: 'categoria' },
];

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function limpiarCodigo(code, name) {
  if (!code) return '';
  const prefijos = ['RL-','QQ-','CC-','ES-','PI-','LI-','CO-','CS-'];
  let clean = code;
  for (const p of prefijos) {
    if (clean.startsWith(p)) { clean = clean.slice(p.length); break; }
  }
  return clean;
}

function formatPrecio(n) {
  if (!n) return '$0';
  return '$' + Math.round(n).toLocaleString('es-CL');
}

function ordenarProductos(productos, orden) {
  return [...productos].sort((a, b) => {
    if (orden === 'alfabetico') {
      return (limpiarCodigo(a.Default_code)||'').localeCompare(limpiarCodigo(b.Default_code)||'','es');
    }
    const catA = (a.Category||'').trim();
    const catB = (b.Category||'').trim();
    if (catA !== catB) return catA.localeCompare(catB,'es');
    return (limpiarCodigo(a.Default_code)||'').localeCompare(limpiarCodigo(b.Default_code)||'','es');
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// ODOO — Conexión directa
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

async function fetchProductos() {
  console.log('📦 Obteniendo productos de Odoo...');
  const raw = await odooCall('product.product', 'search_read', [
    [], ['default_code','name','list_price','qty_available','virtual_available','categ_id']
  ]);
  const productos = raw.map(p => ({
    Default_code: p.default_code || '',
    Name: p.name || '',
    Price: p.list_price || 0,
    Stock: p.qty_available || 0,
    Incoming: Math.max(0, (p.virtual_available||0) - (p.qty_available||0)),
    Category: p.categ_id ? p.categ_id[1].trim() : '',
    Parent_category: p.categ_id ? p.categ_id[1].split('/')[0].trim() : ''
  }));
  console.log(`✅ ${productos.length} productos obtenidos`);
  return productos;
}

async function fetchCaracteristicas() {
  // Sigue leyendo desde Google Sheets via API (es liviano y no cambia)
  try {
    const url = 'https://temponovo-api.onrender.com/api/caracteristicas';
    return await new Promise((resolve, reject) => {
      https.get(url, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
      }).on('error', reject);
    });
  } catch(e) { console.log('  ⚠️  Sin características'); return {}; }
}

async function obtenerImagenB64(code) {
  try {
    const raw = await odooCall('product.product', 'search_read', [
      [['default_code','=',code]], ['image_512']
    ]);
    if (!raw?.length || !raw[0].image_512) return null;
    return raw[0].image_512;
  } catch(e) { return null; }
}

// ══════════════════════════════════════════════════════════════════════════════
// GENERADOR PDF — layout idéntico a la app (jsPDF mm → PDFKit pts)
// ══════════════════════════════════════════════════════════════════════════════
async function generarPDF(nombreArchivo, productos, orden, caracteristicas) {
  const MM    = 2.8346;          // 1mm en pts
  const PAGE_W = 210 * MM;
  const PAGE_H = 297 * MM;
  const mg     = 4   * MM;

  // Header: imagen 1866x200px → proporcional en 210mm
  const headerH  = (210 * (200/1866)) * MM;   // ~22.5mm en pts
  const footerH  = 10  * MM;
  const COLS     = 4;
  const ROWS     = 4;
  const PER_PG   = 16;
  const cellW    = (PAGE_W - mg*2) / COLS;
  const cellH    = 58  * MM;
  const imgAreaH = 42  * MM;

  // Centrado vertical igual que la app
  const totalH   = ROWS * cellH;
  const available = PAGE_H - mg*2 - headerH - footerH;
  const vOffset  = (available - totalH) / 2;

  const hasIncoming = productos.some(p => (p.Incoming||0) > 0 && (p.Stock||0) === 0);

  const doc    = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
  const chunks = [];
  doc.on('data', c => chunks.push(c));

  // ── Descargar imágenes en lotes de 8 ──────────────────────────────────────
  console.log(`  📸 Descargando ${productos.length} imágenes...`);
  const imgs = {};
  const BATCH = 8;
  for (let i = 0; i < productos.length; i += BATCH) {
    await Promise.all(productos.slice(i, i+BATCH).map(async p => {
      if (!p.Default_code) return;
      const b = await obtenerImagenB64(p.Default_code);
      if (b) imgs[p.Default_code] = b;
    }));
    process.stdout.write(`\r  📸 ${Math.min(i+BATCH, productos.length)}/${productos.length}`);
  }
  console.log(`\n  ✅ Imágenes: ${Object.keys(imgs).length}/${productos.length}`);

  const fecha = new Date().toLocaleDateString('es-CL', {day:'2-digit',month:'2-digit',year:'numeric'});
  const hora  = new Date().toLocaleTimeString('es-CL', {hour:'2-digit',minute:'2-digit'});

  // ── HEADER ────────────────────────────────────────────────────────────────
  function drawHeader() {
    doc.addPage();
    const hdrTop = 3 * MM;
    if (HEADER_IMG) {
      try {
        doc.image(HEADER_IMG, 0, hdrTop, { width: PAGE_W, height: headerH });
      } catch(e) {
        doc.fontSize(10).fillColor('#2c7873').font('Helvetica-Bold')
          .text('TEMPONOVO', mg, hdrTop + 8);
      }
    }
    doc.moveTo(0, hdrTop + headerH).lineTo(PAGE_W, hdrTop + headerH)
      .strokeColor('#cccccc').lineWidth(0.5 * MM).stroke();
  }

  // ── FOOTER ────────────────────────────────────────────────────────────────
  function drawFooter() {
    const fy = PAGE_H - mg - footerH;
    doc.moveTo(mg, fy).lineTo(PAGE_W - mg, fy)
      .strokeColor('#cccccc').lineWidth(0.15 * MM).stroke();
    doc.fontSize(8).fillColor('#888888').font('Helvetica')
      .text(`Precios sin IVA  ·  ${fecha}  ${hora}  |  TEMPONOVO`,
        mg, fy + 1.5*MM, { width: PAGE_W - mg*2, align: 'center' });
    if (hasIncoming) {
      doc.fontSize(7.5).fillColor('#888888').font('Helvetica-Oblique')
        .text('* Productos no disponibles para despacho inmediato',
          mg, fy + 5.5*MM, { width: PAGE_W - mg*2, align: 'center' });
    }
  }

  // ── PRODUCTOS ─────────────────────────────────────────────────────────────
  let pageIdx    = 0;
  let currentCat = null;

  for (const p of productos) {
    const cat        = (p.Category||'').trim();
    // Comparar solo subcategoría (parte después de /) para salto de página
    const subcat = cat.includes('/') ? cat.split('/')[1].trim() : cat;
    const prevSubcat = currentCat && currentCat.includes('/') ? currentCat.split('/')[1].trim() : currentCat;
    const catChanged = orden === 'categoria' && currentCat !== null && subcat !== prevSubcat;

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

    // Fondo blanco
    doc.rect(x, y, cellW, cellH).fill('#ffffff');

    // ── Imagen ──
    const b64 = imgs[p.Default_code];
    if (b64) {
      try {
        const buf = Buffer.from(b64, 'base64');
        doc.rect(x, y, cellW, imgAreaH).fill('#ffffff');
        doc.image(buf, x + 1*MM, y + 1*MM, {
          fit: [cellW - 2*MM, imgAreaH - 2*MM],
          align: 'center',
          valign: 'center'
        });
      } catch(e) {
        doc.rect(x, y, cellW, imgAreaH).fill('#f5f5f5');
      }
    } else {
      doc.rect(x, y, cellW, imgAreaH).fill('#f5f5f5');
    }

    // ── Texto ──
    const stock    = p.Stock || 0;
    const inc      = p.Incoming || 0;
    const conStar  = inc > 0 && stock === 0;
    const codigo   = limpiarCodigo(p.Default_code, p.Name) || '';
    const infoY    = y + imgAreaH + 1.5*MM;

    // Código bold
    doc.fontSize(9).fillColor('#000000').font('Helvetica-Bold')
      .text(codigo + (conStar ? ' *' : ''), x, infoY,
        { width: cellW, align: 'center', lineBreak: false });

    // Precio
    doc.fontSize(8.5).fillColor('#000000').font('Helvetica')
      .text(`$${Math.round(p.Price||0).toLocaleString('es-CL')} + IVA`,
        x, infoY + 3.5*MM,
        { width: cellW, align: 'center', lineBreak: false });

    // Características
    const caract = caracteristicas[p.Default_code];
    if (caract) {
      const specs = [];
      if (caract.genero)             specs.push(caract.genero);
      if (caract.tamano_esfera)      specs.push(caract.tamano_esfera);
      if (caract.resistencia_agua)   specs.push(caract.resistencia_agua);
      if (caract.tamano_calculadora) specs.push(caract.tamano_calculadora);
      if (caract.digitos)            specs.push(`${caract.digitos} Dígitos`);
      if (caract.tamano_otro)        specs.push(caract.tamano_otro);
      if (caract.color)              specs.push(caract.color);
      if (specs.length) {
        const txt = specs.filter(Boolean).join(' · ');
        doc.fontSize(8).fillColor('#787878').font('Helvetica')
          .text(txt, x, infoY + 7*MM,
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
async function subirADropbox(buffer, nombreArchivo) {
  const res = await axios.post(
    'https://content.dropboxapi.com/2/files/upload', buffer,
    {
      headers: {
        'Authorization': `Bearer ${DROPBOX_TOKEN}`,
        'Dropbox-API-Arg': JSON.stringify({ path:`${DROPBOX_FOLDER}/${nombreArchivo}`, mode:'overwrite', autorename:false, mute:true }),
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

  console.log('📦 Obteniendo productos y características...');
  const [todos, caracteristicas] = await Promise.all([
    fetchProductos(),
    fetchCaracteristicas()
  ]);
  console.log(`✅ ${todos.length} productos | ${Object.keys(caracteristicas).length} con características\n`);

  const catalogos = filtroArg
    ? CATALOGOS.filter(c => c.archivo.toLowerCase().includes(filtroArg.toLowerCase()))
    : CATALOGOS;

  if (catalogos.length === 0) {
    console.error(`❌ No se encontró catálogo con: ${filtroArg}`);
    process.exit(1);
  }

  const resultados = { ok: [], error: [] };

  for (const cat of catalogos) {
    console.log(`\n📄 ${cat.archivo}`);

    let prods = todos.filter(p => cat.categorias.includes(p.Category));
    if (cat.filtro) prods = prods.filter(cat.filtro);
    // Solo productos con stock > 0 OR incoming > 0
    prods = prods.filter(p => (p.Stock || 0) > 0 || (p.Incoming || 0) > 0);

    if (prods.length === 0) {
      console.log(`  ⚠️  Sin productos — saltando`);
      continue;
    }

    prods = ordenarProductos(prods, cat.orden);
    console.log(`  📊 ${prods.length} productos, orden: ${cat.orden}`);

    try {
      const buffer = await generarPDF(cat.archivo, prods, cat.orden, caracteristicas);
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
