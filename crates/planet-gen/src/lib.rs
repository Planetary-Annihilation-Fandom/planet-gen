//! Воссоздание генератора планет Planetary Annihilation: поверхность, вода и металл.

pub mod biomes;
pub mod bsp;
pub mod config;
pub mod csg;
pub mod math;
pub mod metal;
pub mod noise;
pub mod papa;
pub mod raycast;
pub mod rng;
pub mod surface;
mod tables;
pub mod vfs;

use serde::Serialize;
use serde_json::Value;

pub use config::{Archetype, PlanetBp, SymmetryType};
pub use metal::{MetalOptions, MetalResult, MetalSpot};
pub use surface::Surface;
pub use vfs::Media;

/// Готовая планета: сетка, уровни жидкостей и металлические точки.
#[derive(Serialize)]
pub struct Planet {
    pub radius: f32,
    pub biome: String,
    pub plates: usize,
    pub positions: Vec<[f32; 3]>,
    /// Нормированная высота до опускания дна (`color` сурфеля), 0..1.
    pub colors: Vec<f32>,
    /// Нормированная высота после опускания дна.
    pub heights: Vec<f32>,
    pub triangles: Vec<[u32; 3]>,
    pub min_radius: f32,
    pub max_radius: f32,
    pub water_radius: Option<f32>,
    pub lava_radius: Option<f32>,
    pub metal: MetalResult,
    /// Подбиомы архетипа.
    pub biomes: Vec<biomes::BiomeDef>,
    /// Подбиом каждой вершины.
    pub biome_index: Vec<u8>,
    /// Доли подбиомов у вершины, `biomes.len()` байт на вершину.
    pub biome_weights: Vec<u8>,
    pub csg: csg::CsgResult,
}

/// Строит планету по готовому `PlanetBp`; `csg` — массив `planetCSG` системы.
pub fn generate(bp: &PlanetBp, media: &Media, csg_list: &[Value], opts: MetalOptions) -> Planet {
    let mut s = Surface::generate(bp.radius, bp.plate_size);
    if !bp.archetype.ignore_height_range {
        s.gen_height(bp);
    }
    if bp.symmetry_type != SymmetryType::None {
        s.mirror(bp);
    }
    let triangles = s.triangles();
    let defs = biomes::load(media, &bp.archetype.name);
    let graph = biomes::Graph::new(&s, &triangles);
    let bmap = biomes::assign(bp, &s, &graph, &defs);

    // В игре CSG применяется после биомов и до расстановки металла.
    let pre = raycast::Raycaster::new(&s);
    let far = bp.radius * 2.0;
    let sample = |d: math::V3| pre.segment(math::scale(d, far), [0.0; 3]).map_or(bp.radius, |h| math::length(h.pos));
    let t0 = std::time::Instant::now();
    let placements = csg::placements_from_json(csg_list);
    let (installed, skipped) = csg::install(media, &placements, &sample);
    eprintln!("TIME install {:?}", t0.elapsed());

    let k = defs.len().max(1);
    let verts: Vec<bsp::Vtx> = s
        .surfels
        .iter()
        .enumerate()
        .map(|(i, sf)| {
            let mut a = [0f32; bsp::NA];
            for b in 0..k.min(8) {
                a[b] = bmap.weights.get(i * k + b).copied().unwrap_or(0) as f32 / 255.0;
            }
            a[8] = sf.color;
            a[9] = sf.height;
            bsp::Vtx { p: sf.pos.map(f64::from), a }
        })
        .collect();
    let field = |p: bsp::D3| {
        let r = csg::norm(p);
        let d = [(p[0] / r) as f32, (p[1] / r) as f32, (p[2] / r) as f32];
        r - sample(d) as f64
    };
    let cell = (bp.radius as f64 * std::f64::consts::FRAC_PI_2) / (s.n as f64 - 1.0);
    let surf_in = csg::SurfaceMesh { verts, tris: triangles };
    let (surf, brushes) = if installed.is_empty() {
        (surf_in, Vec::new())
    } else {
        csg::boolean(&surf_in, &installed, &field, cell)
    };
    let csg = csg::CsgResult { brushes, skipped };
    eprintln!("TIME csg {:?}", t0.elapsed());

    // Металл ищется на итоговой геометрии: поверхности и гранях кистей.
    let mut all_v: Vec<math::V3> = surf.verts.iter().map(|v| v.p.map(|x| x as f32)).collect();
    let mut all_t = surf.tris.clone();
    for b in &csg.brushes {
        let base = all_v.len() as u32;
        all_v.extend(&b.positions);
        all_t.extend(b.indices.chunks_exact(3).map(|t| [t[0] + base, t[1] + base, t[2] + base]));
    }
    let (mut lo, mut hi) = (f32::MAX, f32::MIN);
    for p in &all_v {
        let r = math::length(*p);
        lo = lo.min(r);
        hi = hi.max(r);
    }
    let rc = raycast::Raycaster::from_mesh(all_v, all_t, s.n);
    eprintln!("TIME rc {:?}", t0.elapsed());
    let metal = metal::generate(bp, &rc, hi, lo, opts);
    eprintln!("TIME metal {:?}", t0.elapsed());
    let level = bp.water_height * bp.height_range + bp.radius;

    let positions: Vec<[f32; 3]> = surf.verts.iter().map(|v| v.p.map(|x| x as f32)).collect();
    let mut biome_weights = Vec::with_capacity(surf.verts.len() * k);
    let mut biome_index = Vec::with_capacity(surf.verts.len());
    for v in &surf.verts {
        let mut best = (0usize, -1.0f32);
        for b in 0..k {
            let w = if b < 8 { v.a[b] } else { 0.0 };
            biome_weights.push((w * 255.0).round().clamp(0.0, 255.0) as u8);
            if w > best.1 {
                best = (b, w);
            }
        }
        biome_index.push(best.0 as u8);
    }

    Planet {
        radius: bp.radius,
        biome: bp.archetype.name.clone(),
        plates: s.n,
        colors: surf.verts.iter().map(|v| v.a[8]).collect(),
        heights: surf.verts.iter().map(|v| v.a[9]).collect(),
        positions,
        triangles: surf.tris,
        min_radius: lo,
        max_radius: hi,
        water_radius: bp.archetype.enable_water.then_some(level),
        lava_radius: bp.archetype.enable_lava.then_some(level),
        metal,
        biomes: defs,
        biome_index,
        biome_weights,
        csg,
    }
}

/// Строит планету по объекту `planet` из системы или по его полю `generator`.
pub fn generate_from_json(planet: &Value, media: &Media, opts: MetalOptions) -> Planet {
    let g = config::generator_object(planet);
    let biome = g.get("biome").and_then(Value::as_str).unwrap_or("earth");
    let arch = config::load_archetype(media, biome);
    let bp = PlanetBp::from_generator(g, arch);
    let csg = planet.get("planetCSG").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
    generate(&bp, media, csg, opts)
}

/// Список планет системы: файл `.pas`/`.json` с массивом `planets` или одна планета.
pub fn planets_of(doc: &Value) -> Vec<Value> {
    match doc.get("planets").and_then(Value::as_array) {
        Some(a) => a.clone(),
        None => vec![doc.clone()],
    }
}
