export const ARCHETYPES = ['earth', 'tropical', 'desert', 'moon', 'lava', 'metal', 'asteroid'];
export const FIELDS = [
  ['seed', 'Зерно', 'number'], ['radius', 'Радиус', 'number'], ['heightRange', 'Перепад высот', 'number'],
  ['waterHeight', 'Уровень воды', 'number'], ['waterDepth', 'Глубина воды', 'number'],
  ['biomeScale', 'Масштаб биома', 'number'], ['temperature', 'Температура', 'number'],
  ['metalDensity', 'Плотность металла', 'number'], ['metalClusters', 'Кластеры металла', 'number'],
  ['metalSpotLimit', 'Лимит точек', 'number'], ['biome', 'Архетип', 'text'],
  ['symmetryType', 'Симметрия', ['none', 'terrain', 'terrain and CSG']],
  ['symmetricalMetal', 'Симметричный металл', 'checkbox'],
];
export const TEMPLATE_HIDDEN_FIELDS = new Set(['waterHeight', 'waterDepth', 'metalDensity', 'metalClusters', 'metalSpotLimit', 'symmetricalMetal']);
export const BASE_SOURCE = { name: 'Основа шаблона', planet: {
  seed: 42, radius: 500, heightRange: 18, waterHeight: 0, waterDepth: 0, biomeScale: 65,
  temperature: 80, metalDensity: 0, metalClusters: 0, metalSpotLimit: 0,
  biome: 'desert', symmetryType: 'none', symmetricalMetal: false, mass: 10000,
}, planetCSG: [] };

export function randomPlanet(biome, min = 300, max = 900) {
  let lo = Number(min) || 300, hi = Number(max) || 900;
  if (lo > hi) [lo, hi] = [hi, lo];
  const int = (a, b) => Math.round(a + Math.random() * (b - a));
  const planet = {
    seed: int(0, 32767), radius: Math.round(int(lo, hi) / 10) * 10, heightRange: int(10, 60),
    waterHeight: ['earth', 'tropical'].includes(biome) ? int(25, 60) : int(0, 40), waterDepth: int(25, 75),
    biomeScale: int(50, 100), temperature: int(['tropical', 'desert'].includes(biome) ? 70 : 20, 100),
    metalDensity: int(20, 100), metalClusters: int(20, 100), metalSpotLimit: -1,
    biome, symmetryType: 'none', symmetricalMetal: false, mass: 10000,
  };
  return { name: `${biome} #${planet.seed}`, planet, planetCSG: [] };
}
export function asSystem(doc, name) {
  return doc.planets ? doc : { name, planets: [doc.planet ? doc : { name, planet: doc }] };
}
export function downloadJSON(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
