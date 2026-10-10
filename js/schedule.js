// Horario del plan
//   Lunes a jueves: última comida 14:00, ayuno 16 h hasta las 06:00 del día siguiente.
//   Viernes 14:00 → sábado 20:00: ayuno intenso de 30 h.
//   Domingo: descanso, sin meta.
// Todas las fechas usan la hora local del dispositivo.

export const PLAN = {
  lastMeal: '14:00',
  windowOpens: '06:00',
  fastHours: 16,
  intenseHours: 30,
};

export const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const DAY_LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' en hora local */
export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (k, n) => {
  const d = fromKey(k);
  d.setDate(d.getDate() + n);
  return toKey(d);
};
export const dowOf = (k) => fromKey(k).getDay();
export const mondayOf = (k) => {
  const d = dowOf(k);
  return addDays(k, d === 0 ? -6 : 1 - d);
};
/** Lunes a sábado tienen meta; el domingo es descanso. */
export const isGoalDay = (k) => dowOf(k) !== 0;

/** Fecha local del día k a la hora 'HH:MM' */
export function at(k, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = fromKey(k);
  d.setHours(h, m, 0, 0);
  return d;
}

/** 'fast' (lun–jue), 'intense-start' (vie), 'intense-end' (sáb), 'rest' (dom) */
export function dayKind(k) {
  const d = dowOf(k);
  if (d === 0) return 'rest';
  if (d === 5) return 'intense-start';
  if (d === 6) return 'intense-end';
  return 'fast';
}

/** Ayuno que empieza el día k. Solo lunes a viernes inician un ayuno. */
export function fastFor(k, days = {}) {
  const d = dowOf(k);
  if (d === 0 || d === 6) return null;
  const lastMeal = days[k]?.lastMeal || PLAN.lastMeal;
  const start = at(k, lastMeal);
  const hours = d === 5 ? PLAN.intenseHours : PLAN.fastHours;
  return {
    dayKey: k,
    start,
    end: new Date(start.getTime() + hours * 3600e3),
    hours,
    intense: d === 5,
    custom: lastMeal !== PLAN.lastMeal,
  };
}

/** Primer ayuno que empieza después de `now`. */
export function nextFast(now, days = {}) {
  const today = toKey(now);
  for (let i = 0; i < 8; i++) {
    const f = fastFor(addDays(today, i), days);
    if (f && f.start > now) return f;
  }
  return null;
}

/**
 * Fase actual del plan.
 * kind: 'fast' | 'intense' | 'window' | 'refeed' | 'rest'
 * `broken` indica que el día dueño de esta fase está marcado como "no ayuné".
 */
export function getPhase(now, days = {}) {
  const today = toKey(now);
  const yesterday = addDays(today, -1);
  const missed = (k) => days[k]?.status === 'missed';

  for (const k of [today, yesterday]) {
    const f = fastFor(k, days);
    if (f && now >= f.start && now < f.end) {
      const broken = missed(f.dayKey) || (f.intense && dowOf(today) === 6 && missed(today));
      return { kind: f.intense ? 'intense' : 'fast', ...f, elapsed: now - f.start, total: f.end - f.start, broken };
    }
  }

  const dow = now.getDay();
  const next = nextFast(now, days);

  if (dow === 0) return { kind: 'rest', next };

  if (dow === 6) {
    const fri = fastFor(yesterday, days);
    return { kind: 'refeed', fast: fri, next, broken: missed(yesterday) || missed(today) };
  }

  // Lunes a viernes, fuera del ayuno: ventana de comida antes de las 14:00.
  const todayFast = fastFor(today, days);
  const prev = fastFor(yesterday, days);
  const windowStart = prev ? prev.end : at(today, PLAN.windowOpens);
  if (now < windowStart) return { kind: 'rest', next: todayFast, mondayMorning: true };
  return {
    kind: 'window',
    dayKey: today,
    start: windowStart,
    end: todayFast.start,
    elapsed: now - windowStart,
    total: todayFast.start - windowStart,
    intenseNext: dow === 5,
    next: todayFast,
    broken: missed(today),
  };
}

/** Texto corto de la meta del día */
export function goalShort(k) {
  return {
    fast: 'Sin cena, 16 h',
    'intense-start': 'Sin cena, inicia el intenso',
    'intense-end': 'Ayuno hasta las 20:00',
    rest: 'Descanso',
  }[dayKind(k)];
}

/** Texto completo de la meta del día */
export function goalLong(k, days = {}) {
  const kind = dayKind(k);
  const lastMeal = days[k]?.lastMeal || PLAN.lastMeal;
  if (kind === 'fast') return `Comes a las ${lastMeal} y no cenas. El ayuno termina mañana a las ${endTime(k, days)}.`;
  if (kind === 'intense-start') return `Comes a las ${lastMeal} y no cenas. Empieza tu ayuno intenso de 30 h.`;
  if (kind === 'intense-end') return 'Sigues en ayuno y lo rompes con la cena de las 20:00.';
  return 'El domingo no tiene meta y no afecta tu racha.';
}

function endTime(k, days) {
  const f = fastFor(k, days);
  return f ? `${pad(f.end.getHours())}:${pad(f.end.getMinutes())}` : '';
}

export const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Horas de ayuno planeadas por semana: 4 × 16 + 30 = 94 */
export const WEEKLY_FAST_HOURS = 4 * PLAN.fastHours + PLAN.intenseHours;
