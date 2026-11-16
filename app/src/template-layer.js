import * as THREE from "three";
import { area, point, band, label, disposeObject } from "./primitives.js";
import { KINDS } from "./template-engine.js";
import { iconTexture } from "./icons.js";

export function createTemplateLayer(project, data, radius) {
  const root = new THREE.Group(), zones = new THREE.Group(), links = new THREE.Group(), debug = new THREE.Group();
  root.add(links, zones, debug);
  const byId = new Map(data.zones.map((z) => [z.id, z]));
  const iconMaps = new Map();
  for (const z of data.zones) {
    const g = new THREE.Group();
    g.userData = { nodeId: z.nodeId, zoneId: z.id, kind: z.kind };
    const color = KINDS[z.kind];
    g.add(area(project, z.direction, z.radius, color));
    if (z.kind === "blocker" || z.kind === "ramp") g.add(area(project, z.direction, z.radius, color, { height: radius*z.radius*0.7, opacity: 0.48, lift: 3 }));
    for (const d of z.points) g.add(point(project, d, radius * 0.006, "#ffce3a"));
    if (!iconMaps.has(z.kind)) iconMaps.set(z.kind, iconTexture(z.kind));
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconMaps.get(z.kind), depthWrite: false }));
    icon.position.copy(project(new THREE.Vector3(...z.direction), radius * (z.kind === "blocker" || z.kind === "ramp" ? z.radius*0.75 + 0.025 : 0.025)));
    icon.scale.setScalar(radius*0.075);
    icon.userData.isIcon = true;
    g.add(icon);
    g.traverse((o) => { if (o.material) { o.userData.opacity = o.material.opacity; o.userData.color = o.material.color.clone(); } });
    zones.add(g);
    const text = `${z.id}${z.owner === null ? "" : `  P${z.owner+1}`}`;
    const tag = label(project, z.direction, text, radius);
    tag.userData.kind = z.kind; debug.add(tag);
  }
  for (const l of data.links) {
    const a = byId.get(l.from), b = byId.get(l.to);
    const m = band(project, a.direction, b.direction, 0.014, "#7189a1");
    m.userData = { fromNode: l.fromNode, toNode: l.toNode, fromKind: a.kind, toKind: b.kind };
    links.add(m);
  }
  function select(nodeId) {
    for (const g of zones.children) g.traverse((o) => {
      if (!o.material) return;
      const selected = g.userData.nodeId === nodeId;
      o.material.opacity = selected ? Math.min(0.9, o.userData.opacity * 1.9) : nodeId ? o.userData.opacity * 0.45 : o.userData.opacity;
      o.material.color.copy(o.userData.color);
      if (selected) o.material.color.lerp(new THREE.Color("#ffffff"), 0.28);
    });
    for (const l of links.children) if (l.material) {
      const selected = nodeId && [l.userData.fromNode, l.userData.toNode].includes(nodeId);
      l.material.color.set(selected ? "#ffffff" : "#7189a1");
      l.material.opacity = selected ? 0.85 : nodeId ? 0.10 : 0.38;
    }
  }
  function toggle(o) {
    for (const g of zones.children) g.visible = o[g.userData.kind] !== false;
    zones.traverse((object) => { if (object.userData.isIcon) object.visible = o.icons !== false; });
    links.visible = o.links !== false; debug.visible = !!o.debug;
    for (const l of links.children) l.visible = o[l.userData.fromKind] !== false && o[l.userData.toKind] !== false;
    for (const t of debug.children) t.visible = o[t.userData.kind] !== false;
  }
  const position = (d) => project(new THREE.Vector3(...d), 0).toArray();
  const placements = { spawns: [], metal: [], csg: [] };
  for (const z of data.zones) {
    const common = { id: z.id, nodeId: z.nodeId, owner: z.owner, position: position(z.direction), direction: z.direction, angularRadius: z.radius, radius: z.radius*radius };
    if (z.kind === "spawn") placements.spawns.push(common);
    if (z.kind === "metal") placements.metal.push({ ...common, spots: z.points.map(position) });
    if (z.kind === "blocker" || z.kind === "ramp") placements.csg.push({ ...common, kind: z.kind, representation: "dome" });
  }
  return { root, zones, placements, select, toggle, dispose: () => disposeObject(root) };
}
