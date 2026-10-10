// Rachas, semanas y protectores.
// Todo se calcula desde los registros guardados, nunca se acumula a mano:
// si corriges un día pasado, la racha se recalcula sola.
//
// Reglas
//   · Un día con meta (lun–sáb) marcado "sí ayuné" suma 1 a la racha.
//   · "No ayuné" reinicia la racha, salvo que uses un protector: el día queda
//     registrado como no ayunado y la racha se conserva (no suma).
//   · El domingo es descanso: no suma ni corta.
//   · Hoy y el último día con meta antes de hoy pueden quedar pendientes sin
//     cortar la racha. Un día más viejo sin registrar la corta hasta que lo registres.
//   · Protectores: empiezas con 1, máximo 2. Ganas 1 por cada semana perfecta
//     (6 de 6 "sí ayuné", sin protectores).
//   · Semana completa: los 6 días con meta cumplidos o protegidos.

import { addDays, dowOf, mondayOf, isGoalDay } from './schedule.js';

export const MAX_SHIELDS = 2;
export const START_SHIELDS = 1;

export function previousGoalDay(k) {
  let p = addDays(k, -1);
  while (!isGoalDay(p)) p = addDays(p, -1);
  return p;
}

/**
 * @param {{startDate: string, days: Record<string, {status?: 'done'|'missed', shield?: boolean}>}} state
 * @param {string} today 'YYYY-MM-DD'
 */
export function computeStats(state, today) {
  const startDate = state.startDate;
  const days = state.days || {};
  const status = {};
  const shieldsBefore = {};
  const events = [];
  const grace = previousGoalDay(today);

  let shields = START_SHIELDS;
  let streak = 0;
  let best = 0;

  for (let k = startDate; k <= today; k = addDays(k, 1)) {
    if (!isGoalDay(k)) {
      status[k] = 'rest';
      continue;
    }
    shieldsBefore[k] = shields;
    const rec = days[k];

    if (rec?.status === 'done') {
      streak++;
      status[k] = 'done';
    } else if (rec?.status === 'missed') {
      if (rec.shield && shields > 0) {
        shields--;
        status[k] = 'protected';
        events.push({ key: k, type: 'used' });
      } else {
        streak = 0;
        status[k] = 'missed';
        if (rec.shield) events.push({ key: k, type: 'unavailable' });
      }
    } else if (k === today || k === grace) {
      status[k] = 'pending';
    } else {
      status[k] = 'unlogged';
      streak = 0;
    }
    best = Math.max(best, streak);

    // Cierre de semana: el sábado decide si la semana fue perfecta.
    if (dowOf(k) === 6) {
      const mon = mondayOf(k);
      let perfect = mon >= startDate;
      for (let i = 0; i < 6 && perfect; i++) if (status[addDays(mon, i)] !== 'done') perfect = false;
      if (perfect) {
        if (shields < MAX_SHIELDS) {
          shields++;
          events.push({ key: k, type: 'earned' });
        } else {
          events.push({ key: k, type: 'capped' });
        }
      }
    }
  }

  // Semanas, de la más vieja a la actual
  const weeks = [];
  if (startDate <= today) {
    for (let mon = mondayOf(startDate); mon <= mondayOf(today); mon = addDays(mon, 7)) {
      const list = [];
      for (let i = 0; i < 7; i++) {
        const k = addDays(mon, i);
        let st;
        if (k < startDate) st = 'before';
        else if (k > today) st = i === 6 ? 'rest-future' : 'future';
        else st = status[k];
        list.push({ key: k, status: st });
      }
      const goal = list.slice(0, 6).filter((d) => d.status !== 'before');
      const done = goal.filter((d) => d.status === 'done').length;
      const prot = goal.filter((d) => d.status === 'protected').length;
      const failed = goal.some((d) => d.status === 'missed' || d.status === 'unlogged');
      const resolved = goal.length > 0 && goal.every((d) => d.status === 'done' || d.status === 'protected');
      let weekState = 'progress';
      if (failed) weekState = 'failed';
      else if (resolved) weekState = goal.length < 6 ? 'partial' : prot === 0 ? 'perfect' : 'complete';
      weeks.push({
        monday: mon,
        days: list,
        done,
        protected: prot,
        goalCount: goal.length,
        state: weekState,
        intense: list[4].status === 'done' && list[5].status === 'done',
        earnedShield: events.some((e) => e.type === 'earned' && e.key === addDays(mon, 5)),
      });
    }
  }

  let weekStreak = 0;
  let bestWeekStreak = 0;
  for (const w of weeks) {
    if (w.state === 'perfect' || w.state === 'complete') weekStreak++;
    else if (w.state === 'failed') weekStreak = 0;
    bestWeekStreak = Math.max(bestWeekStreak, weekStreak);
  }

  const unlogged = Object.keys(status).filter((k) => status[k] === 'unlogged').sort();

  return { status, streak, best, shields, weekStreak, bestWeekStreak, weeks, grace, shieldsBefore, events, unlogged };
}
