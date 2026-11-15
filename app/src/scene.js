import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// Цвета суши от уровня воды до вершин; под водой — от дна к берегу.
const PALETTES = {
  earth: { land: ["#c9b98a", "#5f8f3e", "#3d6b2c", "#7a6a55", "#e8ecef"], sea: ["#4a4636", "#8a7d5c"] },
  tropical: { land: ["#e0d39c", "#4f9a3a", "#2f7a2a", "#6b5a40", "#a89878"], sea: ["#3e4a3a", "#9a9070"] },
  desert: { land: ["#e3c98f", "#d2a86a", "#b9814c", "#8d5f3a", "#c9a27a"], sea: ["#5a4a33", "#a8875a"] },
  moon: { land: ["#8a8a8a", "#9c9c9c", "#7c7c7c", "#b0b0b0", "#cfcfcf"], sea: ["#555", "#777"] },
  lava: { land: ["#3a2a24", "#4a3a32", "#2c2420", "#5a4a40", "#6a5a52"], sea: ["#1a1010", "#3a2018"] },
  metal: { land: ["#6d747c", "#7d858e", "#5c636b", "#8f979f", "#a9b0b7"], sea: ["#3b4046", "#5a6067"] },
  tundra: { land: ["#b7b8a4", "#8c9479", "#6f7a62", "#9a9a92", "#f2f4f6"], sea: ["#4a4a46", "#7c7c70"] },
  ice: { land: ["#cfdbe3", "#dfe8ee", "#b9c8d3", "#eef3f6", "#ffffff"], sea: ["#6c7f8c", "#a6b7c2"] },
};

function palette(biome) {
  const key = Object.keys(PALETTES).find((k) => biome?.includes(k)) ?? "earth";
  const p = PALETTES[key];
  return { land: p.land.map((c) => new THREE.Color(c)), sea: p.sea.map((c) => new THREE.Color(c)) };
}

function ramp(colors, t, out) {
  const x = Math.min(Math.max(t, 0), 1) * (colors.length - 1);
  const i = Math.min(Math.floor(x), colors.length - 2);
  return out.copy(colors[i]).lerp(colors[i + 1], x - i);
}

// Порядок обхода в игре зависит от грани куба; для освещения разворачиваем треугольники наружу.
function outward(P, tris) {
  const idx = new Uint32Array(tris.length * 3);
  tris.forEach(([a, b, c], i) => {
    const [pa, pb, pc] = [P[a], P[b], P[c]];
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const out = n[0] * pa[0] + n[1] * pa[1] + n[2] * pa[2] >= 0;
    idx.set(out ? [a, b, c] : [a, c, b], i * 3);
  });
  return Array.from(idx);
}

// Вершины на рёбрах граней куба повторяются; усредняем их нормали, чтобы не было швов.
function weldNormals(geo) {
  const pos = geo.attributes.position.array;
  const nrm = geo.attributes.normal.array;
  const groups = new Map();
  for (let i = 0; i < pos.length / 3; i++) {
    const k = `${Math.round(pos[i * 3] * 100)},${Math.round(pos[i * 3 + 1] * 100)},${Math.round(pos[i * 3 + 2] * 100)}`;
    (groups.get(k) ?? groups.set(k, []).get(k)).push(i);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const s = [0, 0, 0];
    for (const i of g) for (let c = 0; c < 3; c++) s[c] += nrm[i * 3 + c];
    const l = Math.hypot(...s) || 1;
    for (const i of g) for (let c = 0; c < 3; c++) nrm[i * 3 + c] = s[c] / l;
  }
  geo.attributes.normal.needsUpdate = true;
}

export function createScene(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#07090c");
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 100000);
  camera.position.set(0, 0, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.AmbientLight("#ffffff", 0.35));
  const sun = new THREE.DirectionalLight("#ffffff", 1.6);
  camera.add(sun);
  sun.position.set(0.6, 0.8, 1);
  scene.add(camera);

  const group = new THREE.Group();
  scene.add(group);
  let parts = {};

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  function clear() {
    group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    group.clear();
    parts = {};
  }

  function show(p) {
    clear();
    // Игра использует систему, где z направлена к полюсу; в three.js полюс — ось y.
    group.rotation.set(-Math.PI / 2, 0, 0);

    const n = p.positions.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const pal = palette(p.biome);
    // Без жидкости вся поверхность считается сушей.
    const level = p.water_radius ?? p.lava_radius ?? p.min_radius;
    const tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const v = p.positions[i];
      pos.set(v, i * 3);
      const r = Math.hypot(v[0], v[1], v[2]);
      const c =
        r >= level
          ? ramp(pal.land, (r - level) / Math.max(p.max_radius - level, 1), tmp)
          : ramp(pal.sea, (r - p.min_radius) / Math.max(level - p.min_radius, 1), tmp);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(outward(p.positions, p.triangles));
    geo.computeVertexNormals();
    weldNormals(geo);
    const surface = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
    );
    group.add(surface);
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: "#000000", transparent: true, opacity: 0.25 }),
    );
    group.add(wire);

    const fluids = new THREE.Group();
    if (p.water_radius) {
      fluids.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(p.water_radius, 128, 64),
          new THREE.MeshStandardMaterial({ color: "#2a6fb0", transparent: true, opacity: 0.55, roughness: 0.3 }),
        ),
      );
    }
    if (p.lava_radius) {
      fluids.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(p.lava_radius, 128, 64),
          new THREE.MeshStandardMaterial({ color: "#d0461a", emissive: "#5a1400", transparent: true, opacity: 0.8 }),
        ),
      );
    }
    group.add(fluids);

    const spots = p.metal.spots;
    const marker = new THREE.CylinderGeometry(5, 5, 14, 12);
    marker.translate(0, 7, 0);
    const metal = new THREE.InstancedMesh(
      marker,
      new THREE.MeshStandardMaterial({ color: "#ffd24a", emissive: "#4a3600" }),
      Math.max(spots.length, 1),
    );
    metal.count = spots.length;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    spots.forEach((s, i) => {
      q.setFromUnitVectors(up, new THREE.Vector3(...s.normal).normalize());
      m.compose(new THREE.Vector3(...s.pos), q, new THREE.Vector3(1, 1, 1));
      metal.setMatrixAt(i, m);
    });
    group.add(metal);

    const cand = new THREE.Points(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(p.metal.candidates.flat()), 3),
      ),
      new THREE.PointsMaterial({ color: "#ff5ad0", size: 6 }),
    );
    group.add(cand);

    parts = { wire, fluids, metal, cand };
    const dist = p.max_radius * 3.2;
    if (camera.position.length() < p.max_radius * 1.2 || camera.position.length() > dist * 3) {
      camera.position.setLength(dist);
    }
    controls.minDistance = p.max_radius * 1.05;
  }

  function toggle(o) {
    if (!parts.wire) return;
    parts.wire.visible = o.wire;
    parts.fluids.visible = o.water;
    parts.metal.visible = o.metal;
    parts.cand.visible = o.candidates;
  }

  return { show, toggle };
}
