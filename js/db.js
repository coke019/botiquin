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
export const guardar = (med) => operar('readwrite', (s) => s.put(med));
export const eliminar = (id) => operar('readwrite', (s) => s.delete(id));
