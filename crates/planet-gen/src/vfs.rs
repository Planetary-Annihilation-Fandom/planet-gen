//! Виртуальная файловая система ресурсов игры.
//!
//! Модули запрашивают файлы по путям игры (`/pa/terrain/moon.json`), а `Media` находит их
//! в смонтированных папках. Достаточно указать корень `media` установленной игры:
//! `/pa/...` сначала ищется в `pa_ex1` (Titans), затем в `pa`, остальные пути — от корня.
//! Дополнительные папки (например, копия мода) монтируются поверх через [`Media::mount`].

use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct Media {
    /// Префикс пути игры и папка, в которую он отображается; первые точки имеют приоритет.
    mounts: Vec<(String, PathBuf)>,
}

impl Media {
    /// Корень `media` игры с Titans поверх базовой игры.
    pub fn game(root: impl Into<PathBuf>) -> Media {
        let root = root.into();
        Media {
            mounts: vec![
                ("/pa/".into(), root.join("pa_ex1")),
                ("/pa/".into(), root.join("pa")),
                ("/".into(), root),
            ],
        }
    }

    /// Монтирует папку `dir` как `prefix` поверх уже смонтированных.
    pub fn mount(&mut self, prefix: &str, dir: impl Into<PathBuf>) {
        let mut p = prefix.replace('\\', "/");
        if !p.starts_with('/') {
            p.insert(0, '/');
        }
        if !p.ends_with('/') {
            p.push('/');
        }
        self.mounts.insert(0, (p, dir.into()));
    }

    /// Настоящий путь файла игры или `None`, если файла нет ни в одной точке монтирования.
    pub fn resolve(&self, spec: &str) -> Option<PathBuf> {
        let spec = spec.replace('\\', "/");
        let spec = if spec.starts_with('/') { spec } else { format!("/{spec}") };
        let lower = spec.to_ascii_lowercase();
        self.mounts.iter().find_map(|(prefix, dir)| {
            if !lower.starts_with(&prefix.to_ascii_lowercase()) {
                return None;
            }
            let p = dir.join(&spec[prefix.len()..]);
            p.is_file().then_some(p)
        })
    }

    pub fn read(&self, spec: &str) -> Result<Vec<u8>, String> {
        let path = self.resolve(spec).ok_or_else(|| format!("{spec}: файл не найден"))?;
        std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))
    }

    /// JSON по пути игры; BOM в начале файла допускается.
    pub fn json(&self, spec: &str) -> Option<Value> {
        let bytes = self.read(spec).ok()?;
        let text = String::from_utf8_lossy(&bytes);
        serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
    }
}

impl From<&Path> for Media {
    fn from(p: &Path) -> Media {
        Media::game(p)
    }
}

impl From<PathBuf> for Media {
    fn from(p: PathBuf) -> Media {
        Media::game(p)
    }
}
