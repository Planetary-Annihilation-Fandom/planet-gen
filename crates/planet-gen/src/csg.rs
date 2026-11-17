//! Кисти CSG: установка меша кисти на сферу и булевы операции с поверхностью.
//!
//! Кисти применяются по порядку: сложение добавляет объём кисти к телу планеты, вычитание
//! вырезает его. Каждый треугольник поверхности и кистей делится BSP-деревьями других тел
//! на куски, целиком лежащие внутри или снаружи каждого тела. Кусок остаётся на границе
//! итогового тела, если точки по разные стороны от него различаются принадлежностью телу.

use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

use crate::bsp::{cross3, dot3, len3, split_field, sub3, Bsp, Poly, Vtx, D3, NA};
use crate::config::read_json;
use crate::math::{dot, length, normalize, scale, sub, V3};
use crate::papa::Papa;
use crate::vfs::Media;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Op {
    Add,
    Subtract,
}

/// Диапазон индексов кисти с одним материалом.
#[derive(Clone, Debug, Serialize)]
pub struct Group {
    /// Путь `DiffuseTexture` материала группы.
    pub diffuse: Option<String>,
    pub start: u32,
    pub count: u32,
}

/// Кисть после булевых операций: только части, оставшиеся на поверхности тела.
#[derive(Clone, Debug, Serialize)]
pub struct BrushMesh {
    pub spec: String,
    pub op: Op,
    pub positions: Vec<[f32; 3]>,
    pub uvs: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
    pub groups: Vec<Group>,
    /// Кисть добавлена процедурной генерацией биома, а не взята из `planetCSG`.
    pub procedural: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct CsgResult {
    pub brushes: Vec<BrushMesh>,
    /// Кисти, которые не удалось прочитать: спецификация и причина.
    pub skipped: Vec<(String, String)>,
}

/// Кисть, которую нужно установить: спецификация, операция, матрица 3×4 по строкам и проекция.
#[derive(Clone, Debug)]
pub struct Placement {
    pub spec: String,
    pub op: Op,
    pub transform: [f32; 12],
    pub proj: String,
    pub procedural: bool,
}

/// Переводит сохранённый `planetCSG` в последовательность операций над объёмами.
/// Матрица уже содержит высоту, масштаб и поворот; поля редактора повторно не применяются.
/// Порядок записей сохраняется: добавление после вычитания может вернуть удалённый объём.
pub fn placements_from_json(csg: &[Value]) -> Vec<Placement> {
    let mut placements: Vec<Placement> = csg.iter()
        .filter_map(|c| {
            let spec = c.get("spec")?.as_str()?.to_string();
            let op = match c.get("op")?.as_str()? {
                "BO_Subtract" => Op::Subtract,
                "BO_Add" => Op::Add,
                _ => return None,
            };
            let m = c.get("transform")?.as_array().filter(|a| a.len() == 12 || a.len() == 16)?;
            let mut transform = [0f32; 12];
            for (i, v) in m.iter().take(12).enumerate() {
                transform[i] = v.as_f64().unwrap_or(0.0) as f32;
            }
            // У 4×4 последняя строка не участвует в affine transform.
            let proj = c.get("proj").and_then(Value::as_str).unwrap_or("BP_Terrain").to_string();
            Some(Placement { spec, op, transform, proj, procedural: false })
        })
        .collect();
    // Последняя операция над тем же объёмом полностью заменяет предыдущие.
    // Иначе совпадающие грани проходят BSP дважды и мерцают в просмотрщике.
    let mut seen = HashSet::new();
    placements.reverse();
    placements.retain(|p| seen.insert((p.spec.clone(), p.proj.clone(), p.transform.map(f32::to_bits))));
    placements.reverse();
    placements
}

/// Матрица 3×4 по строкам: `world = R · local + t`.
fn apply(m: &[f32; 12], v: V3) -> V3 {
    [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3],
        m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7],
        m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11],
    ]
}

/// Отрицательный определитель означает отражение. Оно меняет обход граней,
/// поэтому при сборке замкнутого объёма нужно развернуть треугольники.
fn det3(m: &[f32; 12]) -> f32 {
    m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8])
}

/// Деформирует установленную вершину по правилам `Csg::updateGeometry`.
/// `w` уже прошла meshToModel и матрицу экземпляра, а `local_z` взят между этими этапами.
/// `sample` читает радиус исходного терраина; `h0` — тот же радиус под центром `origin`.
/// Их разность переносит местный перепад рельефа на кисть, сохраняя высоту её центра.
fn project(proj: &str, origin: V3, local_z: f32, w: V3, sample: &dyn Fn(V3) -> f32, h0: f32) -> V3 {
    let up = normalize(origin);
    let along = dot(w, up);
    let dir = normalize(w);
    match proj {
        "BP_None" => w,
        // Условие проверяется до transform, по исходной геометрии кисти.
        "BP_Terrain_BelowZero" if local_z > 0.0 => w,
        // Вершина остаётся на своём луче, высота берётся по оси кисти.
        "BP_Arch" => scale(dir, along),
        // Высота над осью кисти плюс разница рельефа под вершиной и под центром.
        "BP_Terrain" | "BP_Terrain_BelowZero" => scale(dir, along + sample(dir) - h0),
        "BP_Longitude" | "BP_LongitudePinch" => {
            // На оси кисти долготное направление не определено. Движок использует
            // Terrain в пределах 0.0001 радиана, чтобы не делить малые смещения.
            if dot(up, dir).clamp(-1.0, 1.0).acos() <= 1e-4 {
                return scale(dir, along + sample(dir) - h0);
            }
            let radius = length(origin);
            let latitude = up[2].clamp(-1.0, 1.0).asin();
            let longitude = up[1].atan2(up[0]);
            let (sin_lon, cos_lon) = longitude.sin_cos();
            let (sin_lat, cos_lat) = latitude.sin_cos();
            // На точном полюсе fromAxisAngle получает нулевую ось: матрица единичная.
            let north = if up[0] == 0.0 && up[1] == 0.0 {
                [0.0, 0.0, 1.0]
            } else {
                [-sin_lat * cos_lon, -sin_lat * sin_lon, cos_lat]
            };
            let east = crate::math::cross(north, up);
            let tangent = sub(w, scale(up, along));
            // Смещения в касательной плоскости превращаются в углы сферы.
            // У Longitude параллели сужаются к полюсам; Pinch сохраняет делитель radius.
            let lat = latitude + dot(tangent, north) / radius;
            let parallel = if proj == "BP_Longitude" { radius * lat.cos() } else { radius };
            let lon = longitude + dot(tangent, east) / parallel;
            let (sin_lat, cos_lat) = lat.sin_cos();
            let (sin_lon, cos_lon) = lon.sin_cos();
            let d = [cos_lat * cos_lon, cos_lat * sin_lon, sin_lat];
            let mut p = scale(d, along.abs());
            // В Longitude движок добавляет поправку рельефа только к мировым X/Y.
            let shift = sample(d) - h0;
            p[0] += d[0] * shift;
            p[1] += d[1] * shift;
            p
        }
        "BP_Bend" => {
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
                scale(n, along.abs())
            };
            // В Bend рельеф выбирается под исходным лучом, а поправка идёт вдоль нового.
            // Выбор sample(normalize(bent)) здесь изменил бы посадку на неровной поверхности.
            let shift = sample(dir) - h0;
            let nd = normalize(bent);
            [bent[0] + nd[0] * shift, bent[1] + nd[1] * shift, bent[2] + nd[2] * shift]
        }
        // parseBrushProjection: неизвестные значения означают Terrain.
        _ => scale(dir, along + sample(dir) - h0),
    }
}

/// Кисть, установленная на планету, до булевых операций.
pub struct Installed {
    pub spec: String,
    pub op: Op,
    pub procedural: bool,
    /// Треугольники в мировых координатах, обращённые наружу; `tag` — номер материала.
    pub polys: Vec<Poly>,
    pub materials: Vec<Option<String>>,
    pub lo: D3,
    pub hi: D3,
}

struct Source {
    papa: Papa,
    /// Диффузная текстура каждого материала файла.
    materials: Vec<Option<String>>,
}

/// Загружает геометрию кистей и готовит замкнутые объёмы для булевых операций.
/// Порядок преобразований совпадает с игрой: вершина → meshToModel → transform → проекция.
/// Установка ещё не удаляет скрытые грани: пересечения обрабатывает `boolean`.
pub fn install(media: &Media, list: &[Placement], sample: &dyn Fn(V3) -> f32) -> (Vec<Installed>, Vec<(String, String)>) {
    let mut cache: HashMap<String, Result<Source, String>> = HashMap::new();
    let mut out = Vec::new();
    let mut skipped = Vec::new();
    for pl in list {
        // Один файл может использоваться десятками экземпляров. Кэшируем исходные
        // ресурсы и ошибки чтения; положение каждой кисти рассчитывается отдельно.
        let entry = cache.entry(pl.spec.clone()).or_insert_with(|| {
            let papa_path = read_json(media, &pl.spec)
                .and_then(|v| v.get("papa").and_then(Value::as_str).map(str::to_string))
                .ok_or_else(|| "нет поля papa".to_string())?;
            let papa = Papa::parse(&media.read(&papa_path)?)?;
            if papa.mesh_bindings.is_empty() {
                return Err("в papa нет мешей, привязанных к моделям".into());
            }
            let materials = (0..papa.materials.len())
                .map(|m| papa.material_texture(m, "DiffuseTexture").map(str::to_string))
                .collect();
            Ok(Source { papa, materials })
        });
        let src = match entry {
            Ok(x) => x,
            Err(e) => {
                skipped.push((pl.spec.clone(), e.clone()));
                continue;
            }
        };
        let tr = &pl.transform;
        let origin = [tr[3], tr[7], tr[11]];
        let h0 = sample(normalize(origin));
        let mut polys = Vec::new();
        // Привязки определяют состав модели: один меш может встречаться несколько раз,
        // а меш без привязки вообще не должен появляться на планете.
        for binding in &src.papa.mesh_bindings {
            let mesh = &src.papa.meshes[binding.mesh];
            let flip = det3(tr) * det3(&binding.transform) < 0.0;
            let verts: Vec<Vtx> = mesh
                .positions
                .iter()
                .zip(&mesh.uvs)
                .map(|(p, uv)| {
                    // Локальный Z в BelowZero тоже берётся после meshToModel.
                    let local = apply(&binding.transform, *p);
                    let w = project(&pl.proj, origin, local[2], apply(tr, local), sample, h0);
                    let mut a = [0f32; NA];
                    a[0] = uv[0];
                    a[1] = uv[1];
                    Vtx { p: w.map(f64::from), a }
                })
                .collect();
            // Номер материала каждого треугольника по группам меша.
            let mut tags = vec![0u32; mesh.indices.len() / 3];
            for g in &mesh.groups {
                let (s, e) = (g.first_index as usize / 3, (g.first_index + g.count) as usize / 3);
                for t in tags.iter_mut().take(e).skip(s) {
                    *t = g.material as u32;
                }
            }
            for (k, t) in mesh.indices.chunks_exact(3).enumerate() {
                let [a, b, c] = [t[0], t[1], t[2]].map(|i| verts[i as usize]);
                let v = if flip { vec![a, c, b] } else { vec![a, b, c] };
                if let Some(p) = Poly::new(v, tags[k]) {
                    polys.push(p);
                }
            }
        }
        // Меш, вывернутый наизнанку, разворачивается: BSP считает внутренней сторону за гранями.
        let mut vol = 0.0;
        for p in &polys {
            vol += dot3(p.v[0].p, crate::bsp::cross3(p.v[1].p, p.v[2].p));
        }
        if vol < 0.0 {
            polys.iter_mut().for_each(Poly::flip);
        }
        let (mut lo, mut hi) = ([f64::MAX; 3], [f64::MIN; 3]);
        for p in &polys {
            for v in &p.v {
                for k in 0..3 {
                    lo[k] = lo[k].min(v.p[k]);
                    hi[k] = hi[k].max(v.p[k]);
                }
            }
        }
        out.push(Installed {
            spec: pl.spec.clone(),
            op: pl.op,
            procedural: pl.procedural,
            polys,
            materials: src.materials.clone(),
            lo,
            hi,
        });
    }
    (out, skipped)
}

/// Поверхность планеты для булевых операций и после них.
pub struct SurfaceMesh {
    pub verts: Vec<Vtx>,
    pub tris: Vec<[u32; 3]>,
}

/// Проверяет, заполнена ли точка после всех операций. Сначала учитывается планета,
/// затем кисти в порядке массива: попавшая в точку Add заполняет её, Subtract опустошает.
/// `inside` содержит номера охватывающих кистей. `own` задаёт сторону рассматриваемой
/// грани, чтобы сравнить заполненность по обе стороны без смещения координат точки.
fn member(ops: &[Op], in_planet: bool, inside: &[u32], own: Option<(u32, bool)>) -> bool {
    let mut list: Vec<(u32, bool)> = inside.iter().map(|&j| (j, true)).collect();
    if let Some(o) = own {
        list.push(o);
    }
    list.sort_by_key(|x| x.0);
    let mut s = in_planet;
    for (j, v) in list {
        if v {
            s = ops[j as usize] == Op::Add;
        }
    }
    s
}

/// Быстро исключает кисть, если её коробка не касается фрагмента.
/// Малый запас оставляет пограничные случаи точной классификации BSP.
fn overlaps(lo: D3, hi: D3, b: &Installed) -> bool {
    (0..3).all(|k| lo[k] <= b.hi[k] + 1e-3 && hi[k] >= b.lo[k] - 1e-3)
}

/// Коробка исходного фрагмента ограничивает круг проверяемых кистей.
/// Все полученные при разрезании части остаются внутри этой коробки.
fn bounds(p: &Poly) -> (D3, D3) {
    let (mut lo, mut hi) = ([f64::MAX; 3], [f64::MIN; 3]);
    for v in &p.v {
        for k in 0..3 {
            lo[k] = lo[k].min(v.p[k]);
            hi[k] = hi[k].max(v.p[k]);
        }
    }
    (lo, hi)
}

/// Разделяет грань кисти на части под терраином и над ним по знаку `field`.
/// Крупные треугольники около поверхности сначала дробятся: линейное приближение
/// радиальной высоты на маленьких частях точнее передаёт стык с рельефом.
/// Это наше приближение пересечения, а не копия нативного BSP игры.
fn split_by_surface(p: Poly, field: &dyn Fn(D3) -> f64, cell: f64, inside: &mut Vec<Poly>, outside: &mut Vec<Poly>) {
    let mut stack: Vec<(Poly, u32)> = Vec::new();
    for i in 1..p.v.len() - 1 {
        stack.push((Poly { v: vec![p.v[0], p.v[i], p.v[i + 1]], plane: p.plane, tag: p.tag }, 0));
    }
    while let Some((t, depth)) = stack.pop() {
        let vals: Vec<f64> = t.v.iter().map(|v| field(v.p)).collect();
        let edge = (0..3).map(|i| len3(crate::bsp::sub3(t.v[i].p, t.v[(i + 1) % 3].p))).fold(0.0, f64::max);
        let (fmin, fmax) = vals.iter().fold((f64::MAX, f64::MIN), |(a, b), &v| (a.min(v), b.max(v)));
        // Дробление нужно только вблизи поверхности. Ограничение глубины сдерживает
        // число частей у больших кистей; вдали от терраина остаётся целый треугольник.
        if edge > cell && depth < 8 && fmin < edge && fmax > -edge {
            let m = |i: usize, j: usize| t.v[i].lerp(&t.v[j], 0.5);
            let (m01, m12, m20) = (m(0, 1), m(1, 2), m(2, 0));
            for v in [[t.v[0], m01, m20], [m01, t.v[1], m12], [m20, m12, t.v[2]], [m01, m12, m20]] {
                stack.push((Poly { v: v.to_vec(), plane: t.plane, tag: t.tag }, depth + 1));
            }
            continue;
        }
        split_field(&t, &vals, inside, outside);
    }
}

/// Параллельно применяет `f` к элементам `items`, сохраняя порядок. Потоки берут элементы
/// порциями по `grain` из общего счётчика, поэтому тяжёлые кисти не задерживают остальных.
fn par_map<T: Sync, R: Send>(items: &[T], grain: usize, f: impl Fn(usize, &T) -> R + Sync) -> Vec<R> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).max(1);
    let next = AtomicUsize::new(0);
    let grain = grain.max(1);
    let mut parts: Vec<(usize, Vec<R>)> = std::thread::scope(|sc| {
        let handles: Vec<_> = (0..threads)
            .map(|_| {
                let (f, next) = (&f, &next);
                // Большой стек: классификация BSP рекурсивна по глубине дерева.
                std::thread::Builder::new()
                    .stack_size(64 << 20)
                    .spawn_scoped(sc, move || {
                        let mut done = Vec::new();
                        loop {
                            let s = next.fetch_add(grain, Ordering::Relaxed);
                            if s >= items.len() {
                                break done;
                            }
                            let e = (s + grain).min(items.len());
                            done.push((s, (s..e).map(|i| f(i, &items[i])).collect::<Vec<R>>()));
                        }
                    })
                    .expect("поток CSG")
            })
            .collect();
        handles.into_iter().flat_map(|h| h.join().expect("поток CSG")).collect()
    });
    parts.sort_by_key(|p| p.0);
    parts.into_iter().flat_map(|p| p.1).collect()
}

/// Уточняет фрагменты после пересечения с кистью `j`, сохраняя прежние признаки `extra`.
/// Каждый новый кусок получает список охватывающих его кистей; этот список затем
/// позволяет вычислить итоговый объём с учётом порядка Add и Subtract.
fn classify_all<T: Copy>(bsp: &Bsp, j: u32, frags: Vec<(Poly, T, Vec<u32>)>) -> Vec<(Poly, T, Vec<u32>)> {
    let mut next = Vec::with_capacity(frags.len());
    let mut parts = Vec::new();
    for (p, extra, inside) in frags {
        parts.clear();
        bsp.classify(p, &mut parts);
        for (q, ins) in parts.drain(..) {
            let mut l = inside.clone();
            if ins {
                l.push(j);
            }
            next.push((q, extra, l));
        }
    }
    next
}

/// Отбирает пары кистей для разрезания. Пересечение коробок лишь разрешает
/// дальнейшую проверку BSP и само по себе не доказывает пересечение геометрии.
fn boxes_overlap(a: &Installed, b: &Installed) -> bool {
    (0..3).all(|k| a.lo[k] <= b.hi[k] && a.hi[k] >= b.lo[k])
}

/// Собирает границу итогового тела отдельно из граней терраина и граней кистей.
/// После разрезания фрагмент видим только там, где одна его сторона заполнена,
/// а другая пуста. Так удаляются скрытые части и сохраняются стенки вычитания.
/// `field(p)` — радиальная высота над исходным терраином, `cell` — размер его ячейки.
pub fn boolean(
    surface: &SurfaceMesh,
    brushes: &[Installed],
    field: &(dyn Fn(D3) -> f64 + Sync),
    cell: f64,
) -> (SurfaceMesh, Vec<BrushMesh>) {
    let ops: Vec<Op> = brushes.iter().map(|b| b.op).collect();
    let t0 = std::time::Instant::now();
    let bsps: Vec<Bsp> = par_map(brushes, 1, |_, b| Bsp::build(b.polys.clone()));
    eprintln!("TIME bsp {:?}", t0.elapsed());

    // Поверхность: треугольники вне всех кистей остаются как есть, остальные делятся.
    enum Piece {
        Keep([u32; 3]),
        Split(Vec<Poly>),
    }
    let pieces: Vec<Piece> = par_map(&surface.tris, 512, |_, t| {
        let [a, b, c] = t.map(|i| surface.verts[i as usize]);
        // Треугольник обращается наружу от центра планеты.
        let n = cross3(sub3(b.p, a.p), sub3(c.p, a.p));
        let tri = if dot3(n, a.p) >= 0.0 { *t } else { [t[0], t[2], t[1]] };
        let Some(poly) = Poly::new(tri.map(|i| surface.verts[i as usize]).to_vec(), 0) else {
            return Piece::Split(Vec::new());
        };
        let (lo, hi) = bounds(&poly);
        let mut frags = vec![(poly, (), Vec::new())];
        let mut touched = false;
        for (j, br) in brushes.iter().enumerate() {
            if overlaps(lo, hi, br) {
                touched = true;
                frags = classify_all(&bsps[j], j as u32, frags);
            }
        }
        if !touched {
            return Piece::Keep(tri);
        }
        let mut kept = Vec::new();
        for (mut p, (), inside) in frags {
            // Одинаковая заполненность с двух сторон означает внутреннюю или внешнюю
            // грань без границы тела. Рисовать её не нужно.
            let f_in = member(&ops, true, &inside, None);
            if f_in == member(&ops, false, &inside, None) {
                continue;
            }
            if !f_in {
                p.flip();
            }
            kept.push(p);
        }
        // Кусок не задет кистями: возвращаем исходный треугольник с общими вершинами.
        if kept.len() == 1 && kept[0].v.len() == 3 && kept[0].v.iter().zip(&tri).all(|(v, &i)| v.p == surface.verts[i as usize].p) {
            return Piece::Keep(tri);
        }
        Piece::Split(kept)
    });
    let mut verts = surface.verts.clone();
    let mut tris = Vec::with_capacity(surface.tris.len());
    for piece in pieces {
        match piece {
            Piece::Keep(t) => tris.push(t),
            Piece::Split(list) => {
                for p in list {
                    let base = verts.len() as u32;
                    verts.extend(p.v.iter().copied());
                    for i in 1..p.v.len() as u32 - 1 {
                        tris.push([base, base + i, base + i + 1]);
                    }
                }
            }
        }
    }

    eprintln!("TIME planet {:?}", t0.elapsed());
    // Грани кистей проходят ту же проверку, но их положение относительно планеты
    // сначала определяет field. У выреза сохранённая нормаль должна смотреть внутрь полости.
    let out = par_map(brushes, 1, |bi, b| {
        let near: Vec<usize> = (0..brushes.len()).filter(|&j| j != bi && boxes_overlap(b, &brushes[j])).collect();
        let mut kept: Vec<Poly> = Vec::new();
        for p in &b.polys {
            let (lo, hi) = bounds(p);
            let (mut ins, mut outs) = (Vec::new(), Vec::new());
            split_by_surface(p.clone(), field, cell, &mut ins, &mut outs);
            let mut frags: Vec<(Poly, bool, Vec<u32>)> =
                ins.into_iter().map(|q| (q, true, Vec::new())).chain(outs.into_iter().map(|q| (q, false, Vec::new()))).collect();
            for &j in &near {
                if overlaps(lo, hi, &brushes[j]) {
                    frags = classify_all(&bsps[j], j as u32, frags);
                }
            }
            for (mut q, in_planet, inside) in frags {
                let f_in = member(&ops, in_planet, &inside, Some((bi as u32, true)));
                if f_in == member(&ops, in_planet, &inside, Some((bi as u32, false))) {
                    continue;
                }
                if !f_in {
                    q.flip();
                }
                kept.push(q);
            }
        }
        to_mesh(b, kept)
    });
    (SurfaceMesh { verts, tris }, out)
}

/// Превращает оставшиеся многоугольники в треугольники для просмотра и экспорта.
/// Группировка по исходному материалу сохраняет связь новых частей с текстурами;
/// UV в точках разреза уже интерполированы при создании этих частей.
fn to_mesh(b: &Installed, mut kept: Vec<Poly>) -> BrushMesh {
    kept.sort_by_key(|p| p.tag);
    let mut m = BrushMesh {
        spec: b.spec.clone(),
        op: b.op,
        positions: Vec::new(),
        uvs: Vec::new(),
        indices: Vec::new(),
        groups: Vec::new(),
        procedural: b.procedural,
    };
    for p in kept {
        let diffuse = b.materials.get(p.tag as usize).cloned().flatten();
        if m.groups.last().map_or(true, |g| g.diffuse != diffuse) {
            m.groups.push(Group { diffuse, start: m.indices.len() as u32, count: 0 });
        }
        let base = m.positions.len() as u32;
        for v in &p.v {
            m.positions.push(v.p.map(|x| x as f32));
            m.uvs.push([v.a[0], v.a[1]]);
        }
        for i in 1..p.v.len() as u32 - 1 {
            m.indices.extend([base, base + i, base + i + 1]);
        }
        m.groups.last_mut().unwrap().count = m.indices.len() as u32 - m.groups.last().unwrap().start;
    }
    m
}

/// Длина вектора в `f64`.
pub fn norm(p: D3) -> f64 {
    len3(p)
}
