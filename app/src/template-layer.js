import { createAnalysisLayer } from './analysis-layer.js';
import * as THREE from "three";
import { area, point, band, label, disposeObject } from "./primitives.js";
import { KINDS } from "./template-engine.js";
import { iconTexture } from "./icons.js";

export function createTemplateLayer(project, data, radius) {
  const root = new THREE.Group(), zones = new THREE.Group(), links = new THREE.Group(), debug = new THREE.Group();
  const guide = new THREE.Group();
  const analysis = createAnalysisLayer(project, data, radius);
  root.add(guide, links, zones, debug, analysis.root);
  if (data.guide) {
    guide.add(band(project, data.guide.from, data.guide.middle, .008, '#f4f4f4', .8));
    guide.add(band(project, data.guide.middle, data.guide.to, .008, '#f4f4f4', .8));
    for (let i = 1; i < data.guide.boundary.length; i++) guide.add(band(project, data.guide.boundary[i-1], data.guide.boundary[i], .012, KINDS.front, .8));
  }
  const byId = new Map(data.zones.map((z) => [z.id, z]));
  const iconMaps = new Map();
  for (const z of data.zones) {
    const g = new THREE.Group();
    g.userData = { nodeId: z.nodeId, zoneId: z.id, kind: z.kind };
    const color = KINDS[z.kind];
    const aspect = z.shape === 'strip' ? .25 : z.kind === 'ramp' ? .55 : 1;
    g.add(area(project, z.direction, z.radius, color, { basis: z.basis, aspect, height: z.kind === 'ramp' ? radius*z.radius*.2 : 0, slope: z.kind === 'ramp' }));
    if (z.kind === 'ramp') {
      const d = new THREE.Vector3(...z.direction), f = new THREE.Vector3(...z.basis.forward), r = new THREE.Vector3(...z.basis.right);
      const offset = (x, y = 0) => d.clone().multiplyScalar(Math.cos(Math.hypot(x, y))).add(f.clone().multiplyScalar(x)).add(r.clone().multiplyScalar(y)).normalize().toArray();
      const tip = offset(z.radius*.7);
      g.add(band(project, offset(-z.radius*.7), tip, .009, '#ffffff', .9));
      for (const sign of [-1, 1]) g.add(band(project, tip, offset(z.radius*.3, sign*z.radius*.25), .009, '#ffffff', .9));
    }
    for (const d of z.points) g.add(point(project, d, radius * 0.006, "#ffce3a"));
    if (!iconMaps.has(z.kind)) iconMaps.set(z.kind, iconTexture(z.kind));
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconMaps.get(z.kind), depthWrite: false }));
    icon.position.copy(project(new THREE.Vector3(...z.direction), radius * (z.kind === "blocker" || z.kind === "ramp" ? z.radius*z.height + 0.025 : 0.025)));
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
    analysis.toggle(o);
    guide.visible = o.front !== false;
    for (const g of zones.children) g.visible = o[g.userData.kind] !== false;
    zones.traverse((object) => { if (object.userData.isIcon) object.visible = o.icons !== false; });
    links.visible = o.links !== false; debug.visible = !!o.debug;
    for (const l of links.children) l.visible = o[l.userData.fromKind] !== false && o[l.userData.toKind] !== false;
    for (const t of debug.children) t.visible = o[t.userData.kind] !== false;
  }
  const position = (d) => project(new THREE.Vector3(...d), 0).toArray();
  const placements = { spawns: [], regions: [], metal: [], csg: [], fronts: [], guide: data.guide };
  for (const z of data.zones) {
    const common = { id: z.id, nodeId: z.nodeId, owner: z.owner, position: position(z.direction), direction: z.direction, angularRadius: z.radius, radius: z.radius*radius };
    if (z.kind === "spawn") placements.spawns.push(common);
    if (z.kind === "front") placements.fronts.push(common);
    if (z.kind === "metal") placements.metal.push({ ...common, spots: z.points.map(position) });
    if (z.kind === "blocker" || z.kind === "ramp") placements.regions.push({ ...common, kind: z.kind, shape: z.shape ?? "ellipse", orientation: z.orientation ?? 0, basis: z.basis, representation: data.surface ? "surface-deformation" : "reserved-area" });
  }
  return { root, zones, placements, select, toggle, dispose: () => disposeObject(root) };
}
