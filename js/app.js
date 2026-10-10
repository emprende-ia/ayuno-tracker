import {
  PLAN, DAY_NAMES, DAY_LETTERS, MONTHS, MONTHS_SHORT, WEEKLY_FAST_HOURS,
  toKey, fromKey, addDays, dowOf, mondayOf, isGoalDay, dayKind, getPhase, goalShort, goalLong, hhmm,
} from './schedule.js';
import { computeStats, MAX_SHIELDS } from './streaks.js';
import { loadState, saveState, serialize, parseBackup } from './store.js';
import { initSync, onSyncChange, syncInfo, notifyLocalChange, signIn, signOutSync, errorMessage } from './sync.js';
import { ringPaths, cookie, pointOnRing } from './shapes.js';

/* ---------- Estado ---------- */

const root = document.documentElement;
const hostTheme = root.getAttribute('data-theme');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

let today = toKey(new Date());
let state = loadState(today);
let stats = computeStats(state, today);
let view = viewFromHash();
let lastStreakShown = null;

const $ = (s, ctx = document) => ctx.querySelector(s);
const el = {
  view: $('#view'),
  title: $('#title'),
  subtitle: $('#subtitle'),
  topbar: $('#topbar'),
  sheet: $('#sheet'),
  snackbar: $('#snackbar'),
  themeBtn: $('#theme-btn'),
  syncBtn: $('#sync-btn'),
};

/* ---------- Utilidades de texto ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<span class="ms ${cls}" aria-hidden="true">${name}</span>`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function dayLabel(k, withMonth = true) {
  const d = fromKey(k);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()}${withMonth ? ` de ${MONTHS[d.getMonth()]}` : ''}`;
}
function rangeLabel(mon) {
  const a = fromKey(mon), b = fromKey(addDays(mon, 6));
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} al ${b.getDate()} de ${MONTHS[b.getMonth()]}`
    : `${a.getDate()} de ${MONTHS[a.getMonth()]} al ${b.getDate()} de ${MONTHS[b.getMonth()]}`;
}
function shortRange(mon) {
  const a = fromKey(mon), b = fromKey(addDays(mon, 6));
  return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`;
}
function split(ms) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  return { h: Math.floor(mins / 60), m: mins % 60 };
}
function durText(ms) {
  const { h, m } = split(ms);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
function durBig(ms) {
  const { h, m } = split(ms);
  return `<span class="n">${h}</span><span class="u">h</span><span class="n">${String(m).padStart(2, '0')}</span><span class="u">min</span>`;
}
function relDay(date) {
  const k = toKey(date);
  if (k === today) return 'hoy';
  if (k === addDays(today, 1)) return 'mañana';
  return `el ${DAY_NAMES[date.getDay()]}`;
}

const STATUS_LABEL = {
  done: 'Ayunaste',
  protected: 'Protegido',
  missed: 'No ayunaste',
  unlogged: 'Sin registrar',
  pending: 'Pendiente',
  rest: 'Descanso',
  'rest-future': 'Descanso',
  future: 'Próximo',
  before: 'Antes del registro',
};
const WEEK_LABEL = {
  progress: 'En curso',
  perfect: 'Semana perfecta',
  complete: 'Semana completa',
  failed: 'Semana incompleta',
  partial: 'Semana parcial',
};

const markable = (k) => isGoalDay(k) && k >= state.startDate && k <= today;

/* ---------- Formas ---------- */

const COOKIE_8 = cookie(40, 8, 0.08);
const COOKIE_9 = cookie(112, 9, 0.075);

function statusShape(st) {
  const glyph = {
    done: icon('check', 'fill'),
    protected: icon('shield', 'fill'),
    missed: icon('close'),
    unlogged: icon('question_mark'),
    rest: icon('bedtime'),
    'rest-future': icon('bedtime'),
  }[st] || '';
  const svg = st === 'done' ? `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="${COOKIE_8}"/></svg>` : '';
  return `<span class="shape s-${st}">${svg}${glyph}</span>`;
}

/* ---------- Vistas ---------- */

function render({ focus } = {}) {
  renderTopBar();
  renderNav();
  if (view === 'semana') el.view.innerHTML = viewWeek();
  else if (view === 'horario') el.view.innerHTML = viewSchedule();
  else el.view.innerHTML = viewToday();
  lastStreakShown = stats.streak;
  if (focus) $(focus)?.focus({ preventScroll: true });
}

function renderTopBar() {
  const titles = {
    hoy: ['Hoy', cap(dayLabel(today))],
    semana: ['Semana', `Del ${rangeLabel(mondayOf(today))}`],
    horario: ['Horario', '16:8 sin cena y ayuno intenso semanal'],
  };
  const [t, s] = titles[view];
  el.title.textContent = t;
  el.subtitle.textContent = s;
  document.title = view === 'hoy' ? 'Ayuno 16:8' : `${t} · Ayuno 16:8`;
  const dark = effectiveDark();
  el.themeBtn.innerHTML = icon(dark ? 'light_mode' : 'dark_mode');
  el.themeBtn.setAttribute('aria-label', dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
  renderSyncButton();
}

function syncLook(info = syncInfo()) {
  if (info.status === 'unavailable' && info.error === 'preview') return null;
  if (!info.user) return { icon: 'cloud_off', label: 'Sincronización desactivada. Abre Ajustes para iniciar sesión.', tone: 'off' };
  return {
    synced: { icon: 'cloud_done', label: 'Sincronizado', tone: 'ok' },
    pending: { icon: 'cloud_sync', label: 'Subiendo cambios', tone: 'busy' },
    connecting: { icon: 'cloud_sync', label: 'Sincronizando', tone: 'busy' },
    loading: { icon: 'cloud_sync', label: 'Sincronizando', tone: 'busy' },
    offline: { icon: 'cloud_off', label: 'Sin conexión. Tus cambios se suben cuando vuelva el internet.', tone: 'off' },
    error: { icon: 'sync_problem', label: errorMessage(info.error), tone: 'error' },
  }[info.status] || { icon: 'cloud_sync', label: 'Sincronizando', tone: 'busy' };
}

function renderSyncButton() {
  const look = syncLook();
  if (!el.syncBtn) return;
  el.syncBtn.hidden = !look;
  if (!look) return;
  el.syncBtn.innerHTML = icon(look.icon, look.tone === 'ok' ? 'fill' : '');
  el.syncBtn.dataset.tone = look.tone;
  el.syncBtn.setAttribute('aria-label', look.label);
  el.syncBtn.title = look.label;
}

function renderNav() {
  document.querySelectorAll('.nav-item').forEach((a) => {
    const on = a.dataset.view === view;
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

/* ----- Hoy ----- */

function viewToday() {
  const phase = getPhase(new Date(), state.days);
  return [
    state.onboarded ? '' : onboardingCard(),
    heroCard(phase),
    pendingCard(),
    unloggedCard(),
    todayCard(),
    streakCard(),
    weekCard(),
  ].join('');
}

function onboardingCard() {
  const mon = mondayOf(today);
  const fromMonday = mon !== today
    ? `<button class="btn tonal" type="button" data-act="onboard-monday">Desde el lunes ${fromKey(mon).getDate()}</button>`
    : '';
  return `<section class="card onboard" aria-labelledby="ob-title">
    <h2 id="ob-title">Empieza tu registro</h2>
    <p>Tu racha cuenta desde hoy. Si ya ayunaste días de esta semana, puedes registrar desde el lunes.</p>
    <div class="btn-row"><button class="btn filled" type="button" data-act="onboard-today">Empezar hoy</button>${fromMonday}</div>
    ${syncLook() && !syncInfo().user ? `<p class="muted small">¿Ya usas la app en otro dispositivo? <button class="link-btn" type="button" data-act="sign-in">Inicia sesión con Google</button> para traer tus registros.</p>` : ''}
  </section>`;
}

let ringShown = 0;

function heroCard(p) {
  const now = new Date();
  let chip, big = '', unit = '', line = '', progress = 0, markers = [], extra = '', action = '', label = '';
  const mealBtn = (k) => `<button class="btn text on-hero" type="button" data-act="meal" data-key="${k}">${icon('edit')}Ajustar mi última comida</button>`;

  if (p.kind === 'fast' || p.kind === 'intense') {
    const intense = p.kind === 'intense';
    chip = intense ? `${icon('bolt', 'fill')}Ayuno intenso` : `${icon('bedtime', 'fill')}Ayuno 16:8`;
    big = durBig(p.elapsed);
    unit = `de ${p.hours} h`;
    progress = p.elapsed / p.total;
    label = `Llevas ${durText(p.elapsed)} de ${p.hours} h de ayuno`;
    line = intense
      ? `Rompes el ayuno ${relDay(p.end)} a las ${hhmm(p.end)}. Faltan ${durText(p.end - now)}.`
      : `Tu ventana abre ${relDay(p.end)} a las ${hhmm(p.end)}. Faltan ${durText(p.end - now)}.`;
    if (intense) {
      markers = [16 / 30, 24 / 30];
      const ms = [16, 24, 30].map((h) => {
        const t = new Date(p.start.getTime() + h * 3600e3);
        const reached = p.elapsed >= h * 3600e3;
        return `<li class="${reached ? 'reached' : ''}">${reached ? icon('check') : ''}<b>${h} h</b><span>${hhmm(t)}</span></li>`;
      });
      extra = `<ol class="milestones" aria-label="Metas del ayuno intenso">${ms.join('')}</ol>`;
    }
    action = mealBtn(p.dayKey);
  } else if (p.kind === 'window') {
    chip = `${icon('restaurant', 'fill')}Ventana de comida`;
    big = durBig(p.end - now);
    unit = 'para cerrar';
    progress = p.elapsed / p.total;
    label = `Tu ventana de comida cierra en ${durText(p.end - now)}`;
    line = p.intenseNext
      ? `A las ${hhmm(p.end)} empieza tu ayuno intenso de 30 h.`
      : `Tu última comida es a las ${hhmm(p.end)}. Después no cenas.`;
    action = mealBtn(p.dayKey);
  } else if (p.kind === 'refeed') {
    chip = p.broken ? `${icon('bolt', 'fill')}Ayuno intenso` : `${icon('check')}Ayuno intenso cumplido`;
    big = '<span class="n">30</span><span class="u">h</span>';
    unit = 'de ayuno';
    progress = p.broken ? 0 : 1;
    label = p.broken ? 'El ayuno intenso no se completó' : 'Completaste 30 h de ayuno';
    line = p.broken ? 'Esta semana el ayuno intenso no se completó. Mañana descansas.' : 'Disfruta tu cena. Mañana es día de descanso.';
  } else {
    chip = `${icon('weekend', 'fill')}Descanso`;
    line = p.next
      ? `Tu siguiente ayuno empieza ${relDay(p.next.start)} a las ${hhmm(p.next.start)}.`
      : 'Hoy no hay meta.';
  }

  if (p.broken && p.kind !== 'refeed') {
    line = `Registraste este día como no ayunado. ${p.kind === 'window' ? 'Mañana vuelves al plan.' : ''}`.trim();
  }

  let visual;
  if (p.kind === 'rest') {
    visual = `<div class="rest-art" aria-hidden="true"><svg viewBox="0 0 112 112"><path d="${COOKIE_9}"/></svg>${icon('bedtime', 'fill')}</div>`;
  } else {
    const size = 280, stroke = 12;
    const shown = reduceMotion.matches ? progress : ringShown;
    const { active, track, c, r } = ringPaths({ size, stroke, progress: shown });
    const dots = markers.map((m) => {
      const [x, y] = pointOnRing(c, r, m);
      return `<circle class="marker ${progress >= m ? 'reached' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/>`;
    }).join('');
    visual = `<div class="ring" role="img" aria-label="${esc(label)}">
      <svg id="ring-svg" viewBox="0 0 ${size} ${size}" data-progress="${Math.min(1, Math.max(0, progress)).toFixed(4)}" aria-hidden="true">
        <path class="ring-track" d="${track}"/><path class="ring-active" d="${active}"/>${dots}
      </svg>
      <div class="ring-center" aria-hidden="true"><div class="big">${big}</div><div class="unit">${unit}</div></div>
    </div>`;
  }

  return `<section id="hero" class="hero" data-kind="${p.kind}"${p.broken ? ' data-broken' : ''} aria-label="Fase actual">
    <span class="hero-chip">${chip}</span>
    ${visual}
    <p class="hero-line">${line}</p>
    ${extra}
    ${action}
  </section>`;
}

function choiceGroup(k, size = '') {
  const rec = state.days[k];
  const yes = rec?.status === 'done';
  const no = rec?.status === 'missed';
  return `<div class="choice ${size}" role="group" aria-label="Registro del ${esc(dayLabel(k, false))}">
    <button class="btn yes" type="button" data-act="yes" data-key="${k}" aria-pressed="${yes}">${icon('check')}<span>Sí ayuné</span></button>
    <button class="btn no" type="button" data-act="no" data-key="${k}" aria-pressed="${no}">${icon('close')}<span>No ayuné</span></button>
  </div>`;
}

function todayCard() {
  const kind = dayKind(today);
  if (kind === 'rest') {
    return `<section class="card check is-rest" aria-labelledby="check-title">
      <h2 id="check-title">Hoy descansas</h2>
      <p class="muted">El domingo no tiene meta y no afecta tu racha. Mañana a las ${PLAN.lastMeal} empieza tu ayuno.</p>
    </section>`;
  }
  const st = stats.status[today];
  const title = kind === 'intense-end' ? '¿Aguantaste hasta las 20:00?' : '¿Hoy sí ayunaste?';
  let note = '';
  if (st === 'protected') note = `<p class="note">${icon('shield', 'fill')}Usaste un protector. Tu racha sigue.</p>`;
  else if (st === 'done') note = `<p class="note">${icon('check')}Registrado. ¡Bien hecho!</p>`;
  else if (st === 'missed') note = `<p class="note">${icon('close')}Registrado como no ayunado.</p>`;
  else if (kind !== 'intense-end') note = '<p class="note hint">Lo puedes registrar esta noche o mañana temprano.</p>';
  return `<section class="card check" aria-labelledby="check-title">
    <h2 id="check-title">${title}</h2>
    <p class="muted">${goalLong(today, state.days)}</p>
    ${choiceGroup(today)}
    ${note}
  </section>`;
}

function pendingCard() {
  const g = stats.grace;
  if (g === today || g < state.startDate || stats.status[g] !== 'pending') return '';
  const title = dayKind(g) === 'intense-end'
    ? '¿Aguantaste el sábado hasta las 20:00?'
    : `¿Cumpliste el ayuno del ${DAY_NAMES[dowOf(g)]}?`;
  return `<section class="card pending" aria-labelledby="pending-title">
    <h2 id="pending-title">${title}</h2>
    <p class="muted">${cap(dayLabel(g))}. ${goalShort(g)}.</p>
    ${choiceGroup(g, 'sm')}
  </section>`;
}

function unloggedCard() {
  const n = stats.unlogged.length;
  if (!n) return '';
  return `<section class="card warn" aria-labelledby="warn-title">
    <span class="warn-icon" aria-hidden="true">${icon('history')}</span>
    <div class="warn-text"><h2 id="warn-title">${plural(n, 'día sin registrar', 'días sin registrar')}</h2>
    <p>Cortan tu racha hasta que los registres.</p></div>
    <a class="btn tonal" href="#semana">Registrar</a>
  </section>`;
}

function streakCard() {
  const { streak, best, shields, weekStreak } = stats;
  const st = stats.status[today];
  let hint;
  if (dayKind(today) === 'rest') hint = 'Hoy descansas. Tu racha está a salvo.';
  else if (st === 'pending') hint = streak ? `Registra hoy para llegar a ${streak + 1}.` : 'Cada día con meta cumplido suma uno.';
  else if (st === 'done') hint = 'Mañana suma otro día.';
  else if (st === 'protected') hint = 'El protector la mantuvo en pie.';
  else hint = 'Cada día con meta cumplido suma uno.';
  const bump = lastStreakShown !== null && streak > lastStreakShown ? ' bump' : '';
  const slots = Array.from({ length: MAX_SHIELDS }, (_, i) =>
    `<span class="slot${i < shields ? ' on' : ''}">${icon('shield', i < shields ? 'fill' : '')}</span>`).join('');
  return `<section class="card streak" aria-labelledby="streak-title">
    <div class="streak-main">
      <div class="badge${bump}" aria-hidden="true">
        <svg viewBox="0 0 112 112"><path d="${COOKIE_9}"/></svg>
        <div class="badge-in">${icon('local_fire_department', 'fill')}<span class="badge-n">${streak}</span></div>
      </div>
      <div class="streak-text">
        <h2 id="streak-title">${streak ? plural(streak, 'día de racha', 'días de racha') : 'Sin racha todavía'}</h2>
        <p class="muted">${hint}</p>
      </div>
    </div>
    <dl class="stats">
      <div><dt>Mejor racha</dt><dd>${plural(best, 'día', 'días')}</dd></div>
      <div><dt>Semanas completas seguidas</dt><dd>${weekStreak}</dd></div>
    </dl>
    <div class="shields">
      <div class="slots" role="img" aria-label="${shields} de ${MAX_SHIELDS} protectores">${slots}</div>
      <div><p class="shields-t">Protectores: ${shields} de ${MAX_SHIELDS}</p>
      <p class="muted small">Ganas uno por cada semana perfecta: 6 de 6 sin usar protector.</p></div>
    </div>
  </section>`;
}

function weekCard() {
  const w = stats.weeks.at(-1);
  if (!w) return '';
  const strip = w.days.map((d) => dayDot(d)).join('');
  return `<section class="card week" aria-labelledby="week-title">
    <div class="card-head"><h2 id="week-title">Esta semana</h2><span class="count">${w.done + w.protected} de ${w.goalCount || 6}</span></div>
    <ol class="strip">${strip}</ol>
    <div class="week-foot">
      ${w.intense ? `<span class="chip fire">${icon('emoji_events', 'fill')}Ayuno intenso cumplido</span>` : `<span class="chip">${esc(WEEK_LABEL[w.state])}</span>`}
      <a class="btn text" href="#semana">Ver semana</a>
    </div>
  </section>`;
}

function dayDot(d) {
  const date = fromKey(d.key);
  const isToday = d.key === today;
  const can = markable(d.key);
  const lbl = `${cap(dayLabel(d.key))}: ${STATUS_LABEL[d.status]}${can ? '. Toca para registrar.' : ''}`;
  return `<li><button class="dot${isToday ? ' is-today' : ''}" type="button" ${can ? `data-act="day" data-key="${d.key}"` : 'disabled'} aria-label="${esc(lbl)}">
    <span class="dot-l">${DAY_LETTERS[date.getDay()]}</span>
    ${statusShape(d.status)}
    <span class="dot-n">${date.getDate()}</span>
  </button></li>`;
}

/* ----- Semana ----- */

function viewWeek() {
  const weeks = stats.weeks;
  const w = weeks.at(-1);
  if (!w) return '<section class="card"><p>Tu registro empieza pronto.</p></section>';
  const past = weeks.slice(0, -1).reverse();
  const segs = w.days.slice(0, 6).map((d) => `<span class="seg s-${d.status}"></span>`).join('');
  return `
  <section class="card week-hero" data-state="${w.state}" aria-labelledby="wk-title">
    <h2 id="wk-title" class="sr-only">Semana actual</h2>
    <div class="wk-count"><span class="n">${w.done + w.protected}</span><span class="of">de ${w.goalCount || 6} días</span></div>
    <div class="wk-chips">
      <span class="chip state">${esc(WEEK_LABEL[w.state])}</span>
      ${w.intense ? `<span class="chip fire">${icon('emoji_events', 'fill')}Ayuno intenso cumplido</span>` : ''}
      ${w.earnedShield ? `<span class="chip shield">${icon('shield', 'fill')}Ganaste un protector</span>` : ''}
    </div>
    <div class="segs" aria-hidden="true">${segs}</div>
  </section>
  <section class="card list" aria-label="Días de esta semana">
    <ul class="rows">${w.days.map(dayRow).join('')}</ul>
  </section>
  <section class="past" aria-labelledby="past-title">
    <h2 id="past-title" class="section-title">Semanas anteriores</h2>
    ${past.length ? `<ul class="weeks">${past.map(pastWeek).join('')}</ul>` : '<p class="muted empty">Cuando termine esta semana aparecerá aquí, con su resultado.</p>'}
  </section>`;
}

function dayRow(d) {
  const date = fromKey(d.key);
  const can = markable(d.key);
  const attrs = can ? `data-act="day" data-key="${d.key}"` : 'disabled';
  return `<li><button class="row" type="button" ${attrs}>
    ${statusShape(d.status)}
    <span class="row-text"><span class="row-title">${cap(DAY_NAMES[date.getDay()])} ${date.getDate()}${d.key === today ? ' <em>hoy</em>' : ''}</span>
    <span class="row-sub">${goalShort(d.key)}</span></span>
    <span class="row-status st-${d.status}">${STATUS_LABEL[d.status]}</span>
  </button></li>`;
}

function pastWeek(w) {
  const dots = w.days.map((d) => `<span class="mini s-${d.status}"></span>`).join('');
  return `<li><details class="week-item">
    <summary>
      <span class="wi-range">${shortRange(w.monday)}</span>
      <span class="wi-dots" aria-hidden="true">${dots}</span>
      <span class="wi-count">${w.done + w.protected}/${w.goalCount}</span>
      <span class="wi-state st-${w.state}">${esc(WEEK_LABEL[w.state])}</span>
      ${icon('expand_more', 'chev')}
    </summary>
    <ul class="rows">${w.days.map(dayRow).join('')}</ul>
  </details></li>`;
}

/* ----- Horario ----- */

const SEGMENTS = {
  1: [['free', 0, 6, 'Libre'], ['eat', 6, 14, 'Comida'], ['fast', 14, 24, 'Ayuno']],
  2: [['fast', 0, 6, ''], ['eat', 6, 14, 'Comida'], ['fast', 14, 24, 'Ayuno']],
  3: [['fast', 0, 6, ''], ['eat', 6, 14, 'Comida'], ['fast', 14, 24, 'Ayuno']],
  4: [['fast', 0, 6, ''], ['eat', 6, 14, 'Comida'], ['fast', 14, 24, 'Ayuno']],
  5: [['fast', 0, 6, ''], ['eat', 6, 14, 'Comida'], ['intense', 14, 24, 'Intenso']],
  6: [['intense', 0, 20, 'Ayuno intenso'], ['eat', 20, 24, 'Cena']],
  0: [['free', 0, 24, 'Descanso']],
};

function viewSchedule() {
  const now = new Date();
  const nowPct = ((now.getHours() + now.getMinutes() / 60) / 24) * 100;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const rows = order.map((dow) => {
    const segs = SEGMENTS[dow].map(([type, a, b, txt]) =>
      `<span class="tl-seg t-${type}" style="left:${(a / 24) * 100}%;width:${((b - a) / 24) * 100}%">${txt ? `<span>${txt}</span>` : ''}</span>`).join('');
    const isToday = now.getDay() === dow;
    return `<li class="tl-row${isToday ? ' is-today' : ''}">
      <span class="tl-day">${cap(DAY_NAMES[dow]).slice(0, 3)}</span>
      <span class="tl-bar">${segs}${isToday ? `<span class="tl-now" style="left:${nowPct.toFixed(2)}%" aria-hidden="true"></span>` : ''}</span>
    </li>`;
  }).join('');
  const ticks = [[0, '00'], [6, '06'], [14, '14'], [20, '20'], [24, '24']]
    .map(([h, t]) => `<span style="left:${(h / 24) * 100}%">${t}</span>`).join('');

  return `
  <section class="card timeline" aria-labelledby="tl-title">
    <h2 id="tl-title">Tu semana</h2>
    <div class="tl" role="img" aria-label="Lunes a jueves ayuno de 14:00 a 06:00. Viernes 14:00 a sábado 20:00 ayuno intenso. Domingo descanso.">
      <div class="tl-axis" aria-hidden="true"><span class="tl-day"></span><span class="tl-ticks">${ticks}</span></div>
      <ol class="tl-rows" aria-hidden="true">${rows}</ol>
    </div>
    <ul class="legend" aria-hidden="true">
      <li><i class="t-fast"></i>Ayuno 16:8</li><li><i class="t-intense"></i>Ayuno intenso</li>
      <li><i class="t-eat"></i>Comida</li><li><i class="t-free"></i>Descanso</li>
    </ul>
  </section>

  <section class="card facts" aria-labelledby="plan-title">
    <h2 id="plan-title">El plan</h2>
    <dl>
      <div><dt>Lunes a jueves</dt><dd>Comes de 06:00 a 14:00 y no cenas. Ayunas 16 h, hasta las 06:00 del día siguiente.</dd></div>
      <div><dt>Viernes a sábado</dt><dd>Después de la comida del viernes a las 14:00 ayunas 30 h y rompes con la cena del sábado a las 20:00.</dd></div>
      <div><dt>Domingo</dt><dd>Descanso. Comes libre y no hay meta.</dd></div>
      <div><dt>Por semana</dt><dd>${WEEKLY_FAST_HOURS} h de ayuno.</dd></div>
    </dl>
  </section>

  <section class="card rules" aria-labelledby="rules-title">
    <h2 id="rules-title">Cómo se cuenta</h2>
    <h3>Registro</h3>
    <p>Cada ayuno cuenta para el día en que no cenas. Si el lunes dices «sí ayuné», comiste a las 14:00 y no comes hasta el martes a las 06:00. Lo puedes registrar esa noche o a la mañana siguiente.</p>
    <h3>Racha</h3>
    <p>Suma un día por cada día con meta cumplido y «no ayuné» la reinicia. El domingo no suma ni corta. Un día viejo sin registrar la corta hasta que lo registres; hoy y el día anterior tienen margen.</p>
    <h3>Protectores</h3>
    <p>Tienes máximo ${MAX_SHIELDS} y empiezas con 1. Ganas uno por cada semana perfecta, 6 de 6 sin protector. Al marcar «no ayuné» puedes usar uno: el día queda registrado tal cual y la racha sigue, sin sumar.</p>
    <h3>Semana</h3>
    <p>Se completa con los 6 días con meta cumplidos o protegidos. Las semanas completas seguidas forman tu racha semanal.</p>
  </section>

  <aside class="health">${icon('info')}<p>Para el ayuno de 30 h ayuda tomar agua, café o té sin azúcar y algo de sal o electrolitos. Si tomas medicamento para la glucosa o la presión, consúltalo con tu médico.</p></aside>`;
}

/* ---------- Acciones ---------- */

function commit(mutate, opts) {
  mutate(state);
  const ok = saveState(state);
  stats = computeStats(state, today);
  render(opts);
  notifyLocalChange();
  if (!ok) toast('No se pudo guardar en este navegador. Exporta una copia desde Ajustes.');
}

function mark(k, status, shield = false) {
  const prev = state.days[k] ? { ...state.days[k] } : null;
  const before = stats;
  commit((s) => {
    const rec = { ...(s.days[k] || {}) };
    delete rec.shield;
    rec.status = status;
    if (status === 'missed' && shield) rec.shield = true;
    rec.at = new Date().toISOString();
    rec.u = Date.now();
    s.days[k] = rec;
  }, { focus: `[data-act="${status === 'done' ? 'yes' : 'no'}"][data-key="${k}"]` });

  const who = k === today ? 'Hoy' : cap(dayLabel(k, false));
  let msg;
  if (status === 'done') msg = `${who}: ayunaste.`;
  else if (stats.status[k] === 'protected') msg = `${who}: usaste un protector. Tu racha sigue.`;
  else msg = `${who}: no ayunaste.`;
  if (stats.shields > before.shields && status === 'done') msg += ' Ganaste un protector.';
  toast(msg, { action: 'Deshacer', onAction: () => restore(k, prev) });
}

function clearDay(k) {
  const prev = state.days[k] ? { ...state.days[k] } : null;
  commit((s) => {
    const rec = { ...(s.days[k] || {}) };
    delete rec.status; delete rec.shield; delete rec.at;
    rec.u = Date.now(); // el borrado también se sincroniza
    s.days[k] = rec;
  });
  toast('Registro borrado.', { action: 'Deshacer', onAction: () => restore(k, prev) });
}

function restore(k, prev) {
  commit((s) => {
    s.days[k] = prev ? { ...prev, u: Date.now() } : { u: Date.now() };
  });
}

function askMissed(k) {
  const available = stats.shieldsBefore[k] ?? 0;
  if (available > 0) openShieldSheet(k, available);
  else mark(k, 'missed');
}

/* ---------- Hojas (bottom sheets) ---------- */

function openSheet(html, label) {
  el.sheet.innerHTML = `<div class="sheet-body"><div class="sheet-handle" aria-hidden="true"></div>${html}</div>`;
  el.sheet.setAttribute('aria-label', label);
  if (!el.sheet.open) el.sheet.showModal();
  el.sheet.querySelector('[autofocus]')?.focus();
}

function closeSheet() {
  if (!el.sheet.open) return;
  if (reduceMotion.matches) return el.sheet.close();
  el.sheet.classList.add('closing');
  setTimeout(() => {
    el.sheet.close();
    el.sheet.classList.remove('closing');
  }, 160);
}

function openDaySheet(k) {
  const st = stats.status[k];
  const rec = state.days[k];
  const title = cap(dayLabel(k));
  openSheet(`
    <h2 class="sheet-title">${title}</h2>
    <p class="muted">${goalLong(k, state.days)}</p>
    <p class="sheet-status st-${st}">${statusShape(st)}<span>${STATUS_LABEL[st]}</span></p>
    ${choiceGroup(k)}
    ${rec?.status ? `<button class="btn text danger" type="button" data-act="clear" data-key="${k}">${icon('delete')}Borrar registro</button>` : ''}
  `, title);
}

function openShieldSheet(k, available) {
  const kept = computeStats({ ...state, days: { ...state.days, [k]: { ...(state.days[k] || {}), status: 'missed', shield: true } } }, today).streak;
  const recent = k === today || k === stats.grace;
  const who = k === today ? 'Hoy' : `El ${dayLabel(k)}`;
  let keeps;
  if (!recent) keeps = 'tu racha no se corta ese día';
  else if (kept) keeps = `tu racha de ${plural(kept, 'día', 'días')} sigue`;
  else keeps = 'tu semana sigue en pie';
  openSheet(`
    <div class="sheet-art" aria-hidden="true">${icon('shield', 'fill')}</div>
    <h2 class="sheet-title center">¿Usas un protector?</h2>
    <p class="muted center">${who} queda registrado como no ayunado, pero ${keeps}. Tienes ${available} de ${MAX_SHIELDS}.</p>
    <div class="sheet-actions">
      <button class="btn text" type="button" data-act="miss-plain" data-key="${k}">No, reiniciar racha</button>
      <button class="btn filled" type="button" data-act="miss-shield" data-key="${k}" autofocus>${icon('shield', 'fill')}Usar protector</button>
    </div>
  `, 'Usar protector');
}

function openMealSheet(k) {
  const current = state.days[k]?.lastMeal || PLAN.lastMeal;
  const intense = dayKind(k) === 'intense-start';
  openSheet(`
    <h2 class="sheet-title">Tu última comida</h2>
    <p class="muted">Si terminaste de comer más tarde, el ayuno del ${dayLabel(k, false)} empieza a esa hora y dura ${intense ? 30 : 16} h.</p>
    <form class="meal-form" data-key="${k}">
      <label class="field"><span>Terminé de comer a las</span>
        <input id="meal-time" type="time" value="${current}" required step="300"></label>
      <p class="field-error" id="meal-error" hidden>Escribe una hora válida, por ejemplo 14:30.</p>
      <div class="sheet-actions">
        <button class="btn text" type="button" data-act="meal-reset" data-key="${k}">Volver a las ${PLAN.lastMeal}</button>
        <button class="btn filled" type="submit">Guardar hora</button>
      </div>
    </form>
  `, 'Ajustar última comida');
}

function openSettings() {
  const t = state.theme;
  const opt = (v, ic, txt) =>
    `<button type="button" role="radio" aria-checked="${t === v}" data-act="set-theme" data-value="${v}">${icon(ic)}<span>${txt}</span></button>`;
  openSheet(`
    <h2 class="sheet-title">Ajustes</h2>
    <section class="set-group" id="sync-section" aria-live="polite">${syncSection()}</section>
    <section class="set-group">
      <h3>Tema</h3>
      <div class="segmented" role="radiogroup" aria-label="Tema">${opt('system', 'brightness_auto', 'Sistema')}${opt('light', 'light_mode', 'Claro')}${opt('dark', 'dark_mode', 'Oscuro')}</div>
    </section>
    <section class="set-group">
      <h3><label for="start-date">Inicio del registro</label></h3>
      <p class="muted small">Los días anteriores no cuentan para tu racha.</p>
      <input class="input" id="start-date" type="date" value="${state.startDate}" max="${today}">
    </section>
    <section class="set-group">
      <h3>Tus datos</h3>
      <p class="muted small">${syncInfo().user ? 'Se guardan en este dispositivo y en tu cuenta. También puedes exportar una copia en archivo.' : 'Se guardan solo en este navegador. Inicia sesión para guardarlos en la nube, o exporta una copia en archivo.'}</p>
      <div class="btn-row">
        <button class="btn tonal" type="button" data-act="export">${icon('download')}Exportar copia</button>
        <button class="btn tonal" type="button" data-act="import">${icon('upload')}Importar copia</button>
      </div>
      <input id="import-file" type="file" accept=".json,application/json" hidden>
      <button class="btn text danger" type="button" data-act="reset">${icon('delete')}Borrar todos los registros</button>
    </section>
  `, 'Ajustes');
}

function syncSection() {
  const info = syncInfo();
  const look = syncLook(info);
  if (!look) {
    return `<h3>Sincronización</h3><p class="muted small">${errorMessage('preview')}</p>`;
  }
  const err = info.error && info.error !== 'preview' ? `<p class="field-error">${esc(errorMessage(info.error))}</p>` : '';
  if (!info.user) {
    const loading = info.status === 'loading' || info.status === 'off';
    return `<h3>Sincronización</h3>
      <p class="muted small">Inicia sesión con Google para guardar tus registros en la nube y verlos en tu celular y tu computadora.</p>
      <div class="btn-row"><button class="btn filled" type="button" data-act="sign-in" ${loading || info.status === 'unavailable' ? 'disabled' : ''}>${icon('login')}Iniciar sesión con Google</button></div>
      ${info.status === 'unavailable' && info.error === 'sdk' ? `<p class="field-error">${esc(errorMessage('sdk'))}</p>` : err}`;
  }
  const u = info.user;
  const initial = esc((u.name || u.email || '?').trim().charAt(0).toUpperCase());
  const when = info.status === 'synced' && info.lastSync ? ` a las ${hhmm(new Date(info.lastSync))}` : '';
  return `<h3>Sincronización</h3>
    <div class="account">
      <span class="avatar" aria-hidden="true">${initial}</span>
      <div class="account-text"><p class="account-name">${esc(u.name || 'Tu cuenta')}</p><p class="muted small">${esc(u.email)}</p></div>
    </div>
    <p class="sync-line" data-tone="${look.tone}">${icon(look.icon, look.tone === 'ok' ? 'fill' : '')}<span>${esc(look.tone === 'ok' ? `Sincronizado${when}` : look.label)}</span></p>
    <button class="btn text" type="button" data-act="sign-out">${icon('logout')}Cerrar sesión</button>`;
}

function openResetConfirm() {
  const n = Object.values(state.days).filter((d) => d.status).length;
  openSheet(`
    <h2 class="sheet-title">¿Borrar todos los registros?</h2>
    <p class="muted">Se borran ${plural(n, 'día registrado', 'días registrados')}, tu racha y tus protectores. No se puede deshacer, así que exporta una copia antes si la quieres conservar.</p>
    <div class="sheet-actions">
      <button class="btn text" type="button" data-act="settings">Cancelar</button>
      <button class="btn filled danger-fill" type="button" data-act="reset-confirm">Borrar todo</button>
    </div>
  `, 'Borrar registros');
}

/* ---------- Tema ---------- */

function effectiveDark() {
  const a = root.getAttribute('data-theme');
  return a ? a === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme() {
  if (state.theme === 'system') {
    if (hostTheme) root.setAttribute('data-theme', hostTheme);
    else root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', state.theme);
  }
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--md-sys-color-surface').trim());
}

/* ---------- Snackbar ---------- */

let toastTimer;
function toast(msg, { action, onAction } = {}) {
  clearTimeout(toastTimer);
  el.snackbar.innerHTML = `<span class="sb-text">${esc(msg)}</span>${action ? `<button class="btn text" type="button" id="sb-action">${esc(action)}</button>` : ''}`;
  el.snackbar.classList.add('show');
  const btn = $('#sb-action');
  if (btn) btn.onclick = () => { hideToast(); onAction?.(); };
  toastTimer = setTimeout(hideToast, action ? 6000 : 4000);
}
function hideToast() {
  el.snackbar.classList.remove('show');
}

/* ---------- Detalles expresivos ---------- */

function burst(x, y) {
  if (reduceMotion.matches) return;
  const colors = ['var(--md-sys-color-primary)', 'var(--md-sys-color-tertiary)', 'var(--app-fire)', 'var(--md-sys-color-secondary)'];
  const shapes = ['b-circle', 'b-square', 'b-pill'];
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('span');
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 56 + Math.random() * 64;
    s.className = `burst ${shapes[i % 3]}`;
    s.style.cssText = `left:${x}px;top:${y}px;background:${colors[i % 4]};--dx:${Math.cos(a) * dist}px;--dy:${Math.sin(a) * dist}px;--rot:${Math.random() * 300 - 150}deg`;
    s.addEventListener('animationend', () => s.remove());
    document.body.appendChild(s);
  }
}

let lastFrame = 0;
function ringLoop(t) {
  requestAnimationFrame(ringLoop);
  if (document.hidden || t - lastFrame < 33) return;
  lastFrame = t;
  const svg = document.getElementById('ring-svg');
  if (!svg) return;
  const target = Number(svg.dataset.progress);
  const still = reduceMotion.matches;
  ringShown = still ? target : ringShown + (target - ringShown) * 0.12;
  if (Math.abs(target - ringShown) < 0.0005) ringShown = target;
  const { active, track } = ringPaths({ size: 280, stroke: 12, progress: ringShown, phase: still ? 0 : (t / 1000) * 1.6 });
  svg.querySelector('.ring-active').setAttribute('d', active);
  svg.querySelector('.ring-track').setAttribute('d', track);
}

/* ---------- Navegación ---------- */

function viewFromHash() {
  const h = location.hash.replace('#', '');
  return ['hoy', 'semana', 'horario'].includes(h) ? h : 'hoy';
}

function go(next) {
  if (next === view) return;
  const swap = () => {
    view = next;
    render();
    window.scrollTo({ top: 0 });
  };
  if (document.startViewTransition && !reduceMotion.matches) document.startViewTransition(swap);
  else swap();
}

/* ---------- Eventos ---------- */

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t || t.disabled) return;
  const k = t.dataset.key;
  switch (t.dataset.act) {
    case 'yes': {
      if (state.days[k]?.status === 'done') break;
      t.setAttribute('aria-pressed', 'true');
      t.parentElement.querySelector('.no')?.setAttribute('aria-pressed', 'false');
      const r = t.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2);
      navigator.vibrate?.(12);
      setTimeout(() => {
        if (el.sheet.open) closeSheet();
        mark(k, 'done');
      }, reduceMotion.matches ? 0 : 320);
      break;
    }
    case 'no': {
      if (state.days[k]?.status === 'missed') break;
      if ((stats.shieldsBefore[k] ?? 0) > 0) {
        askMissed(k);
      } else {
        t.setAttribute('aria-pressed', 'true');
        t.parentElement.querySelector('.yes')?.setAttribute('aria-pressed', 'false');
        setTimeout(() => {
          if (el.sheet.open) closeSheet();
          mark(k, 'missed');
        }, reduceMotion.matches ? 0 : 260);
      }
      break;
    }
    case 'miss-shield': closeSheet(); mark(k, 'missed', true); break;
    case 'miss-plain': closeSheet(); mark(k, 'missed'); break;
    case 'day': openDaySheet(k); break;
    case 'clear': closeSheet(); clearDay(k); break;
    case 'meal': openMealSheet(k); break;
    case 'meal-reset':
      closeSheet();
      commit((s) => {
        if (!s.days[k]) return;
        delete s.days[k].lastMeal;
        s.days[k].u = Date.now();
      });
      toast(`Última comida: ${PLAN.lastMeal}.`);
      break;
    case 'settings': openSettings(); break;
    case 'sign-in':
      t.disabled = true;
      signIn().catch(() => {}).finally(() => { t.disabled = false; });
      break;
    case 'sign-out':
      signOutSync().then(() => toast('Sesión cerrada. Tus registros siguen en este dispositivo.'));
      break;
    case 'theme':
      state.theme = effectiveDark() ? 'light' : 'dark';
      saveState(state);
      applyTheme();
      renderTopBar();
      break;
    case 'set-theme':
      state.theme = t.dataset.value;
      saveState(state);
      applyTheme();
      renderTopBar();
      t.parentElement.querySelectorAll('[role="radio"]').forEach((b) => b.setAttribute('aria-checked', String(b === t)));
      break;
    case 'export': exportBackup(); break;
    case 'import': $('#import-file')?.click(); break;
    case 'reset': openResetConfirm(); break;
    case 'reset-confirm':
      closeSheet();
      commit((s) => {
        const now = Date.now();
        for (const key of Object.keys(s.days)) s.days[key] = { u: now };
        s.startDate = today;
        s.startDateU = now;
      });
      toast('Registros borrados. Tu registro empieza hoy.');
      break;
    case 'onboard-today':
      commit((s) => { s.onboarded = true; s.startDate = today; s.startDateU = Date.now(); });
      toast('Listo. Tu racha cuenta desde hoy.');
      break;
    case 'onboard-monday':
      commit((s) => { s.onboarded = true; s.startDate = mondayOf(today); s.startDateU = Date.now(); });
      toast('Registra los días que ya pasaron desde la pestaña Semana.');
      break;
    default: break;
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('.meal-form');
  if (!form) return;
  e.preventDefault();
  const input = $('#meal-time');
  const v = input.value;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
    $('#meal-error').hidden = false;
    input.focus();
    return;
  }
  const k = form.dataset.key;
  closeSheet();
  commit((s) => {
    s.days[k] = { ...(s.days[k] || {}), u: Date.now() };
    if (v === PLAN.lastMeal) delete s.days[k].lastMeal;
    else s.days[k].lastMeal = v;
  });
  toast(`Última comida: ${v}.`);
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'meal-time') $('#meal-error').hidden = true;
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'start-date') {
    const v = e.target.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v > today) {
      toast('Elige una fecha de hoy o anterior.');
      e.target.value = state.startDate;
      return;
    }
    commit((s) => { s.startDate = v; s.startDateU = Date.now(); s.onboarded = true; });
    toast(`Registro desde el ${dayLabel(v)}.`);
  }
  if (e.target.id === 'import-file') {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const next = parseBackup(text, today);
      const now = Date.now();
      // Lo importado gana sobre lo que haya en la nube; los días que ya no vienen se borran
      for (const key of Object.keys(state.days)) if (!next.days[key]) next.days[key] = { u: now };
      for (const key of Object.keys(next.days)) next.days[key].u = now;
      next.startDateU = now;
      next.theme = state.theme;
      state = next;
      saveState(state);
      notifyLocalChange();
      stats = computeStats(state, today);
      applyTheme();
      closeSheet();
      render();
      const n = Object.values(state.days).filter((d) => d.status).length;
      toast(`Copia importada: ${plural(n, 'día registrado', 'días registrados')}.`);
    }).catch((err) => toast(err.message || 'No se pudo leer el archivo.'));
  }
});

function exportBackup() {
  if (window.__AYUNO_PREVIEW__) {
    toast('En la vista previa no se pueden descargar archivos. Exporta desde la versión publicada.');
    return;
  }
  try {
    const blob = new Blob([serialize(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ayuno-copia-${today}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Copia exportada.');
  } catch {
    toast('Este navegador no permitió descargar la copia.');
  }
}

el.sheet.addEventListener('click', (e) => {
  if (e.target === el.sheet) closeSheet();
});

window.addEventListener('hashchange', () => go(viewFromHash()));

window.addEventListener('scroll', () => {
  el.topbar.classList.toggle('scrolled', window.scrollY > 4);
}, { passive: true });

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  applyTheme();
  renderTopBar();
});

/* ---------- Reloj ---------- */

function tick() {
  const k = toKey(new Date());
  if (k !== today) {
    today = k;
    stats = computeStats(state, today);
    render();
    return;
  }
  if (view === 'hoy' && !el.sheet.open) {
    const hero = $('#hero');
    if (hero) hero.outerHTML = heroCard(getPhase(new Date(), state.days));
  }
  if (view === 'horario') {
    const line = $('.tl-now');
    const now = new Date();
    if (line) line.style.left = `${(((now.getHours() + now.getMinutes() / 60) / 24) * 100).toFixed(2)}%`;
  }
}
setInterval(tick, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

/* ---------- Arranque ---------- */

applyTheme();
render();
requestAnimationFrame(ringLoop);

let wasSignedIn = false;
onSyncChange((info) => {
  renderSyncButton();
  const section = $('#sync-section');
  if (section && el.sheet.open) section.innerHTML = syncSection();
  if (info.user && !wasSignedIn) toast(`Sesión iniciada${info.user.name ? ` como ${info.user.name}` : ''}. Tus registros se sincronizan.`);
  if (!info.user && info.status === 'signed-out' && wasSignedIn) render();
  if (view === 'hoy' && !state.onboarded) render();
  wasSignedIn = !!info.user;
});

initSync({
  getState: () => state,
  today: () => today,
  applyRemote(merged, first) {
    const had = Object.values(state.days).filter((d) => d.status).length;
    state = { ...merged, theme: state.theme };
    saveState(state);
    stats = computeStats(state, today);
    render();
    const now = Object.values(state.days).filter((d) => d.status).length;
    if (first && now > had) toast(`Se cargaron ${plural(now - had, 'día', 'días')} desde tu cuenta.`);
  },
});

if ('serviceWorker' in navigator && !window.__AYUNO_PREVIEW__ && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
