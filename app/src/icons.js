import * as THREE from "three";
import { KINDS } from "./template-engine.js";

// Векторные контуры, общие для значков на планете, нод и легенды.
export const ICON_PATHS = {
  spawn: ["M6 22V3", "M6 4C10 1 14 7 20 4V14C14 17 10 11 6 14"],
  front: ["M12 4A8 8 0 1 0 12 20A8 8 0 1 0 12 4", "M8 12H16", "M12 8V16"],
  metal: ["M4 8L8 3H16L20 8L12 21Z", "M4 8H20", "M8 3L12 8L16 3", "M12 8V21"],
  blocker: ["M3 4H21V20H3Z", "M3 9H21", "M3 15H21", "M9 4V9", "M15 9V15", "M9 15V20"],
  ramp: ["M3 18L21 6V18Z", "M3 22H21", "M16 18V14", "M11 18V17"],
};

export function iconSVG(kind) {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", KINDS[kind]);
  svg.setAttribute("stroke-width", "2"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  for (const d of ICON_PATHS[kind]) { const path = document.createElementNS(ns, "path"); path.setAttribute("d", d); svg.append(path); }
  return svg;
}

export function iconTexture(kind) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d"); ctx.scale(4, 4);
  ctx.beginPath(); ctx.arc(16, 16, 14.5, 0, Math.PI*2);
  ctx.fillStyle = "#fffffff2"; ctx.fill();
  ctx.strokeStyle = KINDS[kind]; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.translate(4, 4); ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const path of ICON_PATHS[kind]) ctx.stroke(new Path2D(path));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
