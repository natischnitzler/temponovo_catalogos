#!/usr/bin/env node
/**
 * buscar.js — módulo de consulta
 *
 * Lee catalogo.json (lo produce construir-base.js), traduce la frase del
 * cliente a filtros con una llamada, y filtra en local. No analiza fotos:
 * eso ya se hizo en la corrida semanal.
 *
 * Si el filtro estricto queda vacío, suelta la condición menos importante y
 * dice cuál soltó, en vez de responder "no hay resultados".
 *
 * CLI:  node buscar.js "quiero un reloj vintage dorado de mujer"
 * Como módulo:  const { responder } = require('./buscar');
 */

const fs = require('fs');

const BASE     = process.env.BASE || './catalogo.json';
const API_KEY  = process.env.ANTHROPIC_API_KEY;
const MODELO   = 'claude-sonnet-4-6';
const MAX      = 5;

// ── Lo que se deduce del código: familia, tipo y género ──────────────────────
const SERIES = {
  CA:['calculadora','unisex'],  DBC:['calculadora','unisex'], DB:['databank','unisex'],
  LTP:['analógico','mujer'],    LQ:['analógico','mujer'],     LA:['digital','mujer'],
  LW:['digital','mujer'],       LWS:['digital','mujer'],      LRW:['analógico','mujer'],
  LX:['analógico','mujer'],     LF:['digital','unisex'],
  MTP:['analógico','hombre'],   MTD:['analógico','hombre'],   MDV:['analógico','hombre'],
  MRW:['analógico','hombre'],   MQ:['analógico','unisex'],    MW:['analógico','hombre'],
  MWA:['ana-digi','hombre'],    MWD:['digital','hombre'],     MCW:['ana-digi','hombre'],
  MTS:['analógico','hombre'],   AQ:['ana-digi','unisex'],     AW:['ana-digi','unisex'],
  AMW:['ana-digi','hombre'],    AEQ:['ana-digi','hombre'],    AQS:['ana-digi','hombre'],
  AE:['digital','unisex'],      A:['digital','unisex'],       ABL:['digital','unisex'],
  B:['digital','unisex'],       F:['digital','unisex'],       W:['digital','unisex'],
  WS:['digital','hombre'],      WSB:['digital','hombre'],     DW:['digital','hombre'],
  HDC:['ana-digi','hombre'],    BMS:['analógico','hombre'],   HS:['cronómetro','unisex'],
  TQ:['despertador','hogar'],   DQ:['despertador','hogar'],   PQ:['despertador','hogar'],
  IQ:['reloj mural','hogar'],   ID:['reloj mural','hogar'],
};

function derivar(p) {
  const cat = (p.categoria || '').toUpperCase();
  if (cat.includes('G-SHOCK')) return { tipo: 'G-Shock', genero: 'unisex' };
  if (cat.includes('EDIFICE')) return { tipo: 'analógico', genero: 'hombre' };
  const serie = (p.codigo.match(/^[A-Z]+/) || [''])[0];
  for (let n = 4; n >= 1; n--) {
    const s = SERIES[serie.slice(0, n)];
    if (s) return { tipo: s[0], genero: s[1] };
  }
  return { tipo: '', genero: '' };
}

/** "10 Bar Esfera 45 mm" → { res:'100m', tam:45 } */
function parseSpec(spec = '') {
  let res = null;
  if (/20\s*bar|200\s*m\b/i.test(spec))        res = '200m';
  else if (/1[01]\s*bar|100\s*m\b/i.test(spec)) res = '100m';
  else if (/5\s*bar|50\s*m\b/i.test(spec))      res = '50m';
  else if (/\bWR\b/i.test(spec))                res = 'WR';
  const m = spec.match(/(\d{2,3})\s*(?:x\s*\d+\s*)?mm/i);
  return { res, tam: m ? Number(m[1]) : null };
}

function cargarBase(ruta = BASE) {
  const raw = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  return Object.values(raw.productos).map(p => ({
    ...p, ...derivar(p), ...parseSpec(p.spec), a: p.atributos || {},
  }));
}

// ── Frase del cliente → filtros ──────────────────────────────────────────────
const PROMPT = frase => `Un vendedor de relojes Casio recibe este pedido de un cliente:

"${frase}"

Tradúcelo a filtros de búsqueda. Devuelve SOLO este JSON:
{"tipo":"","genero":"","correa":"","tono":"","estilo":"","precio_max":null,"precio_min":null,"agua":false}

Valores permitidos:
- tipo: digital, analógico, ana-digi, calculadora, databank, G-Shock, despertador, reloj mural, cronómetro, o ""
- genero: hombre, mujer, unisex, o ""
- correa: acero, resina, cuero, malla, tela, bicolor, o ""
- tono: plateado, dorado, negro, azul, verde, rojo, rosa, blanco, beige, gris, marron, oro rosa, o ""
- estilo: vestir, casual, deportivo, vintage, militar, urbano, o ""
- precio_max / precio_min: en pesos chilenos sin IVA, o null
- agua: true si va a nadar o hacer deporte con el reloj

Reglas: "correa metálica" o "de metal" es acero. "elegante" o "formal" es estilo vestir. "para hacer deporte" es estilo deportivo y agua true. Un color va en tono.`;

async function interpretar(frase) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODELO, max_tokens: 400, messages: [{ role: 'user', content: PROMPT(frase) }] }),
  });
  if (!r.ok) throw new Error(`API ${r.status}`);
  const d = await r.json();
  const txt = d.content.filter(x => x.type === 'text').map(x => x.text).join('');
  const limpio = txt.replace(/```json|```/g, '').trim();
  return JSON.parse(limpio.slice(limpio.indexOf('{')));
}

const CRITERIOS = ['tipo','genero','correa','tono','estilo'];
function hayCriterios(f){
  return CRITERIOS.some(k => f[k]) || f.agua || f.precio_max != null || f.precio_min != null;
}

// ── Puntaje ──────────────────────────────────────────────────────────────────
function puntuar(productos, f) {
  const out = [];
  for (const p of productos) {
    const a = p.a;
    // Punto base solo si la consulta no pidió nada. Si pidió algo y el producto
    // no cumple ni una condición, no tiene por qué aparecer.
    let pts = hayCriterios(f) ? 0 : 1, razones = [], fuera = false;

    if (f.tipo) {
      if (p.tipo === f.tipo) { pts += 5; razones.push(f.tipo); }
      else if (['calculadora', 'databank', 'G-Shock', 'despertador', 'reloj mural'].includes(f.tipo)) fuera = true;
      else pts -= 2;
    } else if (['despertador', 'reloj mural', 'cronómetro'].includes(p.tipo)) pts -= 4;

    if (f.genero) {
      if (p.genero === f.genero) { pts += 4; razones.push(p.genero); }
      else if (p.genero === 'unisex') pts += 1;
      else fuera = true;
    }
    if (f.correa) {
      if (a.correa === f.correa) { pts += 4; razones.push('correa ' + a.correa); }
      else if (f.correa === 'acero' && ['malla', 'bicolor'].includes(a.correa)) { pts += 3; razones.push('correa ' + a.correa); }
      else if (a.correa) fuera = true;
    }
    if (f.tono) {
      if (a.tono === f.tono) { pts += 4; razones.push(a.tono); }
      else if (a.caja === f.tono) { pts += 2; razones.push('caja ' + a.caja); }
      else if (f.tono === 'dorado' && a.correa === 'bicolor') { pts += 2; razones.push('bicolor'); }
      else if ((a.esfera || '').toLowerCase().includes(f.tono)) { pts += 2; razones.push('esfera ' + a.esfera); }
      else pts -= 1;
    }
    if (f.estilo) {
      if (a.estilo === f.estilo) { pts += 3; razones.push(a.estilo); }
      else if (f.estilo === 'deportivo' && p.res === '200m') pts += 1;
      else pts -= 1;
    }
    if (f.agua) {
      if (p.res === '200m') { pts += 3; razones.push('200 m'); }
      else if (p.res === '100m') { pts += 2; razones.push('100 m'); }
      else if (p.res === '50m') pts += 1;
      else pts -= 3;
    }
    if (f.precio_max != null) { if (p.precio > f.precio_max) fuera = true; else pts += 1; }
    if (f.precio_min != null && p.precio < f.precio_min) fuera = true;

    if (!fuera && pts > 0) out.push({ p, pts, razones });
  }
  out.sort((x, y) => y.pts - x.pts || x.p.precio - y.p.precio);
  return out;
}

// ── Relajación: de lo menos a lo más importante para el cliente ──────────────
const ORDEN = ['estilo', 'tono', 'correa', 'tipo', 'genero', 'agua', 'precio_max'];
const NOMBRE = {
  estilo: 'el estilo', tono: 'el color', correa: 'el material de la correa',
  tipo: 'el tipo de reloj', genero: 'que sea de hombre o mujer',
  agua: 'la resistencia al agua', precio_max: 'el presupuesto',
};

function buscar(productos, filtros) {
  let r = puntuar(productos, filtros);
  if (r.length) return { resultados: r.slice(0, MAX), soltados: [] };

  const activos = ORDEN.filter(k => filtros[k] !== '' && filtros[k] != null && filtros[k] !== false);
  const sin = (f, k) => ({ ...f, [k]: k === 'precio_max' ? null : k === 'agua' ? false : '' });

  // 1) Soltar UNA sola condición, la menos importante que destrabe la búsqueda.
  //    Así "deporte bajo 10 mil" suelta el presupuesto y no el deporte.
  for (const k of activos) {
    r = puntuar(productos, sin(filtros, k));
    if (!r.length) continue;
    // Si lo que se soltó fue el presupuesto, el cliente quería lo barato:
    // manda el precio, no el puntaje.
    if (k === 'precio_max') r.sort((x, y) => x.p.precio - y.p.precio);
    return { resultados: r.slice(0, MAX), soltados: [k] };
  }

  // 2) Si ninguna sola alcanza, ir acumulando.
  const soltados = [];
  let f = { ...filtros };
  for (const k of activos) {
    soltados.push(k);
    f = sin(f, k);
    r = puntuar(productos, f);
    if (r.length) return { resultados: r.slice(0, MAX), soltados };
  }
  return { resultados: [], soltados };
}

// ── Respuesta en palabras ────────────────────────────────────────────────────
const CLP = n => '$' + n.toLocaleString('es-CL');

function redactar({ resultados, soltados }, filtros) {
  if (!resultados.length) return 'No tengo nada en el catálogo que se acerque a eso.';
  const lineas = resultados.map(r => {
    const a = r.p.a;
    const desc = [r.p.tipo, a.correa && 'correa ' + a.correa, a.tono, r.p.res && r.p.res !== 'WR' && r.p.res]
      .filter(Boolean).join(', ');
    return `• ${r.p.codigo} — ${desc} — ${CLP(r.p.precio)} + IVA`;
  });

  let intro = 'Esto es lo que tengo:';
  if (soltados.includes('precio_max')) {
    const min = Math.min(...resultados.map(r => r.p.precio));
    intro = `Bajo ${CLP(filtros.precio_max)} no tengo nada que sirva. Lo más económico parte en ${CLP(min)}:`;
  } else if (soltados.length) {
    intro = `No tengo exactamente eso, así que solté ${NOMBRE[soltados[soltados.length - 1]]}. Lo más parecido:`;
  }
  return [intro, ...lineas].join('\n');
}

async function responder(frase, productos = cargarBase()) {
  const filtros = await interpretar(frase);
  const res = buscar(productos, filtros);
  return { filtros, ...res, texto: redactar(res, filtros) };
}

module.exports = { cargarBase, interpretar, buscar, responder, redactar };

if (require.main === module) {
  const frase = process.argv.slice(2).join(' ');
  if (!frase) { console.error('Uso: node buscar.js "lo que pide el cliente"'); process.exit(1); }
  responder(frase).then(r => {
    console.log('Filtros:', JSON.stringify(r.filtros));
    console.log('');
    console.log(r.texto);
  }).catch(e => { console.error(e.message); process.exit(1); });
}
