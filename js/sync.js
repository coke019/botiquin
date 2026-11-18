// Sincronización con Firestore (Firebase): comparte el botiquín entre varios móviles con un código familiar.
// Los datos siguen guardándose también en este teléfono (db.js); Firestore es solo el "puente" entre móviles.
import { firebaseConfig } from './firebase-config.js';
import { obtenerTodos, obtenerUno, guardarLocal, eliminarLocal, alCambiar } from './db.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0, O, 1, I para evitar confusiones
export const disponible = Boolean(firebaseConfig.projectId) && !/^PEGA/i.test(firebaseConfig.projectId);

export class ErrorSync extends Error {
  constructor(codigo, detalle) { super(codigo); this.codigo = codigo; this.detalle = detalle; }
}

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }
};
export const codigoGuardado = () => ls.get('familia') || '';

/* ---------- Código familiar: 23 caracteres al azar + 1 de control (detecta errores al teclear) ---------- */
const control = (c) => ALFABETO[[...c].reduce((s, ch, i) => s + (2 * i + 1) * ALFABETO.indexOf(ch), 0) % 32];
export function nuevoCodigo() {
  const bytes = new Uint8Array(23);
  crypto.getRandomValues(bytes);
  const c = [...bytes].map((b) => ALFABETO[b % 32]).join('');
  return c + control(c);
}
export const normalizarCodigo = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const codigoValido = (c) => c.length === 24 && [...c].every((ch) => ALFABETO.includes(ch)) && control(c.slice(0, 23)) === c[23];
export const formatearCodigo = (c) => (c.match(/.{1,4}/g) || []).join('-');

/* ---------- Estado interno ---------- */
let sdk = null, col = null, parar = null, listo = Promise.resolve();
let alDatos = () => {}, alEstado = () => {};
const limpiar = (m) => JSON.parse(JSON.stringify(m)); // Firestore no admite valores "undefined"
const leerBorrados = () => { try { return JSON.parse(ls.get('sync_borrados') || '[]'); } catch { return []; } };
const guardarBorrados = (l) => ls.set('sync_borrados', JSON.stringify(l));

async function cargarSDK() {
  if (sdk) return sdk;
  const [app, fs] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-firestore.js`)]);
  const a = app.initializeApp(firebaseConfig);
  let db;
  try { // caché persistente: los cambios hechos sin conexión se envían al volver, aunque cierres la app
    db = fs.initializeFirestore(a, { localCache: fs.persistentLocalCache(), experimentalAutoDetectLongPolling: true });
  } catch { db = fs.getFirestore(a); }
  sdk = { fs, db };
  return sdk;
}

const abrirColeccion = (codigo) => sdk.fs.collection(sdk.db, 'familias', codigo, 'medicamentos');

/* ---------- Cambios hechos en ESTE teléfono -> se envían a Firestore ---------- */
async function borrarRemoto(id) {
  await sdk.fs.deleteDoc(sdk.fs.doc(col, id));
  guardarBorrados(leerBorrados().filter((x) => x !== id));
}
function registrarHooks() {
  alCambiar(
    (m) => { listo.then(() => sdk.fs.setDoc(sdk.fs.doc(col, m.id), limpiar(m))).catch(() => alEstado('error')); },
    (id) => {
      guardarBorrados([...new Set([...leerBorrados(), id])]); // se recuerda por si no hay conexión en este momento
      listo.then(() => borrarRemoto(id)).catch(() => {});
    }
  );
}

/* ---------- Cambios hechos en OTROS teléfonos -> se aplican aquí ---------- */
async function escuchar() {
  const { fs } = sdk;
  leerBorrados().forEach((id) => borrarRemoto(id).catch(() => {}));
  parar = fs.onSnapshot(col, { includeMetadataChanges: true }, async (snap) => {
    let cambio = false;
    for (const ch of snap.docChanges()) {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        if (await obtenerUno(id)) { await eliminarLocal(id); cambio = true; }
        continue;
      }
      if (leerBorrados().includes(id)) continue; // lo borraste aquí y aún no se ha enviado el borrado
      const remoto = ch.doc.data();
      const local = await obtenerUno(id);
      if (local && (local.actualizado || 0) > (remoto.actualizado || 0)) { // tu versión es más reciente: se envía
        fs.setDoc(fs.doc(col, id), limpiar(local)).catch(() => {});
        continue;
      }
      if (!local || JSON.stringify(local) !== JSON.stringify(remoto)) { await guardarLocal(remoto); cambio = true; }
    }
    if (cambio) alDatos();
    const m = snap.metadata;
    alEstado(m.fromCache ? (navigator.onLine ? 'conectando' : 'sinconexion') : m.hasPendingWrites ? 'subiendo' : 'ok');
  }, () => alEstado('error'));
}

/* ---------- Primera unión: se fusionan los datos de este teléfono con los del grupo ---------- */
async function fusionInicial(creando, forzar) {
  const { fs } = sdk;
  let remotos;
  try {
    remotos = (await fs.getDocsFromServer(col)).docs.map((d) => d.data());
  } catch (e) {
    throw new ErrorSync(e.code === 'permission-denied' ? 'permiso' : navigator.onLine ? 'servidor' : 'sinconexion', e.code);
  }
  if (!creando && !remotos.length && !forzar) throw new ErrorSync('vacio');
  const locales = await obtenerTodos();
  const remotoPorId = new Map(remotos.map((m) => [m.id, m]));
  const localPorId = new Map(locales.map((m) => [m.id, m]));
  const subir = locales.filter((l) => { const r = remotoPorId.get(l.id); return !r || (l.actualizado || 0) > (r.actualizado || 0); });
  try {
    await Promise.all(subir.map((m) => fs.setDoc(fs.doc(col, m.id), limpiar(m))));
  } catch (e) { throw new ErrorSync(e.code === 'permission-denied' ? 'permiso' : 'servidor', e.code); }
  for (const r of remotos) {
    const l = localPorId.get(r.id);
    if (!l || (r.actualizado || 0) > (l.actualizado || 0)) await guardarLocal(r);
  }
}

/* ---------- API pública ---------- */
export async function conectar(codigo, { creando = false, forzar = false, alDatos: d, alEstado: e }) {
  const cod = normalizarCodigo(codigo);
  if (!codigoValido(cod)) throw new ErrorSync('codigo');
  alDatos = d; alEstado = e;
  try { await cargarSDK(); } catch { throw new ErrorSync(navigator.onLine ? 'sdk' : 'sinconexion'); }
  if (parar) { parar(); parar = null; }
  col = abrirColeccion(cod);
  await fusionInicial(creando, forzar);
  ls.set('familia', cod);
  listo = Promise.resolve();
  registrarHooks();
  await escuchar();
}

// Al abrir la app: si ya estás en un grupo, se reanuda la sincronización
export function reanudar({ alDatos: d, alEstado: e }) {
  const cod = codigoGuardado();
  if (!disponible || !cod) return;
  alDatos = d; alEstado = e;
  listo = cargarSDK().then(() => { col = abrirColeccion(cod); return escuchar(); });
  listo.catch(() => alEstado(navigator.onLine ? 'error' : 'sinconexion'));
  registrarHooks();
}

// Dejar el grupo: los datos se quedan en este teléfono, pero ya no se sincronizan
export function dejar() {
  if (parar) { parar(); parar = null; }
  alCambiar(null, null);
  ls.set('familia', '');
  guardarBorrados([]);
  col = null;
}
