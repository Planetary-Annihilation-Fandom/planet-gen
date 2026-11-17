//! Кубосфера `PlanetSurface`: сурфели, высоты `genHeight`, нормали и сетка поверхности.

use crate::config::PlanetBp;
use crate::math::*;
use crate::noise::simplex_scaled;

#[derive(Clone, Copy, Debug, Default)]
pub struct Surfel {
    pub face: u8,
    pub x: u16,
    pub y: u16,
    pub pos: V3,
    pub normal: V3,
    pub surface_normal: V3,
    /// Нормированная высота после водной поправки.
    pub height: f32,
    /// Серый цвет по исходной высоте: `h * 0.5 + 0.5`.
    pub color: f32,
}

pub struct Surface {
    /// Число сурфелей по стороне грани.
    pub n: usize,
    pub surfels: Vec<Surfel>,
}

impl Surface {
    pub fn index(&self, face: usize, x: usize, y: usize) -> usize {
        self.n * (self.n * face + y) + x
    }

    /// `PlanetSurface::generateSurface`: равномерная по углам сетка на каждой грани.
    pub fn generate(radius: f32, plate_size: f32) -> Surface {
        let n = ((radius + radius) / plate_size).ceil().max(2.0) as usize;
        let mut surfels = vec![Surfel::default(); n * n * 6];
        let step = 1.0f64 / (n as f64 - 1.0);
        for face in 0..6 {
            let a = make_dir(face as i32);
            let b = make_dir(face as i32 + 2);
            let c = cross(a, b);
            let k = 1.0 / ((c[1] * c[1] + c[0] * c[0] + c[2] * c[2]).sqrt() + F32_EPS);
            let cx = k * c[0];
            let cy = k * c[1];
            let cz = k * c[2];
            let c2 = [(cx as f64) * 2.0, (cy as f64) * 2.0, (cz as f64) * 2.0];
            let v0: D3 = [(a[0] - (cx + b[0])) as f64, (a[1] - (cy + b[1])) as f64, (a[2] - (cz + b[2])) as f64];
            let n0 = normalize_d(v0);
            let n1 = normalize_d([c2[0] + v0[0], c2[1] + v0[1], v0[2] + c2[2]]);
            let v2: D3 = [
                b[0] as f64 + b[0] as f64 + v0[0],
                b[1] as f64 + b[1] as f64 + v0[1],
                b[2] as f64 + b[2] as f64 + v0[2],
            ];
            let n2 = normalize_d(v2);
            let n3 = normalize_d([v2[0] + c2[0], v2[1] + c2[1], v2[2] + c2[2]]);
            let axis_a = cross_d(n0, n1);
            let ang_a = (n1[1] * n0[1] + n1[0] * n0[0] + n1[2] * n0[2]).acos();
            let axis_b = cross_d(n2, n3);
            let ang_b = (n3[1] * n2[1] + n3[0] * n2[0] + n3[2] * n2[2]).acos();
            for y in 0..n {
                let r1 = rotation_d(axis_a, y as f64 * ang_a * step);
                let r2 = rotation_d(axis_b, y as f64 * ang_b * step);
                let p = mul_row_d(n0, &r1);
                let q = mul_row_d(n2, &r2);
                let axis_c = cross_d(p, q);
                let ang_c = (q[1] * p[1] + q[0] * p[0] + q[2] * p[2]).acos();
                for x in 0..n {
                    let r = rotation_d(axis_c, x as f64 * ang_c * step);
                    let d = mul_row_d(p, &r);
                    let k = 1.0 / ((d[1] * d[1] + d[0] * d[0] + d[2] * d[2]).sqrt() + F64_EPS);
                    let rd = radius as f64;
                    let s = &mut surfels[n * (n * face + y) + x];
                    s.face = face as u8;
                    s.x = x as u16;
                    s.y = y as u16;
                    s.normal = [(d[0] * k) as f32, (d[1] * k) as f32, (d[2] * k) as f32];
                    s.pos = [(rd * d[0] * k) as f32, (rd * d[1] * k) as f32, (rd * d[2] * k) as f32];
                }
            }
        }
        Surface { n, surfels }
    }

    /// `PlanetBuilder::genHeight` для всех сурфелей.
    pub fn gen_height(&mut self, bp: &PlanetBp) {
        for s in &mut self.surfels {
            gen_height(bp, s);
        }
    }

    /// `PlanetBuilder::genSurfaceNormals`.
    pub fn gen_surface_normals(&mut self) {
        let n = self.n;
        for f in 0..6 {
            for y in 0..n {
                for x in 0..n {
                    let i = self.index(f, x, y);
                    let p = self.surfels[i].pos;
                    let edge = x == 0 || y == 0 || x == n - 1 || y == n - 1;
                    let sn = if edge {
                        normalize(p)
                    } else {
                        let px = self.surfels[self.index(f, x + 1, y)].pos;
                        let py = self.surfels[self.index(f, x, y + 1)].pos;
                        let mut c = normalize(cross(sub(px, p), sub(py, p)));
                        if dot(c, p) < 0.0 {
                            c = scale(c, -1.0);
                        }
                        c
                    };
                    self.surfels[i].surface_normal = sn;
                }
            }
        }
    }

    /// `PlanetBuilder::mirrorSurface`: северная половина (z > 0) отражается на южную.
    pub fn mirror(&mut self, bp: &PlanetBp) {
        let n = self.n;
        for f in 0..6 {
            if f == 5 {
                continue;
            }
            for y in 0..n {
                for x in 0..n {
                    let src = self.surfels[self.index(f, x, y)];
                    let target = if f == 4 {
                        self.index(5, n - 1 - x, y)
                    } else {
                        if src.normal[2] <= 0.0 {
                            continue;
                        }
                        // Ось z на гранях 0–3 идёт вдоль x или вдоль y; берём ту, где отражение точное.
                        let a = self.index(f, n - 1 - x, y);
                        let b = self.index(f, x, n - 1 - y);
                        let want = [src.normal[0], src.normal[1], -src.normal[2]];
                        let da = length(sub(self.surfels[a].normal, want));
                        let db = length(sub(self.surfels[b].normal, want));
                        if da <= db { a } else { b }
                    };
                    let t = &mut self.surfels[target];
                    t.height = src.height;
                    t.color = src.color;
                    let r = src.height * bp.height_range + bp.radius;
                    t.pos = [r * t.normal[0], r * t.normal[1], r * t.normal[2]];
                }
            }
        }
    }

    /// Треугольники сетки поверхности в порядке `createSurfaceMeshes`.
    pub fn triangles(&self) -> Vec<[u32; 3]> {
        let n = self.n;
        let mut out = Vec::with_capacity(6 * (n - 1) * (n - 1) * 2);
        for f in 0..6 {
            for y in 0..n - 1 {
                for x in 0..n - 1 {
                    let a = self.index(f, x, y) as u32;
                    let b = self.index(f, x + 1, y) as u32;
                    let c = self.index(f, x, y + 1) as u32;
                    let d = self.index(f, x + 1, y + 1) as u32;
                    out.push([a, c, d]);
                    out.push([a, d, b]);
                }
            }
        }
        out
    }
}

#[inline]
fn cross_d(a: D3, b: D3) -> D3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/// Исходное шумовое поле до поправок рельефа и воды. `p` задаётся на исходной сфере,
/// поэтому добавление корректировки высоты не меняет положение самого рисунка шума.
pub fn height_noise(bp: &PlanetBp, p: V3) -> f32 {
    simplex_scaled(bp.height_octaves, bp.height_persistence, bp.height_scale_rule,
        -1.0, 1.0, p[0], p[1], p[2], bp.height_seed)
}

/// Рассчитывает высоту одного сурфеля: шум → локальные цели → поправка дна.
/// На входе `s.pos` должна лежать на исходной сфере; повторный вызов на уже поднятой
/// вершине изменит и выборку шума, и расстояния до центров корректировок.
/// Геометрия получает высоту после водной поправки, цвет сохраняет значение до неё.
pub fn gen_height(bp: &PlanetBp, s: &mut Surfel) {
    let [px, py, pz] = s.pos;
    let range = bp.height_range;
    let mut h = height_noise(bp, [px, py, pz]) * range;
    // genHeight: расстояние по хорде исходной сферы. Области применяются
    // последовательно, каждая смешивает текущую высоту со своей целевой.
    for adj in &bp.height_adjustments {
        let dz = pz - adj.pos[2];
        let dx = px - adj.pos[0];
        let dy = py - adj.pos[1];
        let d = (dy * dy + dx * dx + dz * dz).sqrt();
        if d < adj.radius {
            h = (d / adj.radius) * (h - adj.adjustment) + adj.adjustment;
        }
    }
    let h0 = if range.abs() > f32::EPSILON { h / range } else { 0.0 };
    let mut h = h0;
    let wh = bp.water_height;
    // Под уровнем жидкости дно опускается пропорционально глубине, но максимум
    // на 16 мировых единиц от этого уровня. Это правило генерации геометрии,
    // а не проверка фактической доступности воды для навигации.
    if h0 <= wh {
        h = h0 - (wh - h0) * bp.water_depth;
        if 16.0 <= (wh - h) * range {
            h = wh - 16.0 / range;
        }
    }
    s.height = h;
    let [nx, ny, nz] = s.normal;
    s.pos = [h * nx * range + px, ny * h * range + py, nz * h * range + pz];
    s.color = h0 * 0.5 + 0.5;
}
