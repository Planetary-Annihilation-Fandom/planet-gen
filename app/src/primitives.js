import * as THREE from "three";

// Радиальная проекция на фактические треугольники. Индекс граней куба ускоряет
// запросы; долгота и полюса не требуют особых швов или интерполяции высот.
export function createSurfaceProjector(planet) {
  const size = 24, bins = new Map();
  const vertices = planet.positions.map((p) => new THREE.Vector3(...p));
  const key = (face, x, y) => (face * size + y) * size + x;
  const cell = (v) => Math.max(0, Math.min(size - 1, Math.floor((v + 1) * size / 2)));
  const component = (v, a) => a === 0 ? v.x : a === 1 ? v.y : v.z;
  planet.triangles.forEach((tri, index) => {
    const vs = tri.map((i) => vertices[i]);
    for (let face = 0; face < 6; face++) {
      const axis = face >> 1, sign = face % 2 ? -1 : 1;
      const ds = vs.map((v) => component(v, axis) * sign);
      if (ds.some((v) => v <= 0)) continue;
      const us = vs.map((v, i) => component(v, (axis + 1) % 3) / ds[i]);
      const ws = vs.map((v, i) => component(v, (axis + 2) % 3) / ds[i]);
      if (Math.min(...us) > 1 || Math.max(...us) < -1 || Math.min(...ws) > 1 || Math.max(...ws) < -1) continue;
      for (let x = cell(Math.min(...us)); x <= cell(Math.max(...us)); x++) for (let y = cell(Math.min(...ws)); y <= cell(Math.max(...ws)); y++) {
        const k = key(face, x, y);
        if (!bins.has(k)) bins.set(k, []);
        bins.get(k).push(index);
      }
    }
  });
  const triangles = planet.triangles.map(([ia, ib, ic]) => {
    const a = vertices[ia], u = vertices[ib].clone().sub(a), v = vertices[ic].clone().sub(a);
    const normal = new THREE.Vector3().crossVectors(u, v);
    const uu = u.dot(u), uv = u.dot(v), vv = v.dot(v);
    return { a, u, v, normal, plane: normal.dot(a), uu, uv, vv, det: uu*vv-uv*uv };
  });
  const cache = new Map(), delta = new THREE.Vector3();
  return (direction, lift = 1.8) => {
    const d = direction.clone().normalize();
    const cacheKey = d.toArray().map((v) => Math.round(v*1e8)).join(",");
    if (cache.has(cacheKey)) return d.multiplyScalar(cache.get(cacheKey)+lift);
    const abs = [Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)];
    const axis = abs.indexOf(Math.max(...abs));
    const face = axis * 2 + (component(d, axis) < 0 ? 1 : 0);
    const k = key(face, cell(component(d, (axis + 1) % 3) / abs[axis]), cell(component(d, (axis + 2) % 3) / abs[axis]));
    let radius = 0;
    for (const i of bins.get(k) ?? []) {
      const t = triangles[i], denom = t.normal.dot(d);
      if (Math.abs(denom) < 1e-12 || t.det <= 0) continue;
      const distance = t.plane / denom;
      if (distance <= 0) continue;
      delta.copy(d).multiplyScalar(distance).sub(t.a);
      const du = delta.dot(t.u), dv = delta.dot(t.v);
      const u = (t.vv*du-t.uv*dv)/t.det, v = (t.uu*dv-t.uv*du)/t.det;
      // Допуск на общей границе соседних треугольников предотвращает щели из-за округления.
      if (u >= -1e-7 && v >= -1e-7 && u+v <= 1+1e-7) radius = Math.max(radius, distance);
    }
    if (!radius) throw new Error(`Не удалось спроецировать примитив на поверхность: ${d.toArray()} (${(bins.get(k) ?? []).length} треугольников)`);
    if (cache.size > 150000) cache.clear();
    cache.set(cacheKey, radius);
    return d.multiplyScalar(radius + lift);
  };
}

function frame(d) {
  const up = Math.abs(d.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const x = new THREE.Vector3().crossVectors(up, d).normalize();
  return [x, new THREE.Vector3().crossVectors(d, x).normalize()];
}
function material(color, opacity) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
}
function mesh(positions, indices, color, opacity) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return new THREE.Mesh(g, material(color, opacity));
}

// Залитый геодезический диск, спроецированный на поверхность основы.
export function area(project, center, radius, color, { opacity = 0.35, lift = 2, basis, aspect = 1 } = {}) {
  const d = new THREE.Vector3(...center).normalize();
  const [x, y] = basis ? [new THREE.Vector3(...basis.forward), new THREE.Vector3(...basis.right)] : frame(d);
  const positions = [], indices = [], rings = 8, segments = 48;
  for (let r = 0; r <= rings; r++) for (let s = 0; s <= segments; s++) {
    const t = r / rings, a = s / segments * Math.PI * 2;
    const tangent = x.clone().multiplyScalar(Math.cos(a)).addScaledVector(y, Math.sin(a) * aspect);
    const angle = radius * t * tangent.length(); tangent.normalize();
    const dir = d.clone().multiplyScalar(Math.cos(angle)).addScaledVector(tangent, Math.sin(angle));
    positions.push(...project(dir, lift).toArray());
    if (r && s) {
      const i = r * (segments + 1) + s;
      indices.push(i, i - 1, i - segments - 1, i - 1, i - segments - 2, i - segments - 1);
    }
  }
  return mesh(positions, indices, color, opacity);
}

export function point(project, direction, radius, color) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), material(color, 1));
  m.position.copy(project(new THREE.Vector3(...direction), radius + 2.5));
  return m;
}

export function band(project, from, to, width, color, opacity = 0.38) {
  const a = new THREE.Vector3(...from).normalize(), b = new THREE.Vector3(...to).normalize();
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1), angle = Math.acos(dot);
  if (angle < 0.00001) return new THREE.Group();
  const side = new THREE.Vector3().crossVectors(a, b);
  if (side.lengthSq() < 1e-10) side.copy(frame(a)[0]);
  side.normalize();
  const positions = [], indices = [], steps = Math.max(4, Math.ceil(angle / 0.025));
  for (let i = 0; i <= steps; i++) {
    const d = a.clone().applyAxisAngle(side, angle * i / steps);
    for (const sign of [-1, 1]) positions.push(...project(d.clone().multiplyScalar(Math.cos(width/2)).addScaledVector(side, Math.sin(width/2)*sign), 1.2).toArray());
    if (i) { const k = i * 2; indices.push(k-2, k-1, k, k-1, k+1, k); }
  }
  return mesh(positions, indices, color, opacity);
}

export function label(project, direction, text, radius) {
  const c = document.createElement("canvas");
  c.width = 384; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#142534df"; ctx.fillRect(0,0,c.width,c.height);
  ctx.fillStyle = "white"; ctx.font = "26px Segoe UI"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, c.width/2, c.height/2, c.width-14);
  const map = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthWrite: false }));
  sprite.position.copy(project(new THREE.Vector3(...direction), radius * 0.09));
  sprite.scale.set(radius * 0.34, radius * 0.057, 1);
  return sprite;
}

export function disposeObject(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [o.material].flat()) {
      if (!m) continue;
      m.map?.dispose(); m.dispose();
    }
  });
  root.clear();
}
