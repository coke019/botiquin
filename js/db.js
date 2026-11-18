// Pequeño envoltorio de IndexedDB: guarda los medicamentos en el propio dispositivo.
const NOMBRE_BD = 'botiquin';
const ALMACEN = 'medicamentos';

function abrir() {
  return new Promise((resolve, reject) => {
    const peticion = indexedDB.open(NOMBRE_BD, 1);
    peticion.onupgradeneeded = () => peticion.result.createObjectStore(ALMACEN, { keyPath: 'id' });
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error);
  });
}

// Ejecuta una operación dentro de una transacción y devuelve su resultado
async function operar(modo, fn) {
  const bd = await abrir();
  return new Promise((resolve, reject) => {
    const t = bd.transaction(ALMACEN, modo);
    const peticion = fn(t.objectStore(ALMACEN));
    t.oncomplete = () => resolve(peticion && peticion.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const obtenerTodos = () => operar('readonly', (s) => s.getAll());
export const obtenerUno = (id) => operar('readonly', (s) => s.get(id));
export const guardarLocal = (med) => operar('readwrite', (s) => s.put(med));
export const eliminarLocal = (id) => operar('readwrite', (s) => s.delete(id));

// Avisos opcionales para la sincronización (sync.js): se ejecutan cuando ESTE teléfono guarda o elimina
const oyentes = { guardado: null, eliminado: null };
export const alCambiar = (guardado, eliminado) => { oyentes.guardado = guardado; oyentes.eliminado = eliminado; };

export const guardar = async (med) => { await guardarLocal(med); if (oyentes.guardado) oyentes.guardado(med); };
export const eliminar = async (id) => { await eliminarLocal(id); if (oyentes.eliminado) oyentes.eliminado(id); };
