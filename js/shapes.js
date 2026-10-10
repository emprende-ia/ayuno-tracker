// Formas de Material 3 Expressive dibujadas en SVG:
// indicador de progreso circular ondulado y formas "cookie" (bordes festoneados).

const TAU = Math.PI * 2;
const f = (n) => n.toFixed(2);

/** Arco ondulado: el radio oscila con una senoidal. Ángulos en radianes. */
export function wavyArc(cx, cy, r, amp, waves, from, to, phase = 0) {
  if (to - from < 0.001) return '';
  const steps = Math.max(8, Math.ceil(((to - from) / TAU) * 220));
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    // la onda se aplana en los extremos para que las puntas queden limpias
    const edge = Math.min(1, (t - from) / 0.25, (to - t) / 0.25);
    const rr = r + amp * edge * Math.sin(waves * t - phase);
    d += `${i ? 'L' : 'M'}${f(cx + rr * Math.cos(t))} ${f(cy + rr * Math.sin(t))}`;
  }
  return d;
}

/** Arco plano (pista del indicador) */
export function arc(cx, cy, r, from, to) {
  if (to - from < 0.001) return '';
  const large = to - from > Math.PI ? 1 : 0;
  const x1 = cx + r * Math.cos(from), y1 = cy + r * Math.sin(from);
  const x2 = cx + r * Math.cos(to), y2 = cy + r * Math.sin(to);
  return `M${f(x1)} ${f(y1)}A${r} ${r} 0 ${large} 1 ${f(x2)} ${f(y2)}`;
}

/** Forma cookie de `lobes` puntas suaves, centrada en un cuadro de `size`. */
export function cookie(size, lobes = 9, amp = 0.07) {
  const c = size / 2;
  const r = c / (1 + amp);
  let d = '';
  const steps = lobes * 16;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * TAU - Math.PI / 2;
    const rr = r * (1 + amp * Math.cos(lobes * (t + Math.PI / 2)));
    d += `${i ? 'L' : 'M'}${f(c + rr * Math.cos(t))} ${f(c + rr * Math.sin(t))}`;
  }
  return d + 'Z';
}

/**
 * Geometría del indicador: devuelve las rutas del progreso y la pista,
 * con un hueco entre ambos como pide la especificación.
 */
export function ringPaths({ size, stroke, progress, phase = 0, amp = 3, waves = 13 }) {
  const c = size / 2;
  const r = c - stroke / 2 - amp - 1;
  const start = -Math.PI / 2;
  const p = Math.max(0, Math.min(1, progress));
  const gap = (stroke + 6) / r;
  const end = start + TAU * p;
  const active = p > 0 ? wavyArc(c, c, r, amp, waves, start, Math.max(start + 0.0011, end), phase) : '';
  let track = '';
  if (p < 1) {
    const tFrom = p > 0 ? end + gap : start;
    const tTo = start + TAU - (p > 0 ? gap : 0);
    track = p > 0 ? arc(c, c, r, tFrom, tTo) : arc(c, c, r, start, start + TAU - 0.001);
  }
  return { active, track, r, c };
}

export function pointOnRing(c, r, fraction) {
  const t = -Math.PI / 2 + TAU * fraction;
  return [c + r * Math.cos(t), c + r * Math.sin(t)];
}
