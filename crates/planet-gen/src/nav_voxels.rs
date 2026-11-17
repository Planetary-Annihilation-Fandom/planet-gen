//! Отладочная проходимость из итоговой геометрии просмотрщика.
//! Правила сетки сверены с `PathGraphImpl::buildVoxels` (RVA 0x34efb0)
//! и `NavGeom::addLandGeometry` (RVA 0x340a00) сервера 14190493.
//! Просмотрщик использует собственный результат CSG. Он не строит острова,
//! не учитывает динамические препятствия и оценивает границу лавы по центрам ячеек.

use std::collections::HashMap;

use crate::math::{add, cross, dot, length, normalize, scale, sub, V3};
use crate::raycast::Raycaster;
use crate::Planet;

// Сетка NavWorld в сервере 14190493. Центр ячейки i находится в (i + 0.5) * 4.
const CELL_SIZE: f32 = 4.0;
const MIN_BRUSH_UP_DOT: f32 = 0.7;
const BRUSH_UNDERSIDE_DOT: f32 = -0.9;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Terrain {
    Passable,
    Blocked,
}

/// Показывает, где амфибия может двигаться по рельефу. Суша и морское дно
/// подходят для движения, непроходимые кисти и лава блокируют ячейки.
/// Буфер для WebView начинается с размера ячейки (f32 LE). За ним идут записи
/// с координатами и признаком преграды (четыре i16 LE на ячейку).
pub fn amphibious_cells(planet: &Planet) -> Vec<u8> {
    let mut cells = HashMap::new();
    for triangle in &planet.triangles {
        let points = triangle.map(|i| planet.positions[i as usize]);
        rasterize(&mut cells, points, Terrain::Passable, planet.lava_radius);
    }
    let mut brush_cells = HashMap::new();
    let mut brush_vertices = Vec::new();
    let mut passable_faces = Vec::new();
    let mut blocked_faces = Vec::new();
    for brush in &planet.csg.brushes {
        let start = brush_vertices.len() as u32;
        brush_vertices.extend_from_slice(&brush.positions);
        for triangle in brush.indices.chunks_exact(3) {
            let indices = [triangle[0], triangle[1], triangle[2]];
            let points = indices.map(|i| brush.positions[i as usize]);
            let Some(terrain) = brush_terrain(points, brush.pathable) else {
                continue;
            };
            let faces = match terrain {
                Terrain::Passable => &mut passable_faces,
                Terrain::Blocked => &mut blocked_faces,
            };
            faces.push(indices.map(|i| start + i));
            rasterize(&mut brush_cells, points, terrain, planet.lava_radius);
        }
    }
    apply_brush_footprint(
        &mut cells,
        planet,
        brush_vertices,
        passable_faces,
        blocked_faces,
    );
    for (cell, terrain) in brush_cells {
        let combined = cells.entry(cell).or_insert(terrain);
        if terrain == Terrain::Blocked {
            *combined = terrain;
        }
    }

    let mut data = Vec::with_capacity(4 + cells.len() * 8);
    data.extend_from_slice(&CELL_SIZE.to_le_bytes());
    for (cell, terrain) in cells {
        for coordinate in cell {
            data.extend_from_slice(&(coordinate as i16).to_le_bytes());
        }
        data.extend_from_slice(&i16::from(terrain == Terrain::Blocked).to_le_bytes());
    }
    data
}

/// Пропускает нижние грани проходимой кисти и делит остальные на проходы и стенки.
fn brush_terrain([a, b, c]: [V3; 3], pathable: bool) -> Option<Terrain> {
    if !pathable {
        return Some(Terrain::Blocked);
    }
    let up = normalize(add(add(a, b), c));
    let normal = normalize(cross(sub(b, a), sub(c, a)));
    let up_dot = dot(normal, up);
    if up_dot <= BRUSH_UNDERSIDE_DOT {
        None
    } else if up_dot <= MIN_BRUSH_UP_DOT {
        Some(Terrain::Blocked)
    } else {
        Some(Terrain::Passable)
    }
}

/// Проверяет, что находится над ячейками основы. Стенка блокирует ячейку,
/// а верхняя проходимая площадка заменяет нижнюю ячейку своей поверхностью.
fn apply_brush_footprint(
    cells: &mut HashMap<[i32; 3], Terrain>,
    planet: &Planet,
    vertices: Vec<V3>,
    passable_faces: Vec<[u32; 3]>,
    blocked_faces: Vec<[u32; 3]>,
) {
    if passable_faces.is_empty() && blocked_faces.is_empty() {
        return;
    }
    let passable = (!passable_faces.is_empty())
        .then(|| Raycaster::from_mesh(vertices.clone(), passable_faces, planet.plates));
    let blocked = (!blocked_faces.is_empty())
        .then(|| Raycaster::from_mesh(vertices, blocked_faces, planet.plates));
    cells.retain(|cell, terrain| {
        if *terrain == Terrain::Blocked {
            return true;
        }
        let center = cell.map(|index| (index as f32 + 0.5) * CELL_SIZE);
        let direction = normalize(center);
        let outer = scale(direction, planet.max_radius + CELL_SIZE);
        let inner = scale(direction, (planet.min_radius - CELL_SIZE).max(0.0));
        if blocked
            .as_ref()
            .is_some_and(|mesh| mesh.segment(outer, inner).is_some())
        {
            *terrain = Terrain::Blocked;
            return true;
        }
        !passable
            .as_ref()
            .is_some_and(|mesh| mesh.segment(outer, center).is_some())
    });
}

/// Перечисляет ячейки, которых касается треугольник.
fn rasterize(
    cells: &mut HashMap<[i32; 3], Terrain>,
    points: [V3; 3],
    terrain: Terrain,
    lava: Option<f32>,
) {
    let [a, b, c] = points;
    let edges = [sub(b, a), sub(c, b), sub(a, c)];
    let normal = cross(edges[0], edges[1]);
    if dot(normal, normal) == 0.0 {
        return;
    }
    let min_index = i16::MIN as i32;
    let max_index = i16::MAX as i32;
    let lo: [i32; 3] =
        std::array::from_fn(|i| (a[i].min(b[i]).min(c[i]) / CELL_SIZE).floor() as i32);
    let hi: [i32; 3] =
        std::array::from_fn(|i| (a[i].max(b[i]).max(c[i]) / CELL_SIZE).floor() as i32);
    if (0..3).any(|i| lo[i] > max_index || hi[i] < min_index) {
        return;
    }
    let lo = lo.map(|i| i.max(min_index));
    let hi = hi.map(|i| i.min(max_index));

    let mut axes = [Projection::new(normal, points); 10];
    for ([x, y, z], projections) in edges.into_iter().zip(axes[1..].chunks_exact_mut(3)) {
        projections[0] = Projection::new([0.0, z, -y], points);
        projections[1] = Projection::new([-z, 0.0, x], points);
        projections[2] = Projection::new([y, -x, 0.0], points);
    }
    let mut raster = Raster {
        cells,
        axes: &axes,
        terrain,
        lava,
    };
    raster.fill(lo, hi);
}

#[derive(Clone, Copy)]
struct Projection {
    axis: V3,
    abs_axis: V3,
    low: f32,
    high: f32,
}

impl Projection {
    /// Запоминает проекцию треугольника на одну ось, чтобы не вычислять её для каждой ячейки.
    fn new(axis: V3, points: [V3; 3]) -> Self {
        let [a, b, c] = points.map(|p| dot(axis, p));
        Self {
            axis,
            abs_axis: axis.map(f32::abs),
            low: a.min(b).min(c),
            high: a.max(b).max(c),
        }
    }

    /// Проверяет, пересекаются ли проекции треугольника и блока ячеек на этой оси.
    fn overlaps(&self, center: V3, half_size: V3) -> bool {
        let middle = dot(self.axis, center);
        let radius = dot(self.abs_axis, half_size);
        self.low <= middle + radius && self.high >= middle - radius
    }
}

struct Raster<'a> {
    cells: &'a mut HashMap<[i32; 3], Terrain>,
    axes: &'a [Projection; 10],
    terrain: Terrain,
    lava: Option<f32>,
}

impl Raster<'_> {
    /// Делит блок до отдельных ячеек и сразу отбрасывает части, которых грань не касается.
    fn fill(&mut self, lo: [i32; 3], hi: [i32; 3]) {
        let middle =
            std::array::from_fn(|i| (hi[i] as f32 + lo[i] as f32 + 1.0) * (CELL_SIZE * 0.5));
        let half_size = std::array::from_fn(|i| (hi[i] - lo[i] + 1) as f32 * (CELL_SIZE * 0.5));
        if self
            .axes
            .iter()
            .any(|axis| !axis.overlaps(middle, half_size))
        {
            return;
        }

        if lo == hi {
            let terrain = if self.lava.is_some_and(|radius| length(middle) < radius) {
                Terrain::Blocked
            } else {
                self.terrain
            };
            let existing = self.cells.entry(lo).or_insert(terrain);
            if terrain == Terrain::Blocked {
                *existing = terrain;
            }
            return;
        }

        let axis = (0..3).max_by_key(|&i| hi[i] - lo[i]).unwrap();
        let mut left_hi = hi;
        left_hi[axis] = lo[axis] + (hi[axis] - lo[axis]) / 2;
        let mut right_lo = lo;
        right_lo[axis] = left_hi[axis] + 1;
        self.fill(lo, left_hi);
        self.fill(right_lo, hi);
    }
}
