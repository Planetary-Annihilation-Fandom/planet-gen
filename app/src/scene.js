import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { invoke } from "@tauri-apps/api/core";
import { createSurfaceProjector } from "./primitives.js";
import { createTemplateLayer } from "./template-layer.js";

const LAYER = 512; // сторона слоя массива текстур
const MAX_BIOMES = 8; // два атрибута vec4 весов
const TILE = 96; // мировых единиц на повтор текстуры биома

// Текстуры игры: команда texture отдаёт 8 байт размеров и RGBA8 строками сверху вниз.
const textures = new Map();
export function loadTexture(path) {
  if (!textures.has(path)) {
    textures.set(
      path,
      invoke("texture", { path }).then((buf) => {
        const dv = new DataView(buf);
        const width = dv.getUint32(0, true);
        const height = dv.getUint32(4, true);
        return { width, height, rgba: new Uint8Array(buf, 8) };
      }),
    );
  }
  return textures.get(path);
}

// Приводит изображение к LAYER×LAYER, чтобы положить его в слой массива.
function toLayer(img) {
  if (img.width === LAYER && img.height === LAYER) return img.rgba;
  const src = document.createElement("canvas");
  src.width = img.width;
  src.height = img.height;
  src.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
  const dst = document.createElement("canvas");
  dst.width = dst.height = LAYER;
  const ctx = dst.getContext("2d");
  ctx.drawImage(src, 0, 0, LAYER, LAYER);
  return new Uint8Array(ctx.getImageData(0, 0, LAYER, LAYER).data.buffer);
}

async function biomeArray(biomes) {
  const n = Math.max(biomes.length, 1);
  const data = new Uint8Array(LAYER * LAYER * 4 * n);
  await Promise.all(
    biomes.map(async (b, i) => {
      let px = null;
      if (b.base_texture) px = await loadTexture(b.base_texture).then(toLayer, () => null);
      if (px) data.set(px, i * LAYER * LAYER * 4);
      else {
        // Без текстуры слой заливается цветом подбиома.
        const c = b.color.map((x) => Math.round(x * 255));
        for (let k = 0; k < LAYER * LAYER; k++) data.set([c[0], c[1], c[2], 255], (i * LAYER * LAYER + k) * 4);
      }
    }),
  );
  const tex = new THREE.DataArrayTexture(data, LAYER, LAYER, n);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function brushTexture(img) {
  const tex = new THREE.DataTexture(img.rgba, img.width, img.height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// Триплоскостная выборка слоёв биома, смешанных по весам вершины, и ламбертовское освещение
// от источника, закреплённого за камерой.
const VERT = /* glsl */ `
  attribute vec4 weights0;
  attribute vec4 weights1;
  varying vec4 vW0;
  varying vec4 vW1;
  varying vec3 vPos;
  varying vec3 vNrm;
  varying vec3 vViewNrm;
  void main() {
    vW0 = weights0;
    vW1 = weights1;
    vPos = position;
    vNrm = normal;
    vViewNrm = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp sampler2DArray;
  uniform sampler2DArray uLayers;
  uniform vec3 uColors[${MAX_BIOMES}];
  uniform int uCount;
  uniform float uTile;
  uniform bool uTextured;
  uniform float uWater;
  uniform float uDepth;
  varying vec4 vW0;
  varying vec4 vW1;
  varying vec3 vPos;
  varying vec3 vNrm;
  varying vec3 vViewNrm;

  vec3 layer(int i, vec3 bw) {
    if (!uTextured) return uColors[i];
    vec3 p = vPos / uTile;
    float l = float(i);
    return texture(uLayers, vec3(p.yz, l)).rgb * bw.x
         + texture(uLayers, vec3(p.xz, l)).rgb * bw.y
         + texture(uLayers, vec3(p.xy, l)).rgb * bw.z;
  }

  void main() {
    vec3 n = normalize(vNrm);
    vec3 bw = pow(abs(n), vec3(4.0));
    bw /= bw.x + bw.y + bw.z;
    float w[${MAX_BIOMES}] = float[](vW0.x, vW0.y, vW0.z, vW0.w, vW1.x, vW1.y, vW1.z, vW1.w);
    vec3 c = vec3(0.0);
    float sum = 0.0;
    for (int i = 0; i < ${MAX_BIOMES}; i++) {
      if (i >= uCount || w[i] < 0.004) continue;
      c += layer(i, bw) * w[i];
      sum += w[i];
    }
    c = sum > 0.0 ? c / sum : vec3(0.5);
    // Под водой дно темнеет и синеет с глубиной.
    float r = length(vPos);
    if (uWater > 0.0 && r < uWater) {
      float d = clamp((uWater - r) / max(uDepth, 1.0), 0.0, 1.0);
      c = mix(c, vec3(0.08, 0.2, 0.32), 0.35 + 0.5 * d);
    }
    vec3 L = normalize(vec3(0.45, 0.65, 0.75));
    float lit = 0.35 + 0.8 * max(dot(normalize(vViewNrm), L), 0.0);
    gl_FragColor = vec4(c * lit, 1.0);
    #include <colorspace_fragment>
  }
`;

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

function weightAttributes(geo, p) {
  const n = p.positions.length;
  const k = p.biomes.length;
  const w0 = new Float32Array(n * 4);
  const w1 = new Float32Array(n * 4);
  const wts = p.biome_weights;
  for (let i = 0; i < n; i++) {
    for (let b = 0; b < Math.min(k, MAX_BIOMES); b++) {
      const v = (wts.length >= n * k ? wts[i * k + b] : p.biome_index[i] === b ? 255 : 0) / 255;
      (b < 4 ? w0 : w1)[i * 4 + (b % 4)] = v;
    }
  }
  geo.setAttribute("weights0", new THREE.BufferAttribute(w0, 4));
  geo.setAttribute("weights1", new THREE.BufferAttribute(w1, 4));
}

export function createScene(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f4f4f4");
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 100000);
  camera.position.set(0, 0, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.AmbientLight("#ffffff", 0.6));
  const sun = new THREE.DirectionalLight("#ffffff", 1.8);
  camera.add(sun);
  sun.position.set(0.45, 0.65, 0.75);
  scene.add(camera);

  const group = new THREE.Group();
  scene.add(group);
  let parts = {}, previousAspect = null;
  let templateLayer = null, project = null, planetRadius = 500, onPick = () => {};
  const picker = new THREE.Raycaster();
  let pointerStart = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { pointerStart = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!templateLayer || !pointerStart || Math.hypot(e.clientX-pointerStart[0], e.clientY-pointerStart[1]) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    picker.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1, -(e.clientY-r.top)/r.height*2+1), camera);
    group.updateMatrixWorld(true);
    // Поверхность участвует в проверке, чтобы нельзя было выбрать область на обратной стороне.
    const hits = picker.intersectObjects([parts.surface, ...templateLayer.zones.children.filter((g) => g.visible)], true);
    let o = hits[0]?.object;
    while (o && !o.userData.nodeId) o = o.parent;
    onPick(o?.userData.nodeId ?? null);
  });

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    if (previousAspect && camera.aspect > 0) {
      camera.position.multiplyScalar(Math.max(1, 1/camera.aspect)/Math.max(1, 1/previousAspect));
    }
    previousAspect = camera.aspect;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  function clear() {
    templateLayer?.dispose();
    templateLayer = null; project = null;
    group.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [o.material].flat()) {
        if (!m) continue;
        m.map?.dispose();
        m.uniforms?.uLayers?.value?.dispose();
        m.dispose();
      }
    });
    group.clear();
    parts = {};
  }

  async function show(p, { template = false } = {}) {
    const layers = await biomeArray(p.biomes);
    const brushMaps = await Promise.all(
      p.csg.brushes.map((b) =>
        b.op === "Add" && b.diffuse ? loadTexture(b.diffuse).then(brushTexture, () => null) : null,
      ),
    );
    clear();
    // Игра использует систему, где z направлена к полюсу; в three.js полюс: ось y.
    group.rotation.set(-Math.PI / 2, 0, 0);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(p.positions.flat()), 3));
    weightAttributes(geo, p);
    geo.setIndex(outward(p.positions, p.triangles));
    geo.computeVertexNormals();
    weldNormals(geo);
    const colors = Array.from({ length: MAX_BIOMES }, (_, i) =>
      new THREE.Color().setRGB(...(p.biomes[i]?.color ?? [0.5, 0.5, 0.5]).slice(0, 3), THREE.SRGBColorSpace),
    );
    const surfaceMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uLayers: { value: layers },
        uColors: { value: colors },
        uCount: { value: Math.min(p.biomes.length, MAX_BIOMES) },
        uTile: { value: TILE },
        uTextured: { value: true },
        uWater: { value: p.water_radius ?? 0 },
        uDepth: { value: Math.max((p.water_radius ?? 0) - p.min_radius, 1) },
      },
    });
    const surface = new THREE.Mesh(geo, surfaceMat);
    group.add(surface);
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: "#161616", transparent: true, opacity: 0.2 }),
    );
    group.add(wire);

    const add = new THREE.Group();
    const subtract = new THREE.Group();
    p.csg.brushes.forEach((b, i) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(b.positions.flat()), 3));
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(b.uvs.flat()), 2));
      g.setIndex(b.indices);
      if (b.op === "Add") {
        g.computeVertexNormals();
        const map = brushMaps[i];
        add.add(
          new THREE.Mesh(
            g,
            new THREE.MeshStandardMaterial({ map, color: map ? "#ffffff" : "#9a8f80", roughness: 0.95, side: THREE.DoubleSide }),
          ),
        );
      } else {
        subtract.add(
          new THREE.LineSegments(
            new THREE.WireframeGeometry(g),
            new THREE.LineBasicMaterial({ color: "#da1e28", transparent: true, opacity: 0.6 }),
          ),
        );
        g.dispose();
      }
    });
    group.add(add, subtract);

    const fluids = new THREE.Group();
    if (p.water_radius) {
      fluids.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(p.water_radius, 128, 64),
          new THREE.MeshStandardMaterial({ color: "#2f6fb0", transparent: true, opacity: 0.45, roughness: 0.25 }),
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
      new THREE.MeshStandardMaterial({ color: "#f1c21b", emissive: "#4a3600" }),
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
      new THREE.PointsMaterial({ color: "#a2191f", size: 6 }),
    );
    group.add(cand);

    parts = { surfaceMat, surface, wire, fluids, metal, cand, add, subtract };
    planetRadius = p.radius;
    if (template) project = createSurfaceProjector(p);
    const dist = p.max_radius * 3.2 * Math.max(1, 1/camera.aspect);
    if (camera.position.length() < p.max_radius * 1.2 || camera.position.length() > dist * 3) {
      camera.position.setLength(dist);
    }
    controls.minDistance = p.max_radius * 1.05;
  }

  function toggle(o) {
    if (!parts.wire) return;
    parts.surfaceMat.uniforms.uTextured.value = o.textures;
    parts.wire.visible = o.wire;
    parts.fluids.visible = o.water;
    parts.metal.visible = o.metal;
    parts.cand.visible = o.candidates;
    parts.add.visible = o.csg;
    parts.subtract.visible = o.subtract;
  }

  function setApplied(data, pick) {
    if (templateLayer) { group.remove(templateLayer.root); templateLayer.dispose(); templateLayer = null; }
    if (!data || !project) return;
    templateLayer = createTemplateLayer(project, data, planetRadius);
    group.add(templateLayer.root);
    onPick = pick;
    return templateLayer.placements;
  }
  return { show, toggle, setApplied,
    selectNode: (id) => templateLayer?.select(id),
    toggleApplied: (options) => templateLayer?.toggle(options),
  };
}
