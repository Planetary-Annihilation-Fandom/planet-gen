/**
 * Отображает расчётные поля поверх фактической поверхности.
 * Сетка, маршруты и кандидаты переключаются независимо; значения у стартов берутся из того же массива, который задаёт цвет поверхности.
 */
import * as THREE from "three";
import { point, label, disposeObject } from "./primitives.js";
/** Создаёт принадлежащие одному результату WebGL-объекты; toggle меняет отображение без повторной генерации. */
export function createAnalysisLayer(project, data, radius) {
  const root = new THREE.Group(),
    heat = new THREE.Group(),
    wire = new THREE.Group(),
    routes = new THREE.Group(),
    candidates = new THREE.Group(),
    spawnValues = new THREE.Group();
  root.add(heat, wire, routes, candidates, spawnValues);
  const analysis = data.analysis;
  if (!analysis)
    return { root, toggle() {}, dispose: () => disposeObject(root) };
  const positions = analysis.directions.map((d) =>
    project(new THREE.Vector3(...d), 3).toArray(),
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions.flat(), 3),
  );
  geometry.setIndex(analysis.triangles.flat());
  const colors = new Float32Array(positions.length * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  heat.add(
    new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    ),
  );
  wire.add(
    new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: "#a6c8ff",
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    ),
  );
  // Все маршруты передаются видеокарте одной геометрией вместо сотен полос.
  const routePositions = [];
  for (const route of [...(data.routes ?? []), ...analysis.paths]) {
    for (let index = 1; index < route.points.length; index++) {
      for (const direction of [route.points[index - 1], route.points[index]]) {
        routePositions.push(
          ...project(new THREE.Vector3(...direction), 5).toArray(),
        );
      }
    }
  }
  routes.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(routePositions, 3),
      ),
      new THREE.LineBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    ),
  );
  for (const c of analysis.candidates)
    candidates.add(
      point(project, analysis.directions[c.index], radius * 0.009, "#ff7eb6"),
    );
  let field = "";
  /** Окраска и подписи обновляются только при смене поля; простые переключатели меняют видимость групп. */
  function toggle(options) {
    const selected =
      options.selectedCandidate === "" ? -1 : Number(options.selectedCandidate);
    candidates.children.forEach((p, i) => {
      p.scale.setScalar(i === selected ? 2.5 : 1);
      p.material?.color.set(i === selected ? "#ffffff" : "#ff7eb6");
    });
    const next = options.analysis ?? "none";
    heat.visible = next !== "none";
    wire.visible = !!options.navigation;
    routes.visible = !!options.routes;
    candidates.visible = !!options.candidates;
    spawnValues.visible = next !== "none" && options.spawn !== false;
    if (next === field) return;
    field = next;
    disposeObject(spawnValues);
    const values = analysis.fields[next];
    if (!values) {
      heat.visible = false;
      return;
    }
    // Подписи используют те же значения, которыми окрашена поверхность.
    // Поэтому сравнение стартов остаётся частью слоя карты, без отдельной панели.
    for (const spawn of data.zones.filter((zone) => zone.kind === "spawn")) {
      const value = values[spawn.metrics.index];
      let text = !Number.isFinite(value) ? "недоступно" : value.toFixed(2);
      if (next === "buildable") text = `${Math.round(value * 100)}%`;
      if (["clearance", "walkable", "spawnEligibility"].includes(next))
        text = value ? "да" : "нет";
      if (next === "owner")
        text = value >= 0 ? `игрок ${value + 1}` : "недоступно";
      spawnValues.add(
        label(project, spawn.direction, `${spawn.name}: ${text}`, radius),
      );
    }
    const finite = values.filter(Number.isFinite),
      min = Math.min(...finite),
      max = Math.max(...finite),
      color = new THREE.Color();
    values.forEach((v, i) => {
      if (!Number.isFinite(v) || (v < 0 && next === "owner"))
        color.set("#161616");
      else if (next === "owner")
        color.set(
          [
            "#78a9ff",
            "#ff7eb6",
            "#42be65",
            "#f1c21b",
            "#be95ff",
            "#ff832b",
            "#08bdba",
            "#fa4d56",
          ][v % 8],
        );
      else
        color.setHSL(
          (1 - (v - min) / Math.max(1e-9, max - min)) * 0.65,
          0.85,
          0.5,
        );
      color.toArray(colors, i * 3);
    });
    geometry.attributes.color.needsUpdate = true;
  }
  return { root, toggle, dispose: () => disposeObject(root) };
}
