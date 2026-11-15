//! Металлические точки: `paent::distributePointsOnPlanet` (кандидаты по золотой спирали)
//! и `distributeMetalSpotsOnPlanetRandomly` (кластеры вокруг кандидатов).
//!
//! Последовательность случайных чисел, кватернионы и порядок проверок повторяют игру.
//! Навигационная сетка и коллизии структур заменены приближением: проходимость задаётся
//! уклоном треугольника поверхности, перекрытия проверяются только между самими точками.

use serde::Serialize;

use crate::config::{PlanetBp, SymmetryType};
use crate::math::*;
use crate::raycast::Raycaster;
use crate::rng::Random;

#[derive(Clone, Copy, Debug)]
pub struct MetalOptions {
    /// Максимальный уклон проходимой поверхности, градусы.
    pub max_slope_deg: f32,
}

impl Default for MetalOptions {
    fn default() -> Self {
        Self { max_slope_deg: 40.0 }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct MetalSpot {
    pub pos: V3,
    pub normal: V3,
    /// Номер кандидата, вокруг которого поставлена точка.
    pub candidate: usize,
    /// Точка получена отражением по симметрии.
    pub mirrored: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct MetalResult {
    pub point_spacing: f32,
    pub candidates: Vec<V3>,
    pub spots: Vec<MetalSpot>,
    /// В игре при заданном `metalSpotLimit` точки перемешиваются `std::random_device`
    /// и обрезаются; такой результат не повторяется даже в самой игре.
    pub limit_is_random: bool,
}

#[derive(Clone, Copy)]
struct Obb {
    pos: V3,
    half: V3,
    axes: [V3; 3],
}

impl Obb {
    fn new(pos: V3, normal: V3, half: V3) -> Obb {
        let m = Quat::from_dir_to_dir([0.0, 0.0, 1.0], normal).matrix();
        Obb { pos, half, axes: [m[0], m[1], m[2]] }
    }

    fn radius_on(&self, axis: V3) -> f32 {
        (0..3).map(|i| self.half[i] * dot(self.axes[i], axis).abs()).sum()
    }

    /// Теорема о разделяющей оси, 15 осей.
    fn overlaps(&self, o: &Obb) -> bool {
        let d = sub(o.pos, self.pos);
        let r = length(self.half) + length(o.half);
        if dot(d, d) > r * r {
            return false;
        }
        let mut axes: Vec<V3> = Vec::with_capacity(15);
        axes.extend_from_slice(&self.axes);
        axes.extend_from_slice(&o.axes);
        for a in &self.axes {
            for b in &o.axes {
                let c = cross(*a, *b);
                if dot(c, c) > 1e-10 {
                    axes.push(normalize(c));
                }
            }
        }
        axes.iter().all(|&ax| dot(d, ax).abs() <= self.radius_on(ax) + o.radius_on(ax))
    }
}

fn passable(min_up: f32, pos: V3, normal: V3) -> bool {
    dot(normalize(pos), normal) >= min_up
}

/// Кандидаты: точки золотой спирали, опущенные лучом на поверхность.
pub fn candidates(rc: &Raycaster, radius: f32, spacing: f32, max_h: f32, min_h: f32, min_up: f32) -> Vec<V3> {
    let count = ((radius * radius * 12.566_371) / (spacing * spacing)).ceil() as i32;
    let step = 2.0 / count as f32;
    let q = Quat::from_vec_to_vec([0.0, 0.0, 1.0], [0.0, 1.0, 0.0])
        .mul(Quat::IDENTITY)
        .mul(Quat::from_vec_to_vec(golden_spiral_dir(0, step), [0.0, 0.0, 1.0]));
    let m = q.matrix();
    let outer = max_h + 15.0;
    let inner = min_h - 15.0;
    let mut out = Vec::new();
    for i in 0..count {
        let d = mul_row(golden_spiral_dir(i, step), &m);
        if let Some(hit) = rc.segment(scale(d, outer), scale(d, inner)) {
            if passable(min_up, hit.pos, hit.normal) {
                out.push(hit.pos);
            }
        }
    }
    out
}

/// Распределение размеров кластеров: пары (вес, размер).
fn cluster_weights(bp: &PlanetBp, candidates: usize) -> Vec<(u32, u32)> {
    let m2 = bp.metal_clusters + bp.metal_clusters;
    let mut list = Vec::new();
    for i in 0..4u32 {
        let t = i as f32 / 3.0;
        let mut w = 1.0 - i as f32 * 0.25;
        if m2 < 1.0 {
            w -= ((t + t) - 1.0) * (1.0 - m2);
        } else if m2 > 1.0 {
            w += ((t + t) - 1.0) * (m2 - 1.0);
        }
        if w > 0.0 {
            list.push(((w * 10.0).ceil() as i64 as u32, i + 1));
        }
    }
    let sum: u32 = list.iter().map(|e| e.0).fold(0, u32::wrapping_add);
    let density = bp.metal_density;
    if density.abs() <= 0.001 {
        list.clear();
    }
    let zero = (candidates as f32 * 1.5 * (1.0 - density) + sum as f32) as i64 as u32;
    list.push((zero, 0));
    list
}

pub fn generate(bp: &PlanetBp, rc: &Raycaster, max_h: f32, min_h: f32, opts: MetalOptions) -> MetalResult {
    let radius = bp.radius;
    let spacing = (radius * radius / (radius / 25.0)).sqrt();
    let min_up = opts.max_slope_deg.to_radians().cos();
    let cands = candidates(rc, radius, spacing, max_h, min_h, min_up);
    let weights = cluster_weights(bp, cands.len());
    let total: u32 = weights.iter().map(|e| e.0).fold(0, u32::wrapping_add);

    let ps = bp.archetype.metal_placement_size;
    let e = (ps[0] * 0.5).max(ps[1] * 0.5) * 1.414_213_5 + 1.0;
    let half = [e, e, ps[2] * 0.5];
    let spread = (spacing * 0.5) / radius;
    let cl = Cluster { rc, min_up, spread, outer: max_h + 5.0, inner: min_h - 5.0, half };
    let symmetric = bp.symmetry_type == SymmetryType::TerrainCsg && bp.symmetrical_metal;

    let mut rng = Random::new(bp.random_seed);
    let mut obbs: Vec<Obb> = Vec::new();
    let mut spots: Vec<MetalSpot> = Vec::new();

    if total > 0 {
        for (ci, &c) in cands.iter().enumerate() {
            if symmetric && c[2] < 0.0 {
                continue;
            }
            let mut r = rng.rand32() % total;
            let mut size = 0;
            for &(w, v) in &weights {
                if r < w {
                    size = v;
                    break;
                }
                r -= w;
            }
            cl.place(&mut rng, c, size as i32, ci, &mut obbs, &mut spots);
        }
    }

    if symmetric {
        let flip = |v: V3| [v[0], v[1], -v[2]];
        let mut all = Vec::with_capacity(spots.len() * 2);
        for s in spots {
            let m = MetalSpot { pos: flip(s.pos), normal: flip(s.normal), candidate: s.candidate, mirrored: true };
            all.push(s);
            all.push(m);
        }
        spots = all;
    }

    MetalResult { point_spacing: spacing, candidates: cands, spots, limit_is_random: bp.metal_spot_limit != -1 }
}

struct Cluster<'a> {
    rc: &'a Raycaster,
    min_up: f32,
    spread: f32,
    outer: f32,
    inner: f32,
    half: V3,
}

impl Cluster<'_> {
    /// Лямбда кластера: до `size` точек, не больше `size * 30` неудачных попыток.
    fn place(&self, rng: &mut Random, pos: V3, size: i32, candidate: usize, obbs: &mut Vec<Obb>, spots: &mut Vec<MetalSpot>) {
        let [x, y, z] = normalize(pos);
        let mut placed = 0;
        let mut fails = 0;
        while placed < size {
            if fails >= size * 30 {
                return;
            }
            let f1 = rng.float();
            let f2 = rng.float();
            let lo = -self.spread;
            let ang1 = (self.spread - lo) * f1 + lo;
            let ang2 = (self.spread - lo) * f2 + lo;

            // Перпендикуляр к направлению: n × X, при вырождении n × Y, затем n × Z.
            let mut p = [0.0, z, -y];
            if length(p).abs() <= 0.001 {
                p = [-z, 0.0, x];
                if length(p).abs() <= 0.001 {
                    p = [y, -x, 0.0];
                }
            }
            let a2 = normalize(p);
            let a1 = [a2[2] * y - a2[1] * z, a2[0] * z - x * a2[2], x * a2[1] - a2[0] * y];
            let m = Quat::from_axis_angle(a2, ang2).mul(Quat::from_axis_angle(a1, ang1)).matrix();
            let d = mul_row([x, y, z], &m);

            let ok = self
                .rc
                .segment(scale(d, self.outer), scale(d, self.inner))
                .filter(|h| passable(self.min_up, h.pos, h.normal))
                .map(|h| (h, Obb::new(h.pos, h.normal, self.half)))
                .filter(|(_, b)| !obbs.iter().any(|o| o.overlaps(b)));
            match ok {
                Some((hit, obb)) => {
                    obbs.push(obb);
                    placed += 1;
                    spots.push(MetalSpot { pos: hit.pos, normal: hit.normal, candidate, mirrored: false });
                }
                None => fails += 1,
            }
        }
    }
}
