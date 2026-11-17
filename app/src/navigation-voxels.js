import * as THREE from "three";

/** Рисует рёбра кубов из компактного буфера IPC, переиспользуя одну геометрию на все ячейки. */
export function createNavigationVoxels(buffer) {
  const size = new DataView(buffer).getFloat32(0, true);
  const cells = new THREE.InstancedInterleavedBuffer(new Int16Array(buffer, 4), 4);
  const box = new THREE.BoxGeometry(size, size, size);
  const edges = new THREE.EdgesGeometry(box);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", edges.getAttribute("position"));
  geometry.setAttribute("cell", new THREE.InterleavedBufferAttribute(cells, 3, 0));
  geometry.setAttribute("blocked", new THREE.InterleavedBufferAttribute(cells, 1, 3));
  geometry.instanceCount = cells.count;
  box.dispose();
  edges.dispose();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      size: { value: size },
      passableColor: { value: new THREE.Color("#42be65") },
      blockedColor: { value: new THREE.Color("#fa4d56") },
    },
    vertexShader: `
      uniform float size;
      attribute vec3 cell;
      attribute float blocked;
      varying float vBlocked;
      void main() {
        vBlocked = blocked;
        vec3 worldPosition = (cell + 0.5) * size + position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPosition, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 passableColor;
      uniform vec3 blockedColor;
      varying float vBlocked;
      void main() {
        gl_FragColor = vec4(mix(passableColor, blockedColor, vBlocked), mix(0.25, 0.65, vBlocked));
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  // Three вычисляет границы по исходному кубу, а смещения хранятся в отдельном атрибуте.
  lines.frustumCulled = false;
  return lines;
}
