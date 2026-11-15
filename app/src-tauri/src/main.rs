// Окно просмотра: команды вызывают крейт planet-gen и отдают фронту готовые данные.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use planet_gen::{config, generate_from_json, MetalOptions, Planet};
use serde_json::Value;

fn read_json(path: &std::path::Path) -> Result<Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| format!("{}: {e}", path.display()))
}

/// Системы, поставляемые с игрой (`ui/main/shared/default_systems.json`).
#[tauri::command(async)]
fn default_systems(media: Option<String>) -> Result<Value, String> {
    let media = media.map(Into::into).unwrap_or_else(config::default_media);
    read_json(&media.join("ui/main/shared/default_systems.json"))
}

#[tauri::command(async)]
fn read_system(path: String) -> Result<Value, String> {
    read_json(std::path::Path::new(&path))
}

#[tauri::command(async)]
fn generate(planet: Value, max_slope: Option<f32>, media: Option<String>) -> Planet {
    let media = media.map(Into::into).unwrap_or_else(config::default_media);
    let mut opts = MetalOptions::default();
    if let Some(s) = max_slope {
        opts.max_slope_deg = s;
    }
    generate_from_json(&planet, &media, opts)
}

/// Файл системы и номер планеты из командной строки: `planet-gen-app <система.pas> [--planet N]`.
#[tauri::command]
fn startup_args() -> Value {
    let mut path = None;
    let mut planet = 0u64;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        if a == "--planet" {
            planet = args.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        } else if !a.starts_with('-') && path.is_none() {
            path = Some(a);
        }
    }
    serde_json::json!({ "path": path, "planet": planet })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![default_systems, read_system, generate, startup_args])
        .run(tauri::generate_context!())
        .expect("запуск окна planet-gen");
}
