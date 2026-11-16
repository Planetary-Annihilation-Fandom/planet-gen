//! BSP-дерево замкнутого меша: делит многоугольники других тел на куски, каждый из которых
//! целиком лежит внутри или снаружи тела. Используется булевыми операциями CSG (`csg::boolean`).

pub type D3 = [f64; 3];

/// Число интерполируемых атрибутов вершины: веса биомов и высоты у поверхности, UV у кисти.
pub const NA: usize = 10;

/// Допуск расстояния до плоскости в мировых единицах.
const EPS: f64 = 1e-4;

#[derive(Clone, Copy, Debug)]
pub struct Vtx {
    pub p: D3,
    pub a: [f32; NA],
}

impl Vtx {
    pub fn lerp(&self, o: &Vtx, t: f64) -> Vtx {
        let mut a = [0f32; NA];
        let tf = t as f32;
        for i in 0..NA {
            a[i] = self.a[i] + (o.a[i] - self.a[i]) * tf;
        }
        Vtx { p: lerp3(self.p, o.p, t), a }
    }
}

pub fn lerp3(a: D3, b: D3, t: f64) -> D3 {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}
pub fn sub3(a: D3, b: D3) -> D3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub fn dot3(a: D3, b: D3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub fn cross3(a: D3, b: D3) -> D3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
pub fn len3(a: D3) -> f64 {
    dot3(a, a).sqrt()
}

#[derive(Clone, Copy, Debug)]
pub struct Plane {
    pub n: D3,
    pub w: f64,
}

impl Plane {
    pub fn from_points(a: D3, b: D3, c: D3) -> Option<Plane> {
        let n = cross3(sub3(b, a), sub3(c, a));
        let l = len3(n);
        if l < 1e-12 {
            return None;
        }
        let n = [n[0] / l, n[1] / l, n[2] / l];
        Some(Plane { n, w: dot3(n, a) })
    }
}

/// Выпуклый многоугольник; `tag` — номер группы материала исходного треугольника.
#[derive(Clone, Debug)]
pub struct Poly {
    pub v: Vec<Vtx>,
    pub plane: Plane,
    pub tag: u32,
}

impl Poly {
    pub fn new(v: Vec<Vtx>, tag: u32) -> Option<Poly> {
        let plane = Plane::from_points(v[0].p, v[1].p, v[2].p)?;
        Some(Poly { v, plane, tag })
    }

    pub fn flip(&mut self) {
        self.v.reverse();
        self.plane.n = [-self.plane.n[0], -self.plane.n[1], -self.plane.n[2]];
        self.plane.w = -self.plane.w;
    }

    pub fn centroid(&self) -> D3 {
        let mut c = [0.0; 3];
        for v in &self.v {
            c = [c[0] + v.p[0], c[1] + v.p[1], c[2] + v.p[2]];
        }
        let k = 1.0 / self.v.len() as f64;
        [c[0] * k, c[1] * k, c[2] * k]
    }

    /// Площадь многоугольника.
    pub fn area(&self) -> f64 {
        let mut s = [0.0; 3];
        for i in 1..self.v.len() - 1 {
            let c = cross3(sub3(self.v[i].p, self.v[0].p), sub3(self.v[i + 1].p, self.v[0].p));
            s = [s[0] + c[0], s[1] + c[1], s[2] + c[2]];
        }
        0.5 * len3(s)
    }
}

/// Делит многоугольник плоскостью. Лежащий в плоскости многоугольник уходит вперёд,
/// если смотрит в ту же сторону, иначе назад.
pub fn split(plane: &Plane, p: &Poly, front: &mut Vec<Poly>, back: &mut Vec<Poly>) {
    const COPLANAR: u8 = 0;
    const FRONT: u8 = 1;
    const BACK: u8 = 2;
    let mut kind = 0u8;
    let types: Vec<u8> = p
        .v
        .iter()
        .map(|v| {
            let t = dot3(plane.n, v.p) - plane.w;
            let k = if t < -EPS {
                BACK
            } else if t > EPS {
                FRONT
            } else {
                COPLANAR
            };
            kind |= k;
            k
        })
        .collect();
    match kind {
        COPLANAR => {
            if dot3(plane.n, p.plane.n) > 0.0 {
                front.push(p.clone())
            } else {
                back.push(p.clone())
            }
        }
        FRONT => front.push(p.clone()),
        BACK => back.push(p.clone()),
        _ => {
            let mut f = Vec::with_capacity(p.v.len() + 1);
            let mut b = Vec::with_capacity(p.v.len() + 1);
            let n = p.v.len();
            for i in 0..n {
                let j = (i + 1) % n;
                let (ti, tj) = (types[i], types[j]);
                let (vi, vj) = (&p.v[i], &p.v[j]);
                if ti != BACK {
                    f.push(*vi);
                }
                if ti != FRONT {
                    b.push(*vi);
                }
                if (ti | tj) == (FRONT | BACK) {
                    let t = (plane.w - dot3(plane.n, vi.p)) / dot3(plane.n, sub3(vj.p, vi.p));
                    let v = vi.lerp(vj, t);
                    f.push(v);
                    b.push(v);
                }
            }
            if f.len() >= 3 {
                front.push(Poly { v: f, plane: p.plane, tag: p.tag });
            }
            if b.len() >= 3 {
                back.push(Poly { v: b, plane: p.plane, tag: p.tag });
            }
        }
    }
}

const NONE: u32 = u32::MAX;

struct Node {
    plane: Plane,
    front: u32,
    back: u32,
}

/// BSP-дерево тела. Лист без заднего потомка — сплошное пространство.
pub struct Bsp {
    nodes: Vec<Node>,
}

impl Bsp {
    pub fn build(polys: Vec<Poly>) -> Bsp {
        let mut nodes: Vec<Node> = Vec::new();
        if polys.is_empty() {
            return Bsp { nodes };
        }
        // Явный стек вместо рекурсии: глубина дерева может достигать тысяч узлов.
        let mut stack: Vec<(u32, Vec<Poly>)> = Vec::new();
        let polys = with_best_first(polys);
        nodes.push(Node { plane: polys[0].plane, front: NONE, back: NONE });
        stack.push((0, polys));
        while let Some((ni, list)) = stack.pop() {
            let plane = nodes[ni as usize].plane;
            let (mut f, mut b) = (Vec::new(), Vec::new());
            for p in &list[1..] {
                let mut cf = Vec::new();
                let mut cb = Vec::new();
                split(&plane, p, &mut cf, &mut cb);
                // Многоугольники в плоскости узла уже учтены им.
                for q in cf {
                    if !coplanar(&plane, &q) {
                        f.push(q);
                    }
                }
                for q in cb {
                    if !coplanar(&plane, &q) {
                        b.push(q);
                    }
                }
            }
            if !f.is_empty() {
                let f = with_best_first(f);
                let id = nodes.len() as u32;
                nodes.push(Node { plane: f[0].plane, front: NONE, back: NONE });
                nodes[ni as usize].front = id;
                stack.push((id, f));
            }
            if !b.is_empty() {
                let b = with_best_first(b);
                let id = nodes.len() as u32;
                nodes.push(Node { plane: b[0].plane, front: NONE, back: NONE });
                nodes[ni as usize].back = id;
                stack.push((id, b));
            }
        }
        Bsp { nodes }
    }

    /// Делит многоугольник на куски и сообщает для каждого, лежит ли он внутри тела.
    /// Если все куски поддерева оказались по одну сторону, возвращается исходный многоугольник:
    /// плоскости дерева продолжаются за пределы тела и иначе дробили бы поверхность впустую.
    pub fn classify(&self, p: Poly, out: &mut Vec<(Poly, bool)>) {
        if self.nodes.is_empty() {
            out.push((p, false));
            return;
        }
        self.classify_at(0, p, out);
    }

    fn classify_at(&self, ni: u32, poly: Poly, out: &mut Vec<(Poly, bool)>) {
        let node = &self.nodes[ni as usize];
        let (mut f, mut b) = (Vec::new(), Vec::new());
        split(&node.plane, &poly, &mut f, &mut b);
        let start = out.len();
        for q in f {
            if node.front == NONE {
                out.push((q, false));
            } else {
                self.classify_at(node.front, q, out);
            }
        }
        for q in b {
            if node.back == NONE {
                out.push((q, true));
            } else {
                self.classify_at(node.back, q, out);
            }
        }
        let first = out[start].1;
        if out.len() - start > 1 && out[start..].iter().all(|x| x.1 == first) {
            out.truncate(start);
            out.push((poly, first));
        }
    }
}

/// Ставит первым многоугольник, чья плоскость меньше всего режет остальные и делит их ровнее.
/// Проверяются несколько равномерно выбранных кандидатов на выборке многоугольников.
fn with_best_first(mut polys: Vec<Poly>) -> Vec<Poly> {
    let n = polys.len();
    if n < 4 {
        return polys;
    }
    let cand = 8.min(n);
    let probe = 64.min(n);
    let mut best = (usize::MAX, 0usize);
    for c in 0..cand {
        let ci = c * n / cand;
        let pl = polys[ci].plane;
        let (mut fr, mut bk, mut sp) = (0usize, 0usize, 0usize);
        for k in 0..probe {
            let p = &polys[k * n / probe];
            let (mut f, mut b) = (false, false);
            for v in &p.v {
                let t = dot3(pl.n, v.p) - pl.w;
                f |= t > EPS;
                b |= t < -EPS;
            }
            match (f, b) {
                (true, true) => sp += 1,
                (true, false) => fr += 1,
                (false, true) => bk += 1,
                _ => {}
            }
        }
        let score = sp * 8 + fr.abs_diff(bk);
        if score < best.0 {
            best = (score, ci);
        }
    }
    polys.swap(0, best.1);
    polys
}

fn coplanar(plane: &Plane, p: &Poly) -> bool {
    p.v.iter().all(|v| (dot3(plane.n, v.p) - plane.w).abs() <= EPS)
}

/// Делит многоугольник по нулю функции `f`, линейно интерполируя её значения в вершинах.
/// `f < 0` считается внутренней стороной.
pub fn split_field(p: &Poly, vals: &[f64], inside: &mut Vec<Poly>, outside: &mut Vec<Poly>) {
    let neg = vals.iter().any(|&v| v < 0.0);
    let pos = vals.iter().any(|&v| v >= 0.0);
    if !pos {
        inside.push(p.clone());
        return;
    }
    if !neg {
        outside.push(p.clone());
        return;
    }
    let n = p.v.len();
    let (mut a, mut b) = (Vec::new(), Vec::new());
    for i in 0..n {
        let j = (i + 1) % n;
        let (fi, fj) = (vals[i], vals[j]);
        if fi < 0.0 {
            a.push(p.v[i]);
        } else {
            b.push(p.v[i]);
        }
        if (fi < 0.0) != (fj < 0.0) {
            let v = p.v[i].lerp(&p.v[j], fi / (fi - fj));
            a.push(v);
            b.push(v);
        }
    }
    if a.len() >= 3 {
        inside.push(Poly { v: a, plane: p.plane, tag: p.tag });
    }
    if b.len() >= 3 {
        outside.push(Poly { v: b, plane: p.plane, tag: p.tag });
    }
}
