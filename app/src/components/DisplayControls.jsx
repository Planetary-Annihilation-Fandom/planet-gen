/**
 * Настройки отображения находятся рядом с планетой. Выбор поля меняет окраску
 * поверхности; подписи у стартов показывают значения того же поля без отдельного отчёта.
 */
import { Checkbox } from "@carbon/react";
import { Choice } from "./Fields.jsx";

export const ANALYSIS_FIELDS = {
  none: "Без расчётного слоя",
  clearance: "Свободное место вне областей",
  buildable: "Пригодность площадки старта",
  wealthShort: "Доступный металл поблизости",
  wealthMedium: "Доступный металл на среднем расстоянии",
  wealthLong: "Доступный металл на дальнем расстоянии",
  spawnEligibility: "Допустимость кандидатов старта",
  spawnScore: "Оценка кандидатов старта",
  exits: "Выходы у проверенных кандидатов",
  arrival: "Стоимость пути от спавнов",
  owner: "Доступность территории игрокам",
  height: "Высота поверхности",
  walkable: "Проходимость",
};
const TEMPLATE_LAYERS = {
  spawn: "Спавны",
  metal: "Металл",
  blocker: "Блокеры",
  ramp: "Рампы",
  links: "Связи композиции",
  icons: "Значки областей",
  debug: "Подписи областей",
  navigation: "Сетка навигации",
  routes: "Маршруты",
  candidates: "Кандидаты стартов",
};
const FIELD_DESCRIPTIONS = {
  clearance:
    "Значение 1: вся площадка старта находится вне металла, блокеров и рамп. Значение 0: площадка пересекает область.",
  buildable:
    "Доля пригодной поверхности вокруг точки. Для кандидата нужно не менее 75%.",
  wealthShort:
    "Металл с учётом стоимости пути в пределах 0.4 радиуса планеты. Для кандидата значение должно быть больше нуля.",
  wealthMedium:
    "Металл с учётом стоимости пути в пределах 0.85 радиуса планеты.",
  wealthLong: "Металл с учётом стоимости пути в пределах 1.7 радиуса планеты.",
  spawnEligibility:
    "Значение 1: точка прошла отбор по свободному месту, площадке, ближнему металлу и подходам. Затем проверяются независимые выходы и сочетания стартов.",
  spawnScore:
    "Оценка точек, прошедших предварительный отбор. Учитывает пригодную площадь и ближний металл. Чёрные участки исключены.",
  exits:
    "Число локальных непересекающихся выходов. Рассчитано у проверенных кандидатов; остальные участки чёрные. Для старта нужно не менее двух.",
  arrival:
    "Кратчайший путь по расчётной сетке от ближайшего старта в обход зарезервированных блокеров.",
  owner: "Цвет игрока показывает, чей спавн ближе по стоимости наземного пути.",
  walkable: "Расчётная сетка исключает зарезервированные блокеры. Проходимость в игре и положение воды требуют отдельной проверки.",
};

/** Показывает доступные расчётные поля и переключатели пространственных слоёв. */
export function DisplayControls({ snapshot, layers, setLayers }) {
  const { applied, template } = snapshot;
  const analysis = applied.analysis;
  const field = layers.analysis ?? "none";
  const values =
    analysis?.fields[field]?.filter(
      (value) => Number.isFinite(value) && (field !== "owner" || value >= 0),
    ) ?? [];
  const setLayer = (key, checked) =>
    setLayers((previous) => ({ ...previous, [key]: checked }));
  return (
    <>
      <h3>Элементы карты</h3>
      {Object.entries(TEMPLATE_LAYERS)
        .filter(
          ([key]) =>
            template.version === 4 ||
            !["navigation", "routes", "candidates"].includes(key),
        )
        .map(([key, title]) => (
          <Checkbox
            key={key}
            id={`layer-${key}`}
            labelText={title}
            checked={!!layers[key]}
            onChange={(_, { checked }) => setLayer(key, checked)}
          />
        ))}
      {template.version === 3 && (
        <Checkbox
          id="layer-front"
          labelText="Фронт и направляющая"
          checked={!!layers.front}
          onChange={(_, { checked }) => setLayer("front", checked)}
        />
      )}
      {template.version === 4 && (
        <>
          <h3>Расчёт стартов и поверхность</h3>
          <Choice
            id="analysisField"
            label="Слой данных на планете"
            value={field}
            options={Object.entries({
              ...ANALYSIS_FIELDS,
              ...analysis?.fieldLabels,
            })}
            onChange={(analysis) =>
              setLayers((previous) => ({ ...previous, analysis }))
            }
          />
          {field !== "none" && (
            <>
              <p className="helper-text">{FIELD_DESCRIPTIONS[field]}</p>
              {!!values.length && field !== "owner" && (
                <p className="helper-text">
                  Синий: {Math.min(...values).toFixed(2)}. Красный:{" "}
                  {Math.max(...values).toFixed(2)}. Чёрный: нет доступного
                  значения.
                </p>
              )}
              <p className="helper-text">
                Значения выбранного слоя подписаны у спавнов на планете.
              </p>
            </>
          )}
          {applied.debug.pending && (
            <p className="helper-text" role="status">
              Обновляются расчётные слои.
            </p>
          )}
          {!applied.debug.pending &&
            !applied.zones.some((zone) => zone.kind === "spawn") && (
              <p className="helper-text" role="status">
                {applied.debug.balance}
              </p>
            )}
        </>
      )}
    </>
  );
}
