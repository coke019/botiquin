// Escaneo de códigos con la cámara o desde una foto, usando la librería ZXing.
// La librería se descarga la primera vez que se necesita y queda guardada para usarla sin conexión.
const LIBS = [
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js',
  'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js'
];
let promesaLib = null;

export function cargarZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!promesaLib) {
    promesaLib = (async () => {
      for (const url of LIBS) {
        try {
          await new Promise((ok, ko) => {
            const s = document.createElement('script');
            s.src = url; s.crossOrigin = 'anonymous'; s.onload = ok; s.onerror = ko;
            document.head.appendChild(s);
          });
          if (window.ZXing) return window.ZXing;
        } catch { /* se prueba la siguiente fuente */ }
      }
      promesaLib = null;
      throw new Error('No se pudo cargar el lector de códigos. La primera vez necesita conexión a internet.');
    })();
  }
  return promesaLib;
}

// Solo nos interesan EAN-13 (barras) y DataMatrix (cuadradito de los envases recientes)
function ajustes(Z) {
  const h = new Map();
  h.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.DATA_MATRIX]);
  h.set(Z.DecodeHintType.TRY_HARDER, true);
  return h;
}

function decodificar(Z, lector, h, canvas) {
  try {
    const fuente = new Z.HTMLCanvasElementLuminanceSource(canvas);
    const mapa = new Z.BinaryBitmap(new Z.HybridBinarizer(fuente));
    return lector.decode(mapa, h).getText(); // los ajustes se pasan en cada llamada
  } catch { return null; } // "no encontrado" es lo normal mientras se enfoca
}

/* ---------- Cámara en vivo ---------- */
export async function escanearCamara() {
  const Z = await cargarZXing();
  const lector = new Z.MultiFormatReader();
  const h = ajustes(Z);
  const capa = document.querySelector('#escaner');
  const video = document.querySelector('#video');
  const estado = document.querySelector('#escaner-estado');

  const flujo = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false
  });
  video.srcObject = flujo;
  await video.play();
  capa.hidden = false;
  estado.textContent = 'Apunta al código de barras o al código cuadrado del envase';

  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let activo = true;
    const consejo = setTimeout(() => {
      estado.textContent = 'Prueba con más luz, a otra distancia, o cancela y usa «Desde foto»';
    }, 12000);

    const terminar = (texto) => {
      activo = false; clearTimeout(consejo);
      flujo.getTracks().forEach((t) => t.stop());
      video.srcObject = null; capa.hidden = true;
      resolve(texto);
    };
    document.querySelector('#escaner-cerrar').onclick = () => terminar(null);

    const ciclo = () => {
      if (!activo) return;
      if (video.readyState >= 2 && video.videoWidth) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const texto = decodificar(Z, lector, h, canvas);
        if (texto) { if (navigator.vibrate) navigator.vibrate(60); return terminar(texto); }
      }
      setTimeout(ciclo, 120);
    };
    ciclo();
  });
}

/* ---------- Desde una foto ---------- */
export async function escanearFoto(archivo) {
  const Z = await cargarZXing();
  const lector = new Z.MultiFormatReader();
  const h = ajustes(Z);
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // Se prueba a distintos tamaños: a veces reducir la foto ayuda a detectar el código
    for (const lado of [2400, 1600, 1000]) {
      const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * escala);
      canvas.height = Math.round(img.naturalHeight * escala);
      canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, canvas.width, canvas.height);
      const texto = decodificar(Z, lector, h, canvas);
      if (texto) return texto;
    }
    return null;
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- Interpretar el texto leído ---------- */
// Devuelve { cn, caducidad ('AAAA-MM'), lote, bruto }.
// - EAN-13 español: 847000 + CN (6 dígitos) + dígito de control.
// - DataMatrix GS1: 01 GTIN(14) · 17 caducidad AAMMDD · 10 lote · 21 nº de serie.
//   Los campos de longitud variable terminan con el carácter separador GS (código 29).
export function parsearCodigo(texto) {
  const GS = String.fromCharCode(29);
  const bruto = String(texto || '');
  const res = { cn: '', caducidad: '', lote: '', bruto };
  let t = bruto.replace(/^\]d2/, '').replace(new RegExp('^' + GS), '');

  let gtin = '';
  if (/^\d{13}$/.test(t)) {
    gtin = '0' + t;                                   // EAN-13 sin más datos
  } else if (/^01\d{14}/.test(t)) {
    let i = 0;
    while (i < t.length) {
      const ai = t.substr(i, 2);
      if (ai === '01') { gtin = t.substr(i + 2, 14); i += 16; }
      else if (ai === '17' || ai === '11' || ai === '13' || ai === '15') {
        const f = t.substr(i + 2, 6);
        if (ai === '17' && /^\d{6}$/.test(f) && +f.substr(2, 2) >= 1 && +f.substr(2, 2) <= 12) res.caducidad = `20${f.substr(0, 2)}-${f.substr(2, 2)}`;
        i += 8;
      } else if (ai === '10' || ai === '21') {
        let fin = t.indexOf(GS, i + 2); if (fin < 0) fin = t.length;
        if (ai === '10') res.lote = t.slice(i + 2, fin);
        i = fin + 1;
      } else break; // identificador desconocido: se detiene la lectura
    }
  }
  const ean = gtin.length === 14 && gtin[0] === '0' ? gtin.slice(1) : '';
  if (ean.startsWith('847')) res.cn = ean.substr(6, 6);
  return res;
}
