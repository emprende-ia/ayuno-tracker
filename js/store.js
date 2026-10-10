// Guardado local, respaldo en JSON y unión de datos entre dispositivos.
//
// Cada día guarda `u`: la hora (ms) de su último cambio. Al sincronizar, por cada día
// gana el cambio más reciente. Borrar un registro deja solo `{ u }` (una "lápida")
// para que el borrado también llegue a los otros dispositivos.

const KEY = 'ayuno-tracker/v1';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function defaultState(today) {
  return { version: 1, startDate: today, startDateU: 0, onboarded: false, theme: 'system', days: {} };
}

function normalizeDay(v) {
  if (!v || typeof v !== 'object') return null;
  const rec = {};
  if (v.status === 'done' || v.status === 'missed') rec.status = v.status;
  if (rec.status === 'missed' && v.shield === true) rec.shield = true;
  if (typeof v.lastMeal === 'string' && TIME.test(v.lastMeal)) rec.lastMeal = v.lastMeal;
  if (typeof v.at === 'string') rec.at = v.at;
  if (typeof v.u === 'number' && Number.isFinite(v.u)) rec.u = v.u;
  else if (rec.at && Number.isFinite(Date.parse(rec.at))) rec.u = Date.parse(rec.at);
  return Object.keys(rec).length ? rec : null;
}

export function normalize(raw, today) {
  const s = defaultState(today);
  if (!raw || typeof raw !== 'object') return s;
  if (typeof raw.startDate === 'string' && DATE.test(raw.startDate)) s.startDate = raw.startDate;
  if (typeof raw.startDateU === 'number' && Number.isFinite(raw.startDateU)) s.startDateU = raw.startDateU;
  s.onboarded = raw.onboarded !== false;
  if (['system', 'light', 'dark'].includes(raw.theme)) s.theme = raw.theme;
  const days = raw.days && typeof raw.days === 'object' ? raw.days : {};
  for (const [k, v] of Object.entries(days)) {
    if (!DATE.test(k)) continue;
    const rec = normalizeDay(v);
    if (rec) s.days[k] = rec;
  }
  return s;
}

export function loadState(today) {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw), today);
  } catch {
    /* sin acceso al almacenamiento: se usa un estado nuevo */
  }
  return defaultState(today);
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function serialize(state) {
  return JSON.stringify({ app: 'ayuno-tracker', exportedAt: new Date().toISOString(), ...state }, null, 2);
}

export function parseBackup(text, today) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  if (!obj || typeof obj !== 'object' || typeof obj.days !== 'object') {
    throw new Error('El archivo no parece una copia de esta app.');
  }
  return normalize({ ...obj, onboarded: true }, today);
}

/* ---------- Sincronización ---------- */

/** Lo que se guarda en la nube (el tema es preferencia de cada dispositivo). */
export function toCloud(state) {
  return {
    v: 1,
    startDate: state.startDate,
    startDateU: state.startDateU || 0,
    onboarded: !!state.onboarded,
    days: state.days,
  };
}

/** Une dos estados: por cada día gana el cambio más reciente. */
export function mergeStates(local, remote, today) {
  const out = { ...local, days: { ...local.days } };
  if (!remote || typeof remote !== 'object') return out;
  const r = normalize(remote, today || local.startDate);
  const ru = r.startDateU || 0;
  const lu = local.startDateU || 0;
  // Gana la fecha cambiada más recientemente; si empatan, la más antigua (conserva más historial)
  if (ru > lu || (ru === lu && r.startDate < local.startDate)) {
    out.startDate = r.startDate;
    out.startDateU = ru;
  }
  out.onboarded = !!local.onboarded || remote.onboarded === true;
  for (const [k, rec] of Object.entries(r.days)) {
    const mine = out.days[k];
    if (!mine || (rec.u || 0) > (mine.u || 0)) out.days[k] = rec;
  }
  return out;
}

/** Firma estable de los datos sincronizables, para saber si dos estados son iguales. */
export function syncSignature(state) {
  if (!state) return '';
  const days = state.days || {};
  const keys = Object.keys(days).sort();
  const d = keys.map((k) => {
    const v = days[k];
    return [k, v.status || '', v.shield ? 1 : 0, v.lastMeal || '', v.u || 0];
  });
  return JSON.stringify([state.startDate, state.startDateU || 0, !!state.onboarded, d]);
}
