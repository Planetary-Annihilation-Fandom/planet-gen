//! Луч против сетки поверхности. Заменяет BVH `CollisionGeometry` игры: треугольники
//! раскладываются по корзинам в гномонических координатах своей грани куба.

use crate::math::*;
use crate::surface::Surface;

#[derive(Clone, Copy, Debug)]
pub struct Hit {
    pub pos: V3,
    pub normal: V3,
    pub t: f32,
}

pub struct Raycaster {
    verts: Vec<V3>,
    tris: Vec<[u32; 3]>,
    bins: usize,
    /// Для каждой грани и корзины: индексы треугольников.
    cells: Vec<Vec<u32>>,
}

fn frame(face: usize) -> (V3, V3, V3) {
    let a = make_dir(face as i32);
    let (u, v) = match face / 2 {
        0 => ([0.0, 1.0, 0.0], [0.0, 0.0, 1.0]),
        1 => ([0.0, 0.0, 1.0], [1.0, 0.0, 0.0]),
        _ => ([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
    };
    (a, u, v)
}

fn uv(face: usize, p: V3) -> Option<(f32, f32)> {
    let (a, u, v) = frame(face);
    let d = dot(p, a);
    if d <= 0.0 {
        return None;
    }
    Some((dot(p, u) / d, dot(p, v) / d))
}

fn faces_of(d: V3) -> [Option<usize>; 2] {
    let mut axes: Vec<(f32, usize)> = (0..3)
        .map(|k| (d[k].abs(), k * 2 + if d[k] < 0.0 { 1 } else { 0 }))
        .collect();
    axes.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
    let second = (axes[1].0 > axes[0].0 * 0.98).then_some(axes[1].1);
    [Some(axes[0].1), second]
}

impl Raycaster {
    pub fn new(surface: &Surface) -> Raycaster {
        let verts: Vec<V3> = surface.surfels.iter().map(|s| s.pos).collect();
        let tris = surface.triangles();
        let bins = surface.n.max(4);
        let mut cells = vec![Vec::new(); 6 * bins * bins];
        let per_face = tris.len() / 6;
        for (ti, t) in tris.iter().enumerate() {
            let face = ti / per_face;
            let mut lo = (f32::MAX, f32::MAX);
            let mut hi = (f32::MIN, f32::MIN);
            for &vi in t {
                if let Some((u, v)) = uv(face, verts[vi as usize]) {
                    lo = (lo.0.min(u), lo.1.min(v));
                    hi = (hi.0.max(u), hi.1.max(v));
                }
            }
            let (u0, v0) = (Self::bin(bins, lo.0), Self::bin(bins, lo.1));
            let (u1, v1) = (Self::bin(bins, hi.0), Self::bin(bins, hi.1));
            for bv in v0..=v1 {
                for bu in u0..=u1 {
                    cells[(face * bins + bv) * bins + bu].push(ti as u32);
                }
            }
        }
        Raycaster { verts, tris, bins, cells }
    }

    /// Произвольная сетка вокруг центра планеты: треугольник попадает в корзины граней куба,
    /// на которые проецируются его вершины.
    pub fn from_mesh(verts: Vec<V3>, tris: Vec<[u32; 3]>, bins: usize) -> Raycaster {
        let bins = bins.max(4);
        let mut cells = vec![Vec::new(); 6 * bins * bins];
        for (ti, t) in tris.iter().enumerate() {
            let mut faces: Vec<usize> = t.iter().flat_map(|&vi| faces_of(verts[vi as usize])).flatten().collect();
            faces.sort_unstable();
            faces.dedup();
            for face in faces {
                let mut lo = (f32::MAX, f32::MAX);
                let mut hi = (f32::MIN, f32::MIN);
                for &vi in t {
                    if let Some((u, v)) = uv(face, verts[vi as usize]) {
                        lo = (lo.0.min(u), lo.1.min(v));
                        hi = (hi.0.max(u), hi.1.max(v));
                    }
                }
                if lo.0 > hi.0 {
                    continue;
                }
                let (u0, v0) = (Self::bin(bins, lo.0), Self::bin(bins, lo.1));
                let (u1, v1) = (Self::bin(bins, hi.0), Self::bin(bins, hi.1));
                for bv in v0..=v1 {
                    for bu in u0..=u1 {
                        cells[(face * bins + bv) * bins + bu].push(ti as u32);
                    }
                }
            }
        }
        Raycaster { verts, tris, bins, cells }
    }

    fn bin(bins: usize, c: f32) -> usize {
        (((c + 1.0) * 0.5 * bins as f32).floor().max(0.0) as usize).min(bins - 1)
    }

    /// Ближайшее к `start` пересечение отрезка, идущего через центр планеты.
    pub fn segment(&self, start: V3, end: V3) -> Option<Hit> {
        let dir = sub(end, start);
        let mut best: Option<Hit> = None;
        for face in faces_of(start).into_iter().flatten() {
            let Some((u, v)) = uv(face, start) else { continue };
            let cell = (face * self.bins + Self::bin(self.bins, v)) * self.bins + Self::bin(self.bins, u);
            for &ti in &self.cells[cell] {
                let [a, b, c] = self.tris[ti as usize].map(|i| self.verts[i as usize]);
                if let Some(t) = intersect(start, dir, a, b, c) {
                    if best.as_ref().map_or(true, |h| t < h.t) {
                        let mut nrm = normalize(cross(sub(b, a), sub(c, a)));
                        if dot(nrm, a) < 0.0 {
                            nrm = scale(nrm, -1.0);
                        }
                        best = Some(Hit { pos: add(start, scale(dir, t)), normal: nrm, t });
                    }
                }
            }
        }
        best
    }
}

/// Möller–Trumbore для отрезка `orig + dir * t`, t ∈ [0, 1], обе стороны треугольника.
fn intersect(orig: V3, dir: V3, a: V3, b: V3, c: V3) -> Option<f32> {
    let e1 = sub(b, a);
    let e2 = sub(c, a);
    let p = cross(dir, e2);
    let det = dot(e1, p);
    if det.abs() < 1e-12 {
        return None;
    }
    let inv = 1.0 / det;
    let s = sub(orig, a);
    let u = dot(s, p) * inv;
    if !(-1e-6..=1.0 + 1e-6).contains(&u) {
        return None;
    }
    let q = cross(s, e1);
    let v = dot(dir, q) * inv;
    if v < -1e-6 || u + v > 1.0 + 1e-6 {
        return None;
    }
    let t = dot(e2, q) * inv;
    (0.0..=1.0).contains(&t).then_some(t)
}
