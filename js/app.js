import { obtenerTodos, guardar, eliminar } from './db.js';

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

/* ---------- Eventos ---------- */
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
