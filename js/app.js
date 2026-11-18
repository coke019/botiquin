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
  sel.innerHTML = '<option value="todos">Tipo</option>' +
    usados.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  sel.value = usados.includes(actual) ? actual : 'todos';
}

const ETIQUETAS = { todos: 'Todos', caducado: 'Caducados', pronto: 'Caducan pronto', ok: 'Correctos' };
const contar = () => {
  const c = { todos: meds.length, caducado: 0, pronto: 0, ok: 0 };
  meds.forEach((m) => c[estado(m).clave]++);
  return c;
};

function pintar() {
  const texto = normal($('#buscar').value.trim());
  const tipo = $('#filtro-tipo').value;
  const cuenta = contar();

  document.querySelectorAll('.chip').forEach((c) => { c.textContent = `${ETIQUETAS[c.dataset.f]} ${cuenta[c.dataset.f]}`; });
  $('#resumen').textContent = meds.length
    ? `${meds.length} ${meds.length === 1 ? 'medicamento' : 'medicamentos'} en el botiquín`
    : 'Aún no hay medicamentos';
  pintarAvisos(cuenta);
  actualizarInsignia(cuenta);

  const visibles = meds
    .filter((m) => filtro === 'todos' || estado(m).clave === filtro)
    .filter((m) => tipo === 'todos' || m.tipo === tipo)
    .filter((m) => !texto || normal([m.nombre, m.principios, m.laboratorio, m.indicaciones, m.cn, m.ubicacion, m.notas].join(' ')).includes(texto))
    .sort((a, b) => a.caducidad.localeCompare(b.caducidad)); // primero los que caducan antes

  $('#lista').innerHTML = visibles.map((m) => {
    const e = estado(m);
    const id = esc(m.id);
    const conUnidades = m.cantidad !== '' && m.cantidad != null && !isNaN(Number(m.cantidad));
    return `<li class="tarjeta ${e.clave}">
      <button class="t-abrir" data-id="${id}">
        <span class="t-fila"><strong>${esc(m.nombre)}</strong><span class="sello ${e.clave}">${esc(e.texto)}</span></span>
        <span class="t-sub">${esc([m.tipo, m.principios].filter(Boolean).join(' · '))}</span>
        ${m.indicaciones ? `<span class="t-desc">${esc(m.indicaciones)}</span>` : ''}
        <span class="t-pie">Caduca ${fechaCorta(m.caducidad)}${m.ubicacion ? ` · ${esc(m.ubicacion)}` : ''}</span>
      </button>
      ${conUnidades ? `<div class="t-uds"><span>Unidades</span>
        <div class="paso"><button data-ac="menos" data-id="${id}" aria-label="Quitar una unidad">−</button><b>${esc(m.cantidad)}</b><button data-ac="mas" data-id="${id}" aria-label="Añadir una unidad">+</button></div></div>` : ''}
    </li>`;
  }).join('');

  const vacio = $('#vacio');
  vacio.hidden = visibles.length > 0;
  vacio.textContent = meds.length
    ? 'Ningún medicamento coincide con la búsqueda o el filtro.'
    : 'Toca el botón + para añadir tu primer medicamento.';
}

function activarFiltro(f) {
  filtro = f;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('activo', c.dataset.f === f));
  pintar();
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
    try { await navigator.share({ files: [archivo], title: 'Copia del botiquín' }); ls.set('ultimaCopia', Date.now()); pintar(); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(archivo);
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  ls.set('ultimaCopia', Date.now());
  pintar();
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

/* ---------- Avisos, notificaciones y copias ---------- */
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* sin almacenamiento */ } }
};
const DIAS_COPIA = 30; // cada cuántos días se recuerda hacer una copia de seguridad
if (!ls.get('primerUso')) ls.set('primerUso', Date.now());

const copiaPendiente = () =>
  meds.length > 0 && Date.now() - Number(ls.get('ultimaCopia') || ls.get('primerUso')) > DIAS_COPIA * 86400000;
const puedeNotificar = () => 'Notification' in window && 'serviceWorker' in navigator;
const instalada = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function pintarAvisos(c) {
  let h = '';
  if (c.caducado) {
    h += `<button class="banner rojo" data-f="caducado"><strong>${c.caducado} ${c.caducado === 1 ? 'medicamento caducado' : 'medicamentos caducados'}</strong>
      <span>No los uses. Llévalos a un punto SIGRE de la farmacia.</span></button>`;
  }
  if (c.pronto) {
    const nombres = meds.filter((m) => estado(m).clave === 'pronto').sort((a, b) => a.caducidad.localeCompare(b.caducidad))
      .slice(0, 3).map((m) => esc(m.nombre)).join(', ');
    h += `<button class="banner naranja" data-f="pronto"><strong>${c.pronto} ${c.pronto === 1 ? 'caduca' : 'caducan'} en menos de ${DIAS_AVISO} días</strong>
      <span>${nombres}${c.pronto > 3 ? '…' : ''}</span></button>`;
  }
  if (copiaPendiente()) {
    h += `<button class="banner azul" data-ac="copia"><strong>Hace tiempo que no haces una copia de seguridad</strong><span>Toca para exportarla ahora.</span></button>`;
  }
  if (meds.length && puedeNotificar() && instalada() && Notification.permission === 'default') {
    h += `<button class="banner neutro" data-ac="avisos"><strong>Activar notificaciones</strong><span>Te avisaremos al abrir la app si hay medicamentos caducados o a punto de caducar.</span></button>`;
  }
  $('#avisos').innerHTML = h;
}

// Numerito rojo sobre el icono de la app (iOS 16.4+ con las notificaciones activadas)
function actualizarInsignia(c) {
  const n = c.caducado + c.pronto;
  try {
    if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  } catch { /* no disponible */ }
}

async function notificarSiProcede(forzar = false) {
  if (!puedeNotificar() || Notification.permission !== 'granted') return;
  const c = contar();
  if (!c.caducado && !c.pronto) return;
  const hoy = new Date().toISOString().slice(0, 10);
  if (!forzar && ls.get('ultimoAviso') === hoy) return; // como mucho una vez al día
  ls.set('ultimoAviso', hoy);
  const partes = [];
  if (c.caducado) partes.push(`${c.caducado} ${c.caducado === 1 ? 'caducado' : 'caducados'}`);
  if (c.pronto) partes.push(`${c.pronto} ${c.pronto === 1 ? 'caduca' : 'caducan'} pronto`);
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('Botiquín', { body: partes.join(' · '), icon: 'icons/icon-192.png', tag: 'caducidad' });
  } catch { /* si el navegador no lo permite, queda el aviso dentro de la app */ }
}

async function activarAvisos() {
  const r = await Notification.requestPermission();
  if (r === 'granted') { aviso('Notificaciones activadas'); await notificarSiProcede(true); }
  pintar();
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
  if (!editandoId) {
    const repetido = meds.find((m) => m.cn === p.cn);
    if (repetido && confirm(`Ya tienes «${repetido.nombre}» en el botiquín (caduca ${fechaCorta(repetido.caducidad)}).\n\n¿Quieres abrirlo para editarlo?\nSi es otro envase, pulsa Cancelar para añadirlo como nuevo.`)) {
      abrirForm(repetido);
      return;
    }
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
  const b = e.target.closest('.chip'); if (b) activarFiltro(b.dataset.f);
});
$('#avisos').addEventListener('click', (e) => {
  const b = e.target.closest('.banner'); if (!b) return;
  if (b.dataset.f) { activarFiltro(b.dataset.f); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  else if (b.dataset.ac === 'copia') exportar();
  else if (b.dataset.ac === 'avisos') activarAvisos();
});
$('#lista').addEventListener('click', async (e) => {
  const paso = e.target.closest('[data-ac]');
  if (paso) { // botones − y + de unidades
    const m = meds.find((x) => x.id === paso.dataset.id); if (!m) return;
    m.cantidad = String(Math.max(0, (Number(m.cantidad) || 0) + (paso.dataset.ac === 'mas' ? 1 : -1)));
    m.actualizado = Date.now();
    await guardar(m);
    pintar();
    return;
  }
  const t = e.target.closest('.t-abrir'); if (!t) return;
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
cargar().then(() => notificarSiProcede());
// Pide a iOS que no borre los datos de la app si hay poco espacio
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
// Con conexión, se descarga el lector de códigos en segundo plano para poder escanear sin conexión más adelante
if (navigator.onLine) setTimeout(() => cargarZXing().catch(() => {}), 4000);
