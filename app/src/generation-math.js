/**
 * Общие вычисления на единичной сфере и воспроизводимая случайность.
 * Углы задаются в радианах, направления нормированы; мировой радиус применяется на этапе проекции поверхности.
 */
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return a.map((v) => v / l);
};
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
export function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
/** Возвращает локальный генератор, не зависящий от глобального Math.random и других этапов генерации. */
export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let n = Math.imul(s ^ (s >>> 15), 1 | s);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
export function spherePoint(rng) {
  const z = rng() * 2 - 1,
    a = rng() * Math.PI * 2;
  return [
    Math.sqrt(1 - z * z) * Math.cos(a),
    Math.sqrt(1 - z * z) * Math.sin(a),
    z,
  ];
}
/** Строит взаимно перпендикулярные касательные оси, в том числе вблизи полюсов. */
export function tangentBasis(d) {
  const right = norm(cross(d, Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  return { right, forward: cross(right, d) };
}
/** Переносит локальное смещение на сферу, сохраняя угловое расстояние от центра. */
export function offset(d, basis, x, y) {
  const r = Math.hypot(x, y);
  if (!r) return d;
  return norm(
    d.map(
      (v, i) =>
        v * Math.cos(r) +
        ((basis.forward[i] * x + basis.right[i] * y) * Math.sin(r)) / r,
    ),
  );
}

/**
 * Насыщенность задаётся процентом от 32 точек на ноду, независимо от её площади.
 * При обычном множителе 12% даёт четыре точки; изменение размера лишь разносит их.
 */
export function metalSpotCount(density, scale = 1) {
  return Math.max(1, Math.round((density / 100) * 32 * scale));
}
