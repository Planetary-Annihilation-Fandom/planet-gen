import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { applyTemplate, cleanBasePlanet, validateTemplate } from "../src/template-engine.js";
import { createSurfaceProjector, area, band, disposeObject } from "../src/primitives.js";
import { analyzeGraph, layoutGraph, connectNodes, disconnectNodes } from "../src/graph-model.js";
import { createNode, NODE_TYPES, validateNode } from "../src/node-types.js";

const templates = ["neighbor_fronts", "shared_regions"].map((id) => JSON.parse(readFileSync(new URL(`../src/templates/${id}.json`, import.meta.url))));
const dot = (a, b) => a.reduce((s, v, i) => s + v*b[i], 0);
test("каждый тип создаётся и проверяется своей схемой", () => {
  for (const kind of Object.keys(NODE_TYPES)) {
    const node = createNode(kind); validateNode(node);
    assert.ok(!Object.hasOwn(node, "anchor"));
    assert.ok(NODE_TYPES[kind].fields.length > 2);
  }
});
test("положение металла определяется входом, изменение чужого металла не меняет его", () => {
  const t = templates[0], p = { players: 4, seed: 42 };
  const original = applyTemplate(t, p);
  const rewired = connectNodes(disconnectNodes(t, "front", "passes"), "home", "passes");
  const moved = applyTemplate(rewired, p);
  assert.notDeepEqual(original.zones.filter(z=>z.nodeId==="passes").map(z=>z.direction), moved.zones.filter(z=>z.nodeId==="passes").map(z=>z.direction));
  const edited = structuredClone(t); edited.nodes.find(n=>n.id==="home").spots = 20;
  assert.deepEqual(original.zones.filter(z=>z.nodeId==="front"), applyTemplate(edited,p).zones.filter(z=>z.nodeId==="front"));
  const child = moved.zones.find(z=>z.nodeId==="passes");
  assert.equal(child.inputs.length, 1);
  assert.equal(moved.zones.find(z=>z.id===child.inputs[0]).nodeId, "home");
});
test("несколько родителей участвуют в пространственном расчёте", () => {
  const starts={...createNode("spawn"),id:"starts"}, home={...createNode("metal"),id:"home"}, between={...createNode("region"),id:"between"};
  home.placement.distance=.4; between.placement.mode="between"; between.placement.distance=0;
  const t={version:2,id:"test",name:"Тест",players:{min:3,max:12,default:4},nodes:[starts,home,between],links:[{from:"starts",to:"home"},{from:"starts",to:"between"},{from:"home",to:"between"}]};
  const result=applyTemplate(t,{players:4,seed:42});
  const zone=result.zones.find(z=>z.nodeId==="between"), parents=zone.inputs.map(id=>result.zones.find(z=>z.id===id));
  assert.equal(zone.inputs.length,2);
  const sum=parents[0].direction.map((v,i)=>v+parents[1].direction[i]), l=Math.hypot(...sum);
  assert.ok(dot(zone.direction,sum.map(v=>v/l))>1-1e-10);
  assert.equal(result.links.filter(l=>l.to===zone.id).length,2);
});
test("старые якорные JSON мигрируют в граф версии 2", () => {
  const legacy={version:1,id:"legacy",name:"Старый",players:{min:3,max:12,default:4},nodes:[{id:"starts",name:"Спавны",kind:"spawn",anchor:"players",radius:.1},{id:"metal",name:"Металл",kind:"metal",anchor:"fronts",radius:.1,spots:8}],links:[{from:"starts",to:"metal",match:"adjacent"}]};
  const migrated=validateTemplate(legacy);
  assert.equal(migrated.version,2);assert.equal(migrated.nodes[1].placement.mode,"between");
  assert.ok(migrated.nodes.every(n=>!Object.hasOwn(n,"anchor")));
  assert.equal(applyTemplate(legacy,{players:4,seed:42}).zones.length,8);
  assert.equal(legacy.version,1);
});
test("отключение ветви и переподключение действительно меняют генерацию", () => {
  const original = templates[0], p = { players: 4, seed: 42 };
  const detached = disconnectNodes(original, "starts", "front");
  const result = applyTemplate(detached, p);
  assert.deepEqual(new Set(result.zones.map((z) => z.nodeId)), new Set(["starts", "home"]));
  assert.deepEqual(new Set(result.debug.inactiveNodes), new Set(["front", "passes", "walls"]));
  const connected = connectNodes(detached, "home", "front");
  assert.equal(applyTemplate(connected, p).zones.length, applyTemplate(original, p).zones.length);
  assert.equal(connected.links.find((l) => l.to === "front").from, "home");
  assert.equal(original.links.length, 4);
});
test("несколько входов сохраняются, циклы и входы спавнов запрещены", () => {
  const original = templates[0];
  const changed = connectNodes(original, "home", "passes");
  assert.equal(changed.links.filter((l) => l.to === "passes").length, 2);
  assert.ok(changed.links.some((l) => l.to === "passes" && l.from === "home"));
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
      assert.ok(layout.depths.get(l.to) >= layout.depths.get(l.from)+1);
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
    const first = a.zones.find((z) => z.kind === "blocker");
    const blockers = a.zones.filter((z) => z.kind === "blocker" && z.inputs[0] === first.inputs[0]);
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
