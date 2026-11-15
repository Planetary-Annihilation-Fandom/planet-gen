//! Параметры планеты. Вход — объект `planet` из файла системы (.pas) или его поле
//! `generator`; перевод во внутренние величины повторяет `SimModule::createBlueprint`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

use crate::rng::make_seed;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SymmetryType {
    None,
    Terrain,
    TerrainCsg,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HeightAdjustment {
    pub pos: [f32; 3],
    pub radius: f32,
    pub adjustment: f32,
}

/// Значения из архетипа `/pa/terrain/<biome>.json`, нужные первому этапу.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Archetype {
    pub name: String,
    pub enable_water: bool,
    pub enable_lava: bool,
    pub ignore_height_range: bool,
    /// `placement_size` спецификации металлической точки.
    pub metal_placement_size: [f32; 3],
}

impl Default for Archetype {
    fn default() -> Self {
        Self {
            name: "earth".into(),
            enable_water: true,
            enable_lava: false,
            ignore_height_range: false,
            metal_placement_size: [16.0, 16.0, 27.0],
        }
    }
}

/// `PlanetBP` после `createBlueprint`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlanetBp {
    pub random_seed: u32,
    pub radius: f32,
    pub height_scale_rule: f32,
    pub height_octaves: f32,
    pub height_persistence: f32,
    pub height_seed: f32,
    pub plate_size: f32,
    pub height_range: f32,
    pub height_scale: f32,
    /// Нормированный уровень воды: доля `height_range` над радиусом.
    pub water_height: f32,
    pub water_depth: f32,
    pub temperature: f32,
    pub metal_density: f32,
    pub metal_clusters: f32,
    pub metal_spot_limit: i32,
    pub symmetry_type: SymmetryType,
    pub symmetrical_metal: bool,
    pub symmetrical_starts: bool,
    pub height_adjustments: Vec<HeightAdjustment>,
    pub archetype: Archetype,
}

fn num(v: &Value, key: &str, default: f64) -> f64 {
    v.get(key).and_then(Value::as_f64).unwrap_or(default)
}

fn boolean(v: &Value, key: &str) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn vec3(v: &Value) -> Option<[f32; 3]> {
    let a = v.as_array()?;
    Some([a.first()?.as_f64()? as f32, a.get(1)?.as_f64()? as f32, a.get(2)?.as_f64()? as f32])
}

/// Объект генератора: принимает планету системы, её `generator` или `planet`.
pub fn generator_object(v: &Value) -> &Value {
    if let Some(g) = v.get("generator") {
        return g;
    }
    if let Some(p) = v.get("planet") {
        return generator_object(p);
    }
    v
}

impl PlanetBp {
    pub fn from_generator(g: &Value, archetype: Archetype) -> Self {
        let pct = 100.0f64;
        let radius = num(g, "radius", 1000.0) as f32;
        let random_seed = num(g, "seed", 0.0) as i64 as u32;
        let symmetry_type = match g.get("symmetryType").and_then(Value::as_str).unwrap_or("none") {
            s if s.eq_ignore_ascii_case("terrain") => SymmetryType::Terrain,
            s if s.eq_ignore_ascii_case("terrain and csg") => SymmetryType::TerrainCsg,
            _ => SymmetryType::None,
        };
        let height_range = ((num(g, "heightRange", 0.0) / pct) * 140.0 + 10.0) as f32;
        let height_adjustments = g
            .get("heightAdjustments")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|h| {
                        Some(HeightAdjustment {
                            pos: vec3(h.get("pos").or_else(|| h.get("position"))?)?,
                            radius: num(h, "radius", 0.0) as f32,
                            adjustment: num(h, "adjustment", 0.0) as f32,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Self {
            random_seed,
            radius,
            height_scale_rule: 0.000_833_333_35,
            height_octaves: 4.0,
            height_persistence: 0.5,
            height_seed: make_seed(random_seed, radius),
            plate_size: 32.0,
            height_range,
            height_scale: 4.0f64.powf(num(g, "biomeScale", 0.0) / 50.0 - 1.0) as f32,
            water_height: ((num(g, "waterHeight", 0.0) / pct - 0.5) * 1.5) as f32,
            water_depth: (num(g, "waterDepth", 0.0) / pct) as f32,
            temperature: ((num(g, "temperature", 0.0) / pct) * 3.5 - 1.5) as f32,
            metal_density: (num(g, "metalDensity", 0.0) / pct) as f32,
            metal_clusters: (num(g, "metalClusters", 0.0) / pct) as f32,
            metal_spot_limit: num(g, "metalSpotLimit", -1.0) as i32,
            symmetry_type,
            symmetrical_metal: boolean(g, "symmetricalMetal"),
            symmetrical_starts: boolean(g, "symmetricalStarts"),
            height_adjustments,
            archetype,
        }
    }

    /// Мировой радиус уровня воды; `None`, если в архетипе нет воды.
    pub fn water_radius(&self) -> Option<f32> {
        self.archetype
            .enable_water
            .then(|| self.water_height * self.height_range + self.radius)
    }
}

/// Папка `media` установленной игры по умолчанию.
pub fn default_media() -> PathBuf {
    PathBuf::from(r"C:\workroot\software\steam\steamapps\common\Planetary Annihilation Titans\media")
}

pub fn read_json(media: &Path, spec: &str) -> Option<Value> {
    let rel = spec.trim_start_matches('/');
    let text = std::fs::read_to_string(media.join(rel)).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

/// Ищет поле спецификации с учётом цепочки `base_spec`.
fn spec_field(media: &Path, spec: &str, key: &str) -> Option<Value> {
    let mut cur = spec.to_string();
    for _ in 0..8 {
        let v = read_json(media, &cur)?;
        if let Some(f) = v.get(key) {
            return Some(f.clone());
        }
        cur = v.get("base_spec")?.as_str()?.to_string();
    }
    None
}

pub fn load_archetype(media: &Path, biome: &str) -> Archetype {
    let mut a = Archetype { name: biome.to_string(), ..Archetype::default() };
    let Some(v) = read_json(media, &format!("/pa/terrain/{biome}.json")) else {
        return a;
    };
    a.enable_water = v.get("water").is_some();
    a.enable_lava = boolean(&v, "enable_lava");
    a.ignore_height_range = boolean(&v, "ignore_height_range");
    let spec = v
        .get("metal_spot_spec")
        .and_then(Value::as_str)
        .unwrap_or("/pa/effects/features/metal_splat_02.json");
    if let Some(size) = spec_field(media, spec, "placement_size").as_ref().and_then(vec3) {
        a.metal_placement_size = size;
    }
    a
}
