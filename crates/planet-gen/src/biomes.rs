//! Биомы поверхности: расстояние до воды и выбор подбиома по `PlanetBuilder::genBiomes`.

use serde::Serialize;
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use crate::vfs::Media;

use crate::config::{read_json, PlanetBp};
use crate::math::{length, sub};
use crate::noise::simplex_scaled;
use crate::surface::Surface;

/// Интервал условия биома: `[min, max, вес]`, `None` — без границы.
#[derive(Clone, Copy, Debug, Serialize)]
pub struct Range {
    pub min: Option<f32>,
    pub max: Option<f32>,
    pub weight: f32,
}

impl Range {
    fn parse(v: Option<&Value>) -> Range {
        let a = v.and_then(Value::as_array);
        let at = |i: usize| a.and_then(|a| a.get(i)).and_then(Value::as_f64).map(|x| x as f32);
        Range { min: at(0), max: at(1), weight: at(2).unwrap_or(0.0) }
    }

    fn inside(&self, x: f32) -> f32 {
        let lo = self.min.map_or(true, |m| m <= x);
        let hi = self.max.map_or(true, |m| x <= m);
        if lo && hi { 1.0 } else { 0.0 }
    }
}

/// Подбиом архетипа: условия выбора и оформление.
#[derive(Clone, Debug, Serialize)]
pub struct BiomeDef {
    pub spec: String,
    pub name: String,
    pub color: [f32; 4],
    pub base_texture: Option<String>,
    pub normal_texture: Option<String>,
    pub temperature: Range,
    pub elevation: Range,
    pub water_distance: Range,
}

/// Список подбиомов архетипа `/pa/terrain/<biome>.json`.
pub fn load(media: &Media, archetype: &str) -> Vec<BiomeDef> {
    let Some(arch) = read_json(media, &format!("/pa/terrain/{archetype}.json")) else {
        return Vec::new();
    };
    let list = arch.get("biomes").and_then(Value::as_array).cloned().unwrap_or_default();
    list.iter()
        .filter_map(|b| {
            let spec = b.get("spec")?.as_str()?.to_string();
            let sub = read_json(media, &spec).unwrap_or(Value::Null);
            let s = |k: &str| sub.get(k).and_then(Value::as_str).map(str::to_string);
            let color = sub
                .get("color")
                .and_then(Value::as_array)
                .map(|c| {
                    let f = |i: usize| c.get(i).and_then(Value::as_f64).unwrap_or(1.0) as f32;
                    [f(0), f(1), f(2), f(3)]
                })
                .unwrap_or([0.5, 0.5, 0.5, 1.0]);
            Some(BiomeDef {
                name: s("name").unwrap_or_else(|| spec.rsplit('/').next().unwrap_or("").trim_end_matches(".json").into()),
                spec,
                color,
                base_texture: s("base_texture"),
                normal_texture: s("normal_texture"),
                temperature: Range::parse(b.get("temperature")),
                elevation: Range::parse(b.get("elevation")),
                water_distance: Range::parse(b.get("water_distance")),
            })
        })
        .collect()
}

/// Граф вершин сетки, где копии вершины на рёбрах граней куба склеены.
pub struct Graph {
    /// Номер склеенного узла для каждой вершины поверхности.
    pub node: Vec<u32>,
    pub pos: Vec<[f32; 3]>,
    pub adj: Vec<Vec<u32>>,
}

impl Graph {
    pub fn new(s: &Surface, tris: &[[u32; 3]]) -> Graph {
        let mut key = HashMap::new();
        let mut node = Vec::with_capacity(s.surfels.len());
        let mut pos = Vec::new();
        for sf in &s.surfels {
            // Склеиваем по направлению: высоты копий совпадают, а координаты могут отличаться в последних битах.
            let n = sf.normal;
            let k = ((n[0] * 1e5).round() as i32, (n[1] * 1e5).round() as i32, (n[2] * 1e5).round() as i32);
            let id = *key.entry(k).or_insert_with(|| {
                pos.push(sf.pos);
                (pos.len() - 1) as u32
            });
            node.push(id);
        }
        let mut adj = vec![Vec::new(); pos.len()];
        let mut link = |a: u32, b: u32| {
            if a != b && !adj[a as usize].contains(&b) {
                adj[a as usize].push(b);
                adj[b as usize].push(a);
            }
        };
        for t in tris {
            let [a, b, c] = t.map(|i| node[i as usize]);
            link(a, b);
            link(b, c);
            link(c, a);
        }
        Graph { node, pos, adj }
    }

    /// Расстояние по сетке до ближайшего узла из `seed` (алгоритм Дейкстры).
    fn distance(&self, seed: &[bool]) -> Vec<f32> {
        #[derive(PartialEq)]
        struct Item(f32, u32);
        impl Eq for Item {}
        impl Ord for Item {
            fn cmp(&self, o: &Self) -> Ordering {
                o.0.partial_cmp(&self.0).unwrap_or(Ordering::Equal)
            }
        }
        impl PartialOrd for Item {
            fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
                Some(self.cmp(o))
            }
        }
        let mut d = vec![f32::MAX; self.pos.len()];
        let mut heap = BinaryHeap::new();
        for (i, &s) in seed.iter().enumerate() {
            if s {
                d[i] = 0.0;
                heap.push(Item(0.0, i as u32));
            }
        }
        while let Some(Item(di, i)) = heap.pop() {
            if di > d[i as usize] {
                continue;
            }
            for &j in &self.adj[i as usize] {
                let nd = di + length(sub(self.pos[i as usize], self.pos[j as usize]));
                if nd < d[j as usize] {
                    d[j as usize] = nd;
                    heap.push(Item(nd, j));
                }
            }
        }
        d
    }
}

/// Результат раскраски биомами.
pub struct BiomeMap {
    /// Подбиом каждой вершины поверхности.
    pub index: Vec<u8>,
    /// Доля каждого подбиома в окрестности вершины, `count` байт на вершину.
    pub weights: Vec<u8>,
    /// Расстояние до воды: на суше положительное, под водой отрицательное.
    pub water_distance: Vec<f32>,
}

/// `PlanetBuilder::computeWaterDistance` и `genBiomes`.
///
/// Игра считает расстояние двумя проходами по сетке центров ячеек; здесь то же
/// расстояние ищется точно по рёбрам сетки вершин, поэтому граница может сдвинуться на ячейку.
pub fn assign(bp: &PlanetBp, s: &Surface, graph: &Graph, biomes: &[BiomeDef]) -> BiomeMap {
    let n_nodes = graph.pos.len();
    let mut under = vec![false; n_nodes];
    let mut land = vec![false; n_nodes];
    for (i, sf) in s.surfels.iter().enumerate() {
        let k = graph.node[i] as usize;
        under[k] = sf.height < bp.water_height;
        land[k] = bp.water_height < sf.height;
    }
    let to_water = graph.distance(&under);
    let to_land = graph.distance(&land);
    let wd: Vec<f32> = (0..n_nodes)
        .map(|k| match (to_water[k], to_land[k]) {
            (w, _) if w == f32::MAX => f32::MAX,
            (_, l) if l == f32::MAX => -f32::MAX,
            (w, l) => w - l,
        })
        .collect();

    let level = bp.height_range * bp.water_height + bp.radius;
    let mut node_biome = vec![0u8; n_nodes];
    let mut done = vec![false; n_nodes];
    for (i, sf) in s.surfels.iter().enumerate() {
        let k = graph.node[i] as usize;
        if done[k] || biomes.is_empty() {
            continue;
        }
        done[k] = true;
        let p = sf.pos;
        let n = crate::math::normalize(p);
        let lat = 1.0 - (n[1] * 0.001 + n[0] * 0.001 + n[2]).abs();
        let temp = ((lat + lat - 1.0) + bp.temperature).clamp(-1.0, 1.0);
        let elev = if bp.archetype.ignore_height_range {
            0.0
        } else {
            ((length(p) - level) / bp.height_range).clamp(-1.0, 1.0)
        };
        let noise = simplex_scaled(
            bp.height_octaves,
            bp.height_persistence,
            bp.height_scale_rule,
            -1.0,
            1.0,
            -2.0 * p[0],
            -2.0 * p[1],
            -2.0 * p[2],
            bp.height_seed,
        );
        let (mut best, mut pick) = (0.0f32, 0usize);
        for (bi, b) in biomes.iter().enumerate() {
            let score = (b.water_distance.inside(wd[k]) * b.water_distance.weight
                + b.elevation.inside(elev) * b.elevation.weight
                + b.temperature.inside(temp) * b.temperature.weight)
                * (noise * 0.5 + 1.0);
            if best <= score && (score != best || noise <= 0.0) {
                best = score;
                pick = bi;
            }
        }
        node_biome[k] = pick as u8;
    }

    // Мягкие переходы для текстур: доли биомов в двух кольцах соседей.
    let count = biomes.len().max(1);
    let mut w = vec![0f32; n_nodes * count];
    for k in 0..n_nodes {
        w[k * count + node_biome[k] as usize] = 1.0;
    }
    for _ in 0..2 {
        let mut next = w.clone();
        for k in 0..n_nodes {
            let nb = &graph.adj[k];
            for c in 0..count {
                let s: f32 = nb.iter().map(|&j| w[j as usize * count + c]).sum();
                next[k * count + c] = (w[k * count + c] + s) / (nb.len() + 1) as f32;
            }
        }
        w = next;
    }

    let mut index = Vec::with_capacity(s.surfels.len());
    let mut weights = Vec::with_capacity(s.surfels.len() * count);
    let mut water_distance = Vec::with_capacity(s.surfels.len());
    for i in 0..s.surfels.len() {
        let k = graph.node[i] as usize;
        index.push(node_biome[k]);
        water_distance.push(wd[k]);
        for c in 0..count {
            weights.push((w[k * count + c] * 255.0).round() as u8);
        }
    }
    BiomeMap { index, weights, water_distance }
}
