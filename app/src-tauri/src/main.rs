// Окно просмотра: команды вызывают крейт planet-gen и отдают фронту готовые данные.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use planet_gen::{config, generate_from_json, Media, MetalOptions, Planet};
use serde::Serialize;
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tauri::{ipc::Response, State};

#[derive(Clone, Serialize)]
struct ViewerPlanet {
    nav_revision: u64,
    #[serde(flatten)]
    planet: Arc<Planet>,
}

#[derive(Default)]
struct ViewerState(Mutex<Option<ViewerPlanet>>);

fn read_json(path: &std::path::Path) -> Result<Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| format!("{}: {e}", path.display()))
}

/// Ресурсы игры: корень `media` из аргумента или установленная игра.
fn media_of(root: Option<String>) -> Media {
    Media::game(root.map(Into::into).unwrap_or_else(config::default_media))
}

/// Системы, поставляемые с игрой (`ui/main/shared/default_systems.json`).
#[tauri::command(async)]
fn default_systems(media: Option<String>) -> Result<Value, String> {
    media_of(media).json("/ui/main/shared/default_systems.json").ok_or_else(|| "default_systems.json не найден".to_string())
}

#[tauri::command(async)]
fn read_system(path: String) -> Result<Value, String> {
    read_json(std::path::Path::new(&path))
}

/// Сохраняет геометрию открытой планеты, чтобы рассчитать воксели по запросу без повторной генерации.
#[tauri::command(async)]
fn generate(
    planet: Value,
    max_slope: Option<f32>,
    media: Option<String>,
    state: State<'_, ViewerState>,
) -> Result<ViewerPlanet, String> {
    let media = media_of(media);
    let mut opts = MetalOptions::default();
    if let Some(s) = max_slope {
        opts.max_slope_deg = s;
    }
    let planet = Arc::new(generate_from_json(&planet, &media, opts));
    let mut current = state.0.lock().map_err(|e| e.to_string())?;
    let nav_revision = current.as_ref().map_or(1, |previous| previous.nav_revision + 1);
    let result = ViewerPlanet { planet, nav_revision };
    *current = Some(result.clone());
    Ok(result)
}

/// Возвращает воксели открытой планеты. Проверка версии защищает от запроса для предыдущей карты.
#[tauri::command]
async fn navigation_voxels(nav_revision: u64, state: State<'_, ViewerState>) -> Result<Response, String> {
    let planet = state.0.lock().map_err(|e| e.to_string())?
        .as_ref()
        .filter(|current| current.nav_revision == nav_revision)
        .map(|current| Arc::clone(&current.planet))
        .ok_or_else(|| "Планета в просмотрщике уже сменилась".to_string())?;
    tauri::async_runtime::spawn_blocking(move || Response::new(planet_gen::nav_voxels::amphibious_cells(&planet)))
        .await
        .map_err(|e| e.to_string())
}

/// Сухая основа для шаблона: без жидкостей, CSG и исходного металла.
#[tauri::command(async)]
fn generate_base(planet: Value, media: Option<String>) -> Result<Value, String> {
    let media = media_of(media);
    let mut g = config::generator_object(&planet).clone();
    let radius = g.get("radius").and_then(Value::as_f64).unwrap_or(500.0);
    if !radius.is_finite() || !(100.0..=1200.0).contains(&radius) {
        return Err("Радиус основы должен быть от 100 до 1200".into());
    }
    for (key, value) in [("waterHeight", 0), ("waterDepth", 0), ("metalDensity", 0), ("metalClusters", 0), ("metalSpotLimit", 0)] {
        g[key] = value.into();
    }
    let biome = g.get("biome").and_then(Value::as_str).unwrap_or("desert");
    let mut arch = config::load_archetype(&media, biome);
    arch.enable_water = false;
    arch.enable_lava = false;
    let bp = config::PlanetBp::from_generator(&g, arch);
    let mut result = planet_gen::generate(&bp, &media, &[], MetalOptions::default());
    result.metal.spots.clear();
    result.metal.candidates.clear();
    result.metal.limit_is_random = false;
    let raw_noise: Vec<f32> = result.positions.iter().map(|&p| {
        planet_gen::surface::height_noise(&bp, planet_gen::math::scale(planet_gen::math::normalize(p), bp.radius))
    }).collect();
    let biome_noise: Vec<f32> = result.positions.iter().map(|&p| planet_gen::biomes::noise_at(&bp, p)).collect();
    let temperature: Vec<f32> = result.positions.iter().map(|&p| {
        let n = planet_gen::math::normalize(p);
        let lat = 1.0 - (n[1]*0.001 + n[0]*0.001 + n[2]).abs();
        ((lat+lat-1.0)+bp.temperature).clamp(-1.0,1.0)
    }).collect();
    let fields = serde_json::json!([
        {"id":"heightNoise","label":"Шум высоты","values":raw_noise},
        {"id":"biomeNoise","label":"Шум подбиомов","values":biome_noise},
        {"id":"temperature","label":"Температура","values":temperature},
        {"id":"normalizedHeight","label":"Нормированная высота основы","values":result.heights}
    ]);
    let mut value = serde_json::to_value(&result).map_err(|e| e.to_string())?;
    value["generation_fields"] = fields;
    Ok(value)
}

/// Изображение `.papa` по пути игры: 8 байт ширины и высоты (u32 LE), затем RGBA8.
/// Сторона уменьшается до 512 — просмотрщику больше не нужно.
#[tauri::command(async)]
fn texture(path: String, media: Option<String>) -> Result<tauri::ipc::Response, String> {
    let img = planet_gen::papa::read_image(&media_of(media), &path)?.downscale_to(512);
    let mut out = Vec::with_capacity(8 + img.rgba.len());
    out.extend_from_slice(&img.width.to_le_bytes());
    out.extend_from_slice(&img.height.to_le_bytes());
    out.extend_from_slice(&img.rgba);
    Ok(tauri::ipc::Response::new(out))
}

/// Файл системы и номер планеты из командной строки:
/// `planet-gen-app --viewer`, `<система.pas> [--planet N]` или `--random <архетип>`.
#[tauri::command]
fn startup_args() -> Value {
    let mut path = None;
    let mut planet = 0u64;
    let mut random: Option<String> = None;
    let mut templates = false;
    let mut viewer = false;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        if a == "--planet" {
            planet = args.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        } else if a == "--random" {
            random = args.next();
        } else if a == "--templates" {
            templates = true;
        } else if a == "--viewer" {
            viewer = true;
        } else if !a.starts_with('-') && path.is_none() {
            path = Some(a);
        }
    }
    serde_json::json!({ "path": path, "planet": planet, "random": random, "templates": templates, "viewer": viewer })
}

/// Запускает окно и подключает команды, которыми пользуется просмотрщик.
fn main() {
    tauri::Builder::default()
        .manage(ViewerState::default())
        .invoke_handler(tauri::generate_handler![default_systems, read_system, generate, navigation_voxels, generate_base, texture, startup_args])
        .run(tauri::generate_context!())
        .expect("запуск окна planet-gen");
}
