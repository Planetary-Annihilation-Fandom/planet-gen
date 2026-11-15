//! Кисти CSG из `planetCSG`: установка меша кисти на сферу и упрощённое применение к поверхности.
//!
//! Игра объединяет кисти с поверхностью настоящим CSG (`Csg::addBrushBegin`, `getResultBrushes`).
//! Здесь кисть сложения отдаётся просмотрщику отдельным мешем, а поверхность под ней
//! поднимается до верхней грани кисти; кисть вычитания опускает поверхность до нижней грани.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

use crate::config::read_json;
use crate::math::{cross, dot, length, normalize, scale, sub, V3};
use crate::papa::Papa;
use crate::surface::Surface;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Op {
    Add,
    Subtract,
}

/// Кисть, установленная на планету.
#[derive(Clone, Debug, Serialize)]
pub struct BrushMesh {
    pub spec: String,
    pub op: Op,
    /// Путь `DiffuseTexture` материала кисти.
    pub diffuse: Option<String>,
    pub positions: Vec<[f32; 3]>,
    pub uvs: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct CsgResult {
    pub brushes: Vec<BrushMesh>,
    /// Кисти, которые не удалось прочитать: спецификация и причина.
    pub skipped: Vec<(String, String)>,
}

/// Матрица 3×4 по строкам: `world = R · local + t`.
fn apply(m: &[f32; 12], v: V3) -> V3 {
    [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3],
        m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7],
        m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11],
    ]
}

fn det3(m: &[f32; 12]) -> f32 {
    m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8])
}

/// Проекции `Csg::updateGeometry`. `origin` — точка установки кисти, `w` — вершина в мировых
/// координатах, `sample` — радиус поверхности по направлению.
fn project(proj: &str, origin: V3, w: V3, sample: &dyn Fn(V3) -> f32, h0: f32) -> V3 {
    let up = normalize(origin);
    let along = dot(w, up);
    let dir = normalize(w);
    match proj {
        "BP_None" => w,
        // Вершина остаётся на своём луче, высота берётся по оси кисти.
        "BP_Arch" => scale(dir, along),
        // Высота над осью кисти плюс разница рельефа под вершиной и под центром.
        "BP_Terrain" | "BP_Terrain_BelowZero" => scale(dir, along + sample(dir) - h0),
        // BP_Bend; долготные проекции пока сводятся к нему.
        _ => {
            let t = sub(w, scale(up, along));
            let tl = length(t);
            let r0 = length(origin);
            let bent = if tl < 1e-6 || (dot(up, dir).clamp(-1.0, 1.0)).acos() <= 1e-4 {
                scale(dir, along)
            } else {
                // Точка на оси кисти поворачивается к вершине на угол дуги |t| / r0.
                let a = tl / r0;
                let n = [
                    up[0] * a.cos() + t[0] / tl * a.sin(),
                    up[1] * a.cos() + t[1] / tl * a.sin(),
                    up[2] * a.cos() + t[2] / tl * a.sin(),
                ];
                scale(n, along)
            };
            // Рельеф измеряется под исходным направлением вершины, сдвиг — вдоль нового.
            let shift = sample(dir) - h0;
            let nd = normalize(bent);
            [bent[0] + nd[0] * shift, bent[1] + nd[1] * shift, bent[2] + nd[2] * shift]
        }
    }
}

/// Читает `planetCSG` и строит меши кистей.
pub fn build(media: &Path, csg: &[Value], sample: &dyn Fn(V3) -> f32) -> CsgResult {
    let mut cache: HashMap<String, Result<(Papa, Option<String>), String>> = HashMap::new();
    let mut out = CsgResult::default();
    for c in csg {
        let Some(spec) = c.get("spec").and_then(Value::as_str) else { continue };
        let op = match c.get("op").and_then(Value::as_str) {
            Some("BO_Subtract") => Op::Subtract,
            Some("BO_Add") => Op::Add,
            _ => continue,
        };
        let Some(m) = c.get("transform").and_then(Value::as_array).filter(|a| a.len() == 12) else { continue };
        let mut tr = [0f32; 12];
        for (i, v) in m.iter().enumerate() {
            tr[i] = v.as_f64().unwrap_or(0.0) as f32;
        }
        let proj = c.get("proj").and_then(Value::as_str).unwrap_or("BP_Bend");
        let origin = [tr[3], tr[7], tr[11]];
        let h0 = sample(normalize(origin));

        let entry = cache.entry(spec.to_string()).or_insert_with(|| {
            let papa_path = read_json(media, spec)
                .and_then(|v| v.get("papa").and_then(Value::as_str).map(str::to_string))
                .ok_or_else(|| "нет поля papa".to_string())?;
            let papa = Papa::read(&media.join(papa_path.trim_start_matches('/')))?;
            let diffuse = papa
                .meshes
                .first()
                .and_then(|m| m.groups.first())
                .and_then(|g| papa.material_texture(g.material, "DiffuseTexture"))
                .map(str::to_string);
            Ok((papa, diffuse))
        });
        let (papa, diffuse) = match entry {
            Ok(x) => x,
            Err(e) => {
                out.skipped.push((spec.to_string(), e.clone()));
                continue;
            }
        };
        let flip = det3(&tr) < 0.0;
        let mut b = BrushMesh {
            spec: spec.to_string(),
            op,
            diffuse: diffuse.clone(),
            positions: Vec::new(),
            uvs: Vec::new(),
            indices: Vec::new(),
        };
        for mesh in &papa.meshes {
            let base = b.positions.len() as u32;
            for (p, uv) in mesh.positions.iter().zip(&mesh.uvs) {
                let w = apply(&tr, *p);
                b.positions.push(project(proj, origin, w, sample, h0));
                b.uvs.push(*uv);
            }
            for t in mesh.indices.chunks_exact(3) {
                let (i0, i1, i2) = (t[0] + base, t[1] + base, t[2] + base);
                b.indices.extend(if flip { [i0, i2, i1] } else { [i0, i1, i2] });
            }
        }
        out.brushes.push(b);
    }
    out
}

/// Пересечения луча из центра планеты по направлению `dir` с треугольниками кисти.
fn ray_hits(dir: V3, b: &BrushMesh, out: &mut Vec<f32>) {
    out.clear();
    for t in b.indices.chunks_exact(3) {
        let (p0, p1, p2) = (b.positions[t[0] as usize], b.positions[t[1] as usize], b.positions[t[2] as usize]);
        let e1 = sub(p1, p0);
        let e2 = sub(p2, p0);
        let pv = cross(dir, e2);
        let det = dot(e1, pv);
        if det.abs() < 1e-9 {
            continue;
        }
        let inv = 1.0 / det;
        let tv = scale(p0, -1.0);
        let u = dot(tv, pv) * inv;
        if !(0.0..=1.0).contains(&u) {
            continue;
        }
        let qv = cross(tv, e1);
        let v = dot(dir, qv) * inv;
        if v < 0.0 || u + v > 1.0 {
            continue;
        }
        let d = dot(e2, qv) * inv;
        if d > 0.0 {
            out.push(d);
        }
    }
    out.sort_by(|a, b| a.partial_cmp(b).unwrap());
    out.dedup_by(|a, b| (*a - *b).abs() < 1e-3);
}

/// Применяет кисти к высотам поверхности. Возвращает число изменённых вершин.
pub fn apply_to_surface(s: &mut Surface, csg: &CsgResult) -> usize {
    let mut changed = 0;
    let mut hits = Vec::new();
    for b in &csg.brushes {
        if b.positions.is_empty() {
            continue;
        }
        // Конус направлений, внутри которого лежит кисть.
        let mut c = [0f32; 3];
        for p in &b.positions {
            let n = normalize(*p);
            c = [c[0] + n[0], c[1] + n[1], c[2] + n[2]];
        }
        let axis = normalize(c);
        let cos_max = b.positions.iter().map(|p| dot(normalize(*p), axis)).fold(1.0f32, f32::min);
        for sf in &mut s.surfels {
            if dot(sf.normal, axis) < cos_max {
                continue;
            }
            ray_hits(sf.normal, b, &mut hits);
            if hits.len() < 2 {
                continue;
            }
            let r = length(sf.pos);
            for pair in hits.chunks_exact(2) {
                let (lo, hi) = (pair[0], pair[1]);
                let target = match b.op {
                    Op::Subtract if lo <= r && r <= hi => Some(lo),
                    // Чуть ниже верхней грани, чтобы меш кисти оставался поверх поверхности.
                    Op::Add if lo <= r && r < hi => Some(hi - 0.5),
                    _ => None,
                };
                if let Some(t) = target {
                    sf.pos = scale(sf.normal, t);
                    changed += 1;
                    break;
                }
            }
        }
    }
    changed
}
