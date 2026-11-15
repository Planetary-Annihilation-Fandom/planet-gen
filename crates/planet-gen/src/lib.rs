//! Воссоздание генератора планет Planetary Annihilation: поверхность, вода и металл.

pub mod config;
pub mod math;
pub mod metal;
pub mod noise;
pub mod raycast;
pub mod rng;
pub mod surface;
mod tables;

use serde::Serialize;
use serde_json::Value;
use std::path::Path;

pub use config::{Archetype, PlanetBp, SymmetryType};
pub use metal::{MetalOptions, MetalResult, MetalSpot};
pub use surface::Surface;

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
}

/// Строит планету по готовому `PlanetBp`.
pub fn generate(bp: &PlanetBp, opts: MetalOptions) -> Planet {
    let mut s = Surface::generate(bp.radius, bp.plate_size);
    if !bp.archetype.ignore_height_range {
        s.gen_height(bp);
    }
    if bp.symmetry_type != SymmetryType::None {
        s.mirror(bp);
    }
    s.gen_surface_normals();

    let (mut lo, mut hi) = (f32::MAX, f32::MIN);
    for sf in &s.surfels {
        let r = math::length(sf.pos);
        lo = lo.min(r);
        hi = hi.max(r);
    }
    let rc = raycast::Raycaster::new(&s);
    let metal = metal::generate(bp, &rc, hi, lo, opts);
    let level = bp.water_height * bp.height_range + bp.radius;

    Planet {
        radius: bp.radius,
        biome: bp.archetype.name.clone(),
        plates: s.n,
        positions: s.surfels.iter().map(|x| x.pos).collect(),
        colors: s.surfels.iter().map(|x| x.color).collect(),
        heights: s.surfels.iter().map(|x| x.height).collect(),
        triangles: s.triangles(),
        min_radius: lo,
        max_radius: hi,
        water_radius: bp.archetype.enable_water.then_some(level),
        lava_radius: bp.archetype.enable_lava.then_some(level),
        metal,
    }
}

/// Строит планету по объекту `planet` из системы или по его полю `generator`.
pub fn generate_from_json(planet: &Value, media: &Path, opts: MetalOptions) -> Planet {
    let g = config::generator_object(planet);
    let biome = g.get("biome").and_then(Value::as_str).unwrap_or("earth");
    let arch = config::load_archetype(media, biome);
    let bp = PlanetBp::from_generator(g, arch);
    generate(&bp, opts)
}

/// Список планет системы: файл `.pas`/`.json` с массивом `planets` или одна планета.
pub fn planets_of(doc: &Value) -> Vec<Value> {
    match doc.get("planets").and_then(Value::as_array) {
        Some(a) => a.clone(),
        None => vec![doc.clone()],
    }
}
