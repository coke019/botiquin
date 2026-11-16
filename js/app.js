import { obtenerTodos, guardar, eliminar } from './db.js';
import { escanearCamara, escanearFoto, parsearCodigo, cargarZXing } from './scan.js';
import { buscarPorCN, indicaciones } from './cima.js';

const $ = (sel) => document.querySelector(sel);
const TIPOS = ['Comprimidos', 'Cápsulas', 'Jarabe', 'Gotas', 'Sobres', 'Pomada / crema', 'Gel',
  'Inyectable', 'Supositorios', 'Colirio', 'Spray', 'Parche', 'Otro'];
const DIAS_AVISO = 30; // a partir de cuántos días se considera "caduca pronto"

let meds = [];
let filtro = 'todos';
let editandoId = null;

/* ---------- Utilidades ---------- */
const esc = (t = '') => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normal = (t = '') => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function aviso(texto) {
  const t = $('#toast');
  t.textContent = texto; t.hidden = false;
  clearTimeout(aviso.temporizador);
  aviso.temporizador = setTimeout(() => (t.hidden = true), 3000);
}

// La caducidad se guarda como "AAAA-MM". Un medicamento caduca el ÚLTIMO día de ese mes.
function estado(m) {
  const [anio, mes] = m.caducidad.split('-').map(Number);
  const fin = new Date(anio, mes, 0, 23, 59, 59);
  const dias = Math.ceil((fin - new Date()) / 86400000);
  if (dias < 0) return { clave: 'caducado', texto: 'Caducado' };
  if (dias <= DIAS_AVISO) return { clave: 'pronto', texto: `Caduca en ${dias} ${dias === 1 ? 'día' : 'días'}` };
  return { clave: 'ok', texto: 'Correcto' };
}
const fechaCorta = (c) => { const [a, m] = c.split('-'); return `${m}/${a}`; };

/* ---------- Listado ---------- */
function actualizarTipos() {
  const sel = $('#filtro-tipo');
  const actual = sel.value || 'todos';
  const usados = [...new Set(meds.map((m) => m.tipo).filter(Boolean))].sort();
  sel.innerHTML = '<option value="todos">Todos los tipos</option>' +
    usados.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  sel.value = usados.includes(actual) ? actual : 'todos';
}

function pintar() {
  const texto = normal($('#buscar').value.trim());
  const tipo = $('#filtro-tipo').value;

  const cuenta = { caducado: 0, pronto: 0 };
  meds.forEach((m) => { const e = estado(m).clave; if (cuenta[e] !== undefined) cuenta[e]++; });
  const partes = [];
  if (cuenta.caducado) partes.push(`${cuenta.caducado} caducado${cuenta.caducado > 1 ? 's' : ''}`);
  if (cuenta.pronto) partes.push(`${cuenta.pronto} caduca${cuenta.pronto > 1 ? 'n' : ''} pronto`);
  $('#resumen').textContent = meds.length
    ? (partes.join(' y ') || 'Todo en orden') + ` · ${meds.length} en total`
    : 'Aún no hay medicamentos';

  const visibles = meds
    .filter((m) => filtro === 'todos' || estado(m).clave === filtro)
    .filter((m) => tipo === 'todos' || m.tipo === tipo)
    .filter((m) => !texto || normal([m.nombre, m.principios, m.laboratorio, m.indicaciones, m.cn, m.ubicacion, m.notas].join(' ')).includes(texto))
    .sort((a, b) => a.caducidad.localeCompare(b.caducidad)); // primero los que caducan antes

  $('#lista').innerHTML = visibles.map((m) => {
    const e = estado(m);
    return `<li><button class="tarjeta ${e.clave}" data-id="${esc(m.id)}">
      <span class="t-fila"><strong>${esc(m.nombre)}</strong><span class="sello ${e.clave}">${esc(e.texto)}</span></span>
      <span class="t-sub">${esc([m.tipo, m.principios].filter(Boolean).join(' · '))}</span>
      ${m.indicaciones ? `<span class="t-desc">${esc(m.indicaciones)}</span>` : ''}
      <span class="t-pie">Caduca ${fechaCorta(m.caducidad)}${m.cantidad !== '' && m.cantidad != null ? ` · ${esc(m.cantidad)} uds.` : ''}${m.ubicacion ? ` · ${esc(m.ubicacion)}` : ''}</span>
    </button></li>`;
  }).join('');

  const vacio = $('#vacio');
  vacio.hidden = visibles.length > 0;
  vacio.textContent = meds.length
    ? 'Ningún medicamento coincide con la búsqueda o el filtro.'
    : 'Toca el botón + para añadir tu primer medicamento.';
}

async function cargar() {
  meds = await obtenerTodos();
  actualizarTipos();
  pintar();
}

/* ---------- Formulario ---------- */
function abrirForm(med) {
  editandoId = med ? med.id : null;
  const f = $('#form');
  f.reset();
  $('#estado-scan').hidden = true;
  $('#form-titulo').textContent = med ? 'Editar medicamento' : 'Nuevo medicamento';
  $('#btn-borrar').hidden = !med;
  if (med) Object.keys(med).forEach((k) => { if (f.elements[k]) f.elements[k].value = med[k] ?? ''; });
  $('#hoja').hidden = false;
  document.body.classList.add('bloqueado');
  $('#hoja').scrollTop = 0;
}
function cerrarForm() { $('#hoja').hidden = true; document.body.classList.remove('bloqueado'); }

async function enviarForm(ev) {
  ev.preventDefault();
  const datos = Object.fromEntries(new FormData(ev.target).entries());
  Object.keys(datos).forEach((k) => (datos[k] = typeof datos[k] === 'string' ? datos[k].trim() : datos[k]));
  const previo = meds.find((m) => m.id === editandoId);
  const med = { ...previo, ...datos, id: editandoId || nuevoId(), actualizado: Date.now() };
  await guardar(med);
  cerrarForm();
  await cargar();
// Con conexión, se descarga el lector de códigos en segundo plano para poder escanear sin conexión más adelante
if (navigator.onLine) setTimeout(() => cargarZXing().catch(() => {}), 4000);
  aviso('Guardado');
}

async function borrar() {
  if (!editandoId || !confirm('¿Eliminar este medicamento?')) return;
  await eliminar(editandoId);
  cerrarForm();
  await cargar();
  aviso('Eliminado');
}

/* ---------- Copia de seguridad ---------- */
async function exportar() {
  const json = JSON.stringify({ app: 'botiquin', version: 1, exportado: new Date().toISOString(), medicamentos: meds }, null, 2);
  const nombre = `botiquin-${new Date().toISOString().slice(0, 10)}.json`;
  const archivo = new File([json], nombre, { type: 'application/json' });
  // En iPhone se usa el menú Compartir (guardar en Archivos, AirDrop, correo…)
  if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
    try { await navigator.share({ files: [archivo], title: 'Copia del botiquín' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(archivo);
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importar(ev) {
  const archivo = ev.target.files[0];
  ev.target.value = '';
  if (!archivo) return;
  try {
    const datos = JSON.parse(await archivo.text());
    const lista = Array.isArray(datos) ? datos : datos.medicamentos;
    const validos = (lista || []).filter((m) => m && m.id && m.nombre && /^\d{4}-\d{2}$/.test(m.caducidad));
    if (!validos.length) throw new Error('vacío');
    if (!confirm(`Se importarán ${validos.length} medicamentos. Si ya existen, se actualizarán. ¿Continuar?`)) return;
    for (const m of validos) await guardar(m);
    await cargar();
    aviso(`${validos.length} medicamentos importados`);
  } catch {
    alert('No se pudo leer el archivo. Comprueba que es una copia exportada desde esta app.');
  }
}

/* ---------- Escaneo y CIMA ---------- */
function estadoScan(texto, tipo = '') {
  const e = $('#estado-scan');
  e.textContent = texto; e.className = 'estado-scan ' + tipo; e.hidden = false;
}

// Rellena un campo solo si está vacío (o si se pide sobrescribir), para no pisar lo que ya has escrito
function poner(campo, valor, sobrescribir) {
  const input = $('#form').elements[campo];
  if (valor && input && (sobrescribir || !input.value.trim())) input.value = valor;
}

async function consultarCima(cn, sobrescribir) {
  estadoScan('Consultando CIMA…');
  try {
    const r = await buscarPorCN(cn);
    if (!r) { estadoScan('Ese código no aparece en CIMA. Completa los datos a mano.', 'aviso'); return; }
    poner('nombre', r.nombre, sobrescribir);
    poner('laboratorio', r.laboratorio, sobrescribir);
    poner('principios', r.principios, sobrescribir);
    poner('tipo', r.tipo, sobrescribir);
    estadoScan('Datos cargados desde CIMA. Buscando indicaciones…', 'ok');
    const ind = await indicaciones(r.nregistro);
    poner('indicaciones', ind, sobrescribir);
    estadoScan(ind ? 'Datos cargados desde CIMA. Revísalos antes de guardar.'
                   : 'Datos cargados desde CIMA. No se encontraron indicaciones: escríbelas tú si quieres.', 'ok');
  } catch (e) {
    const msg = {
      sinconexion: 'Sin conexión. El código se ha guardado; completa el resto a mano.',
      bloqueado: 'No se pudo consultar CIMA desde el navegador (puede estar bloqueado). Completa los datos a mano.',
      cn: 'El Código Nacional debe tener 6 dígitos.',
      http: `CIMA respondió con un error (${e.detalle}). Inténtalo más tarde o completa a mano.`
    }[e.codigo] || 'No se pudo consultar CIMA. Completa los datos a mano.';
    estadoScan(msg, 'error');
  }
}

async function procesarCodigo(texto) {
  const p = parsearCodigo(texto);
  if (!p.cn) {
    estadoScan('Código leído, pero no parece de un medicamento español. Prueba con el código del envase o introduce los datos a mano.', 'aviso');
    return;
  }
  const f = $('#form');
  const esOtro = f.elements.cn.value && f.elements.cn.value !== p.cn; // otro envase distinto: se reemplaza todo
  f.elements.cn.value = p.cn;
  if (p.caducidad) f.elements.caducidad.value = p.caducidad;
  if (p.lote) f.elements.lote.value = p.lote;
  await consultarCima(p.cn, esOtro);
  if (p.caducidad) estadoScan($('#estado-scan').textContent + ` Caducidad leída del envase: ${fechaCorta(p.caducidad)}.`, $('#estado-scan').className.replace('estado-scan', '').trim());
}

function errorEscaneo(e) {
  if (e.name === 'NotAllowedError' || e.name === 'SecurityError') return 'No hay permiso para usar la cámara. Actívalo en Ajustes del iPhone o usa «Desde foto».';
  if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') return 'No se encontró ninguna cámara. Usa «Desde foto».';
  return e.message || 'No se pudo escanear. Usa «Desde foto» o introduce los datos a mano.';
}

/* ---------- Eventos ---------- */
$('#btn-escanear').addEventListener('click', async () => {
  try {
    estadoScan('Abriendo la cámara…');
    const texto = await escanearCamara();
    if (texto) await procesarCodigo(texto); else $('#estado-scan').hidden = true;
  } catch (e) { estadoScan(errorEscaneo(e), 'error'); }
});
$('#btn-foto').addEventListener('click', () => $('#archivo-foto').click());
$('#archivo-foto').addEventListener('change', async (ev) => {
  const foto = ev.target.files[0];
  ev.target.value = '';
  if (!foto) return;
  estadoScan('Analizando la foto…');
  try {
    const texto = await escanearFoto(foto);
    if (texto) await procesarCodigo(texto);
    else estadoScan('No se encontró ningún código en la foto. Acércate, con buena luz y enfocando bien el código.', 'aviso');
  } catch (e) { estadoScan(errorEscaneo(e), 'error'); }
});
$('#btn-cima').addEventListener('click', () => {
  const cn = $('#form').elements.cn.value;
  if (!cn.trim()) { estadoScan('Escribe primero el Código Nacional (6 dígitos).', 'aviso'); return; }
  consultarCima(cn, false);
});

$('#tipos').innerHTML = TIPOS.map((t) => `<option value="${esc(t)}">`).join('');
$('#buscar').addEventListener('input', pintar);
$('#filtro-tipo').addEventListener('change', pintar);
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  filtro = b.dataset.f;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('activo', c === b));
  pintar();
});
$('#lista').addEventListener('click', (e) => {
  const t = e.target.closest('.tarjeta'); if (!t) return;
  abrirForm(meds.find((m) => m.id === t.dataset.id));
});
$('#btn-nuevo').addEventListener('click', () => abrirForm(null));
$('#btn-cancelar').addEventListener('click', cerrarForm);
$('#form').addEventListener('submit', enviarForm);
$('#btn-borrar').addEventListener('click', borrar);
$('#btn-exportar').addEventListener('click', exportar);
$('#btn-importar').addEventListener('click', () => $('#archivo').click());
$('#archivo').addEventListener('change', importar);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
cargar();
