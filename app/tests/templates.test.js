import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { applyTemplate, cleanBasePlanet, validateTemplate } from "../src/template-engine.js";
import { createSurfaceProjector, area, band, disposeObject } from "../src/primitives.js";
import { analyzeGraph, layoutGraph, connectNodes, disconnectNodes } from "../src/graph-model.js";

const templates = ["neighbor_fronts", "shared_regions"].map((id) => JSON.parse(readFileSync(new URL(`../src/templates/${id}.json`, import.meta.url))));
const dot = (a, b) => a.reduce((s, v, i) => s + v*b[i], 0);
test("отключение ветви и переподключение действительно меняют генерацию", () => {
  const original = templates[0], p = { players: 4, seed: 42 };
  const detached = disconnectNodes(original, "starts", "front");
  const result = applyTemplate(detached, p);
  assert.deepEqual(new Set(result.zones.map((z) => z.nodeId)), new Set(["starts", "home"]));
  assert.deepEqual(new Set(result.debug.inactiveNodes), new Set(["front", "passes", "walls"]));
  const connected = connectNodes(detached, "home", "front");
  assert.equal(applyTemplate(connected, p).zones.length, applyTemplate(original, p).zones.length);
  assert.equal(connected.links.find((l) => l.to === "front").match, "adjacent");
  assert.equal(original.links.length, 4);
});
test("единственный вход заменяется атомарно, циклы и входы спавнов запрещены", () => {
  const original = templates[0];
  const changed = connectNodes(original, "home", "passes");
  assert.equal(changed.links.filter((l) => l.to === "passes").length, 1);
  assert.equal(changed.links.find((l) => l.to === "passes").from, "home");
  assert.equal(original.links.find((l) => l.to === "passes").from, "front");
  assert.throws(() => connectNodes(original, "walls", "front"), /цикл/);
  assert.throws(() => connectNodes(original, "home", "starts"), /нет входа/);
  assert.throws(() => connectNodes(original, "home", "home"), /собой/);
});
test("раскладка следует связям, даже если JSON-ноды перемешаны", () => {
  for (const t of templates) {
    const reversed = { ...t, nodes: [...t.nodes].reverse() };
    const layout = layoutGraph(reversed);
    assert.equal(layout.order[0].kind, "spawn");
    for (const l of t.links) {
      assert.ok(layout.positions.get(l.from).y < layout.positions.get(l.to).y);
      assert.equal(layout.depths.get(l.to), layout.depths.get(l.from)+1);
    }
    assert.equal(analyzeGraph(t).active.size, t.nodes.length);
  }
});
for (const t of templates) test(`${t.id}: воспроизводимость и масштабирование FFA`, () => {
  for (const players of [3, 4, 6, 12]) {
    const p = { players, seed: 127, metalScale: 1 };
    const a = applyTemplate(t, p);
    assert.deepEqual(a, applyTemplate(t, p));
    assert.notDeepEqual(a.zones, applyTemplate(t, { ...p, seed: 128 }).zones);
    assert.equal(a.zones.filter((z) => z.kind === "spawn").length, players);
    assert.equal(new Set(a.zones.map((z) => z.id)).size, a.zones.length);
    const ids = new Set(a.zones.map((z) => z.id));
    for (const l of a.links) assert.ok(ids.has(l.from) && ids.has(l.to));
    for (const z of a.zones) {
      assert.ok(Math.abs(Math.hypot(...z.direction)-1) < 1e-10);
      for (const p of z.points) assert.ok(Math.acos(Math.min(1, dot(p, z.direction))) < z.radius);
    }
    const blockers = a.zones.filter((z) => z.kind === "blocker" && z.owner === 0);
    assert.ok(Math.acos(Math.min(1, dot(blockers[0].direction, blockers[1].direction))) < blockers[0].radius + blockers[1].radius);
  }
});
test("проверка JSON до применения", () => {
  assert.throws(() => validateTemplate({ ...templates[0], id: "кириллица" }));
  assert.throws(() => applyTemplate(templates[0], { players: 2, seed: 42 }));
  assert.throws(() => applyTemplate(templates[0], { players: 4, seed: NaN }));
  assert.throws(() => validateTemplate({ ...templates[0], links: [{ from: "missing", to: "starts", match: "all" }] }));
});
test("очистка основы не изменяет исходные данные", () => {
  const original = { water_radius: 500, lava_radius: 500, metal: { spots: [1], candidates: [1] }, csg: { brushes: [1] } };
  const base = cleanBasePlanet(original, { radius: 500 });
  assert.equal(base.result.water_radius, null);
  assert.deepEqual(base.result.metal.spots, []);
  assert.deepEqual(base.result.csg.brushes, []);
  assert.equal(original.metal.spots.length, 1);
});
test("проекция на треугольники и примитивы у полюсов, швов и антиподов", () => {
  const geometry = new THREE.IcosahedronGeometry(500, 3);
  const attr = geometry.attributes.position;
  const positions = Array.from({ length: attr.count }, (_, i) => [attr.getX(i), attr.getY(i), attr.getZ(i)]);
  const triangles = Array.from({ length: attr.count/3 }, (_, i) => [i*3, i*3+1, i*3+2]);
  const project = createSurfaceProjector({ positions, triangles });
  const ray = new THREE.Ray(), hit = new THREE.Vector3();
  for (const v of [[0,0,1], [0,0,-1], [1,1,1], [-1,1,-1], [1,1e-9,0], [1,-1e-9,0]]) {
    const d = new THREE.Vector3(...v).normalize(); ray.direction.copy(d);
    let expected = 0;
    for (const tri of triangles) if (ray.intersectTriangle(...tri.map((i) => new THREE.Vector3(...positions[i])), false, hit)) expected = Math.max(expected, hit.length());
    assert.ok(Math.abs(project(d, 0).length()-expected) < 1e-5);
    const disk = area(project, d.toArray(), 0.15, "red", { height: 15 });
    assert.ok([...disk.geometry.attributes.position.array].every(Number.isFinite));
    disposeObject(new THREE.Group().add(disk));
  }
  for (const to of [[1,0,0], [-1,0,0]]) {
    const strip = band(project, [1,0,0], to, 0.014, "blue");
    assert.ok(!strip.geometry || [...strip.geometry.attributes.position.array].every(Number.isFinite));
    disposeObject(new THREE.Group().add(strip));
  }
  geometry.dispose();
});
