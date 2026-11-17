import { useEffect, useRef } from 'react';
import { Accordion, AccordionItem, Table, TableBody, TableCell, TableRow } from '@carbon/react';
import { loadTexture } from '../scene.js';

function Biome({ biome, percentage }) {
  const canvas = useRef();
  useEffect(() => {
    let active = true;
    if (biome.base_texture) loadTexture(biome.base_texture).then(image => {
      if (!active) return;
      const source = document.createElement('canvas'); source.width = image.width; source.height = image.height;
      source.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
      canvas.current.getContext('2d').drawImage(source, 0, 0, 32, 32);
    }).catch(() => {});
    return () => { active = false; };
  }, [biome]);
  return <div className="biome-row">
    <canvas ref={canvas} width={32} height={32} aria-hidden="true" style={{ background: `rgb(${biome.color.map(c => Math.round(c * 255)).join(',')})` }} />
    <span>{biome.name}</span><span className="mono">{percentage.toFixed(1)}%</span>
    <div className="biome-bar"><div style={{ width: `${percentage}%` }} /></div>
  </div>;
}
export function ResultPanel({ result, hidden }) {
  const planet = result?.planet;
  const rows = planet ? [
    ['Архетип', planet.biome], ['Плит на грань', planet.plates], ['Треугольников', planet.triangles.length.toLocaleString('ru')],
    ['Рельеф', `${planet.min_radius.toFixed(1)} … ${planet.max_radius.toFixed(1)}`],
    ['Вода', planet.water_radius?.toFixed(2) ?? 'нет'], ['Лава', planet.lava_radius?.toFixed(2) ?? 'нет'],
    ['Кандидатов металла', planet.metal.candidates.length], ['Точек металла', planet.metal.spots.length], ['Время генерации', `${result.ms.toFixed(0)} мс`],
  ] : [];
  const counts = planet?.biomes.map(() => 0) ?? [];
  for (const index of planet?.biome_index ?? []) counts[index]++;
  const added = planet?.csg.brushes.filter(brush => brush.op === 'Add').length ?? 0;
  return <aside className="result-panel" hidden={hidden} aria-label="Результат генерации">
    <p className="eyebrow">Результат</p><h2>{result?.name ?? 'Нет данных'}</h2>
    {!planet ? <p className="helper-text">Выберите планету или создайте случайную, затем запустите генерацию.</p> : <>
      <Table size="sm" aria-label="Параметры результата"><TableBody>{rows.map(([key, value]) => <TableRow key={key}><TableCell>{key}</TableCell><TableCell className="mono">{value}</TableCell></TableRow>)}</TableBody></Table>
      <Accordion size="sm">
        <AccordionItem title="Подбиомы" open><div className="biomes">{planet.biomes.map((biome, i) => <Biome key={biome.name + i} biome={biome} percentage={100 * counts[i] / Math.max(planet.biome_index.length, 1)} />)}</div></AccordionItem>
        <AccordionItem title={`Кисти CSG (${planet.csg.brushes.length})`}>
          <p className="helper-text">{planet.csg.brushes.length ? `Сложение: ${added}. Вычитание: ${planet.csg.brushes.length - added}. Булевы операции применены к поверхности и кистям.` : 'В планете нет кистей.'}</p>
          {!!planet.csg.skipped.length && <p className="helper-text">Пропущено {planet.csg.skipped.length}: {planet.csg.skipped.map(item => item[0]).join(', ')}</p>}
        </AccordionItem>
      </Accordion>
      {planet.metal.limit_is_random && <p className="helper-text">Задан лимит металла: игра обрезает точки в случайном порядке, поэтому их набор может отличаться.</p>}
    </>}
  </aside>;
}
