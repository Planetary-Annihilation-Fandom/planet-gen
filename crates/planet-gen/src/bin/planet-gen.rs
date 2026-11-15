//! planet-gen <система.pas|планета.json> [--planet N] [--media DIR] [--slope DEG]
//!            [--format summary|json|obj] [--out FILE]

use planet_gen::{config, generate_from_json, planets_of, MetalOptions, Planet};
use std::io::Write;
use std::path::PathBuf;

fn usage() -> ! {
    eprintln!(
        "использование: planet-gen <система.pas|планета.json> [--planet N] [--media DIR] \
         [--slope DEG] [--format summary|json|obj] [--out FILE]"
    );
    std::process::exit(2)
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut input = None;
    let mut index = 0usize;
    let mut media = config::default_media();
    let mut opts = MetalOptions::default();
    let mut format = "summary".to_string();
    let mut out: Option<PathBuf> = None;
    while let Some(a) = args.next() {
        let mut val = || args.next().unwrap_or_else(|| usage());
        match a.as_str() {
            "--planet" => index = val().parse().unwrap_or_else(|_| usage()),
            "--media" => media = PathBuf::from(val()),
            "--slope" => opts.max_slope_deg = val().parse().unwrap_or_else(|_| usage()),
            "--format" => format = val(),
            "--out" => out = Some(PathBuf::from(val())),
            "-h" | "--help" => usage(),
            _ if input.is_none() => input = Some(PathBuf::from(a)),
            _ => usage(),
        }
    }
    let input = input.unwrap_or_else(|| usage());
    let text = std::fs::read_to_string(&input).unwrap_or_else(|e| {
        eprintln!("не удалось прочитать {}: {e}", input.display());
        std::process::exit(1)
    });
    let doc: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap_or_else(|e| {
        eprintln!("неверный JSON: {e}");
        std::process::exit(1)
    });
    let planets = planets_of(&doc);
    let Some(p) = planets.get(index) else {
        eprintln!("в файле {} планет, номер {index} вне диапазона", planets.len());
        std::process::exit(1)
    };
    let planet = generate_from_json(p, &media, opts);

    let body = match format.as_str() {
        "summary" => summary(&planet),
        "json" => serde_json::to_string(&planet).unwrap(),
        "obj" => obj(&planet),
        _ => usage(),
    };
    match out {
        Some(path) => std::fs::write(&path, body).expect("запись результата"),
        None => std::io::stdout().write_all(body.as_bytes()).unwrap(),
    }
}

fn summary(p: &Planet) -> String {
    let m = &p.metal;
    let mut s = format!(
        "биом {}\nрадиус {}, плит на грань {}, вершин {}, треугольников {}\n\
         рельеф {:.2}..{:.2}\nвода {}\nлава {}\nкандидатов металла {}, точек {}\n",
        p.biome,
        p.radius,
        p.plates,
        p.positions.len(),
        p.triangles.len(),
        p.min_radius,
        p.max_radius,
        p.water_radius.map_or("нет".into(), |r| format!("{r:.3}")),
        p.lava_radius.map_or("нет".into(), |r| format!("{r:.3}")),
        m.candidates.len(),
        m.spots.len(),
    );
    let mut counts = vec![0usize; p.biomes.len()];
    for &b in &p.biome_index {
        if let Some(c) = counts.get_mut(b as usize) {
            *c += 1;
        }
    }
    let list: Vec<String> = p.biomes.iter().zip(&counts).map(|(b, c)| format!("{} {c}", b.name)).collect();
    s.push_str(&format!("подбиомы: {}
", list.join(", ")));
    s.push_str(&format!(
        "кисти CSG {}, пропущено {}, сдвинуто вершин {}
",
        p.csg.brushes.len(),
        p.csg.skipped.len(),
        p.csg_changed
    ));
    for (spec, why) in &p.csg.skipped {
        s.push_str(&format!("  пропущена {spec}: {why}
"));
    }
    if m.limit_is_random {
        s.push_str("задан metalSpotLimit: игра обрезает точки в случайном порядке\n");
    }
    for sp in &m.spots {
        s.push_str(&format!("{:.3} {:.3} {:.3}\n", sp.pos[0], sp.pos[1], sp.pos[2]));
    }
    s
}

fn obj(p: &Planet) -> String {
    let mut s = String::with_capacity(p.positions.len() * 40);
    s.push_str("# planet-gen\n");
    for v in &p.positions {
        s.push_str(&format!("v {} {} {}\n", v[0], v[1], v[2]));
    }
    for t in &p.triangles {
        s.push_str(&format!("f {} {} {}\n", t[0] + 1, t[1] + 1, t[2] + 1));
    }
    s
}
