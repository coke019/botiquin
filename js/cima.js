// Consulta a CIMA (AEMPS), el registro oficial de medicamentos de España.
const BASE = 'https://cima.aemps.es/cima/rest';

export class ErrorCima extends Error {
  constructor(codigo, detalle) { super(codigo); this.codigo = codigo; this.detalle = detalle; }
}

async function pedir(ruta) {
  const control = new AbortController();
  const limite = setTimeout(() => control.abort(), 12000);
  let resp;
  try {
    resp = await fetch(BASE + ruta, { headers: { Accept: 'application/json' }, signal: control.signal });
  } catch {
    // Si hay internet pero falla la petición, lo más probable es que CIMA bloquee llamadas desde el navegador (CORS)
    throw new ErrorCima(navigator.onLine ? 'bloqueado' : 'sinconexion');
  } finally { clearTimeout(limite); }
  if (resp.status === 404 || resp.status === 204) return null;
  if (!resp.ok) throw new ErrorCima('http', resp.status);
  const texto = await resp.text();
  if (!texto) return null;
  try { return JSON.parse(texto); } catch { return texto; }
}

const capitalizar = (t = '') => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();

// Busca un medicamento por Código Nacional (6 dígitos). Devuelve null si no existe.
export async function buscarPorCN(cn) {
  let c = String(cn).replace(/\D/g, '');
  if (c.length === 7) c = c.slice(0, 6); // se quita el dígito de control
  if (c.length !== 6) throw new ErrorCima('cn');
  const d = await pedir(`/medicamento?cn=${c}`);
  if (!d || typeof d !== 'object' || !d.nregistro) return null;
  return {
    nregistro: d.nregistro,
    nombre: d.nombre || '',
    laboratorio: d.labtitular || '',
    principios: d.pactivos || (d.principiosActivos || []).map((p) => p.nombre).join(', '),
    tipo: capitalizar((d.formaFarmaceuticaSimplificada || d.formaFarmaceutica || {}).nombre || '')
  };
}

// Trae el apartado "4.1 Indicaciones terapéuticas" de la ficha técnica y lo recorta.
// Es un texto técnico: queda editable por si quieres dejarlo más sencillo.
export async function indicaciones(nregistro) {
  try {
    const d = await pedir(`/docSegmentado/contenido/1?nregistro=${encodeURIComponent(nregistro)}&seccion=4.1`);
    let html = Array.isArray(d) ? (d[0] && d[0].contenido) : (d && d.contenido) || (typeof d === 'string' ? d : '');
    if (!html) return '';
    let texto = new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
    texto = texto.replace(/\s+/g, ' ').replace(/^\s*4\.1\.?\s*Indicaciones terapéuticas\s*/i, '').trim();
    if (texto.length > 240) texto = texto.slice(0, 240).replace(/\s+\S*$/, '') + '…';
    return texto;
  } catch { return ''; } // las indicaciones son un extra: si fallan, no se bloquea nada
}
