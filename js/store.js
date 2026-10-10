// Guardado local (solo en este dispositivo) y respaldo en JSON.

const KEY = 'ayuno-tracker/v1';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function defaultState(today) {
  return { version: 1, startDate: today, onboarded: false, theme: 'system', days: {} };
}

export function normalize(raw, today) {
  const s = defaultState(today);
  if (!raw || typeof raw !== 'object') return s;
  if (typeof raw.startDate === 'string' && DATE.test(raw.startDate)) s.startDate = raw.startDate;
  s.onboarded = raw.onboarded !== false;
  if (['system', 'light', 'dark'].includes(raw.theme)) s.theme = raw.theme;
  const days = raw.days && typeof raw.days === 'object' ? raw.days : {};
  for (const [k, v] of Object.entries(days)) {
    if (!DATE.test(k) || !v || typeof v !== 'object') continue;
    const rec = {};
    if (v.status === 'done' || v.status === 'missed') rec.status = v.status;
    if (rec.status === 'missed' && v.shield === true) rec.shield = true;
    if (typeof v.lastMeal === 'string' && TIME.test(v.lastMeal)) rec.lastMeal = v.lastMeal;
    if (typeof v.at === 'string') rec.at = v.at;
    if (Object.keys(rec).length) s.days[k] = rec;
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
