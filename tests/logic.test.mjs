// Pruebas de la lógica de horario y rachas: `npm test` (Node 20+)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPhase, fastFor, mondayOf, addDays, WEEKLY_FAST_HOURS } from '../js/schedule.js';
import { computeStats } from '../js/streaks.js';

// Semana de referencia: lunes 5 a domingo 11 de octubre de 2026
const MON = '2026-10-05';
const d = (i) => addDays(MON, i);
const at = (k, h, m = 0) => { const [y, mo, da] = k.split('-').map(Number); return new Date(y, mo - 1, da, h, m); };
const done = (...ks) => Object.fromEntries(ks.map((k) => [k, { status: 'done' }]));

test('el plan suma 94 h de ayuno por semana', () => {
  assert.equal(WEEKLY_FAST_HOURS, 94);
});

test('lunes a jueves: ayuno de 14:00 a 06:00 (16 h)', () => {
  const f = fastFor(d(0));
  assert.equal(f.hours, 16);
  assert.equal(f.start.getHours(), 14);
  assert.equal(f.end.getDate(), 6);
  assert.equal(f.end.getHours(), 6);
});

test('viernes 14:00 a sábado 20:00 (30 h)', () => {
  const f = fastFor(d(4));
  assert.equal(f.hours, 30);
  assert.equal(f.end.getDay(), 6);
  assert.equal(f.end.getHours(), 20);
});

test('fases a lo largo de la semana', () => {
  assert.equal(getPhase(at(d(0), 3)).kind, 'rest'); // lunes de madrugada, viene del domingo
  assert.equal(getPhase(at(d(0), 9)).kind, 'window');
  assert.equal(getPhase(at(d(0), 15)).kind, 'fast');
  assert.equal(getPhase(at(d(1), 5)).kind, 'fast'); // martes 05:00 sigue el ayuno del lunes
  assert.equal(getPhase(at(d(1), 6)).kind, 'window');
  assert.equal(getPhase(at(d(4), 13)).kind, 'window');
  assert.equal(getPhase(at(d(4), 13)).intenseNext, true);
  assert.equal(getPhase(at(d(4), 18)).kind, 'intense');
  const sat = getPhase(at(d(5), 9, 46));
  assert.equal(sat.kind, 'intense');
  assert.equal(Math.round(sat.elapsed / 60000), 19 * 60 + 46);
  assert.equal(getPhase(at(d(5), 21)).kind, 'refeed');
  assert.equal(getPhase(at(d(6), 12)).kind, 'rest');
});

test('ajustar la última comida corre el ayuno y la ventana siguiente', () => {
  const days = { [d(1)]: { lastMeal: '14:40' } };
  const f = fastFor(d(1), days);
  assert.equal(f.end.getHours(), 6);
  assert.equal(f.end.getMinutes(), 40);
  assert.equal(getPhase(at(d(2), 6, 20), days).kind, 'fast');
  assert.equal(getPhase(at(d(2), 6, 41), days).kind, 'window');
});

test('mondayOf', () => {
  assert.equal(mondayOf('2026-10-10'), MON);
  assert.equal(mondayOf('2026-10-11'), MON);
  assert.equal(mondayOf(MON), MON);
});

test('racha: suma días cumplidos y el domingo no corta', () => {
  const days = done(d(0), d(1), d(2), d(3), d(4), d(5), d(7));
  const s = computeStats({ startDate: MON, days }, d(7));
  assert.equal(s.streak, 7);
  assert.equal(s.status[d(6)], 'rest');
});

test('semana perfecta da un protector (máximo 2)', () => {
  const week1 = done(d(0), d(1), d(2), d(3), d(4), d(5));
  let s = computeStats({ startDate: MON, days: week1 }, d(6));
  assert.equal(s.shields, 2); // 1 inicial + 1 ganado
  assert.equal(s.weeks[0].state, 'perfect');
  assert.equal(s.weekStreak, 1);

  const week2 = { ...week1, ...done(d(7), d(8), d(9), d(10), d(11), d(12)) };
  s = computeStats({ startDate: MON, days: week2 }, d(13));
  assert.equal(s.shields, 2); // tope
  assert.ok(s.events.some((e) => e.type === 'capped'));
  assert.equal(s.weekStreak, 2);
});

test('protector conserva la racha y la semana queda completa, no perfecta', () => {
  const days = { ...done(d(0), d(1), d(3), d(4), d(5)), [d(2)]: { status: 'missed', shield: true } };
  const s = computeStats({ startDate: MON, days }, d(6));
  assert.equal(s.status[d(2)], 'protected');
  assert.equal(s.streak, 5);
  assert.equal(s.shields, 0);
  assert.equal(s.weeks[0].state, 'complete');
  assert.equal(s.weekStreak, 1);
});

test('sin protectores, "no ayuné" reinicia la racha', () => {
  const days = {
    ...done(d(0)),
    [d(1)]: { status: 'missed', shield: true }, // usa el inicial
    [d(2)]: { status: 'missed', shield: true }, // ya no hay
    ...done(d(3)),
  };
  const s = computeStats({ startDate: MON, days }, d(3));
  assert.equal(s.status[d(1)], 'protected');
  assert.equal(s.status[d(2)], 'missed');
  assert.equal(s.streak, 1);
  assert.equal(s.best, 1);
  assert.equal(s.weeks[0].state, 'failed');
});

test('día viejo sin registrar corta la racha; hoy y el día anterior quedan pendientes', () => {
  const days = done(d(0), d(2));
  // jueves: miércoles es el día de gracia, lunes cumplido, martes sin registrar
  let s = computeStats({ startDate: MON, days }, d(3));
  assert.equal(s.status[d(1)], 'unlogged');
  assert.equal(s.status[d(3)], 'pending');
  assert.equal(s.streak, 1);
  assert.deepEqual(s.unlogged, [d(1)]);

  // lunes siguiente: el sábado anterior sigue en gracia
  s = computeStats({ startDate: MON, days: done(d(0), d(1), d(2), d(3), d(4)) }, d(7));
  assert.equal(s.status[d(5)], 'pending');
  assert.equal(s.streak, 5);
});

test('semana parcial al empezar a mitad de semana no cuenta para la racha semanal', () => {
  const s = computeStats({ startDate: d(5), days: done(d(5)) }, d(6));
  assert.equal(s.weeks[0].state, 'partial');
  assert.equal(s.weekStreak, 0);
  assert.equal(s.streak, 1);
  assert.equal(s.weeks[0].days[0].status, 'before');
});

test('ayuno intenso: viernes y sábado cumplidos', () => {
  const s = computeStats({ startDate: MON, days: done(d(4), d(5)) }, d(5));
  assert.equal(s.weeks[0].intense, true);
});
