//! Чтение файлов `.papa`: текстуры и статические меши, которых хватает для кистей CSG и биомов.
//!
//! Раскладка заголовков взята из `tools/media/blender/io_scene_papa_windows/papafile.py`.

use std::path::Path;

fn u16_at(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([b[o], b[o + 1]])
}
fn i16_at(b: &[u8], o: usize) -> i16 {
    u16_at(b, o) as i16
}
fn u32_at(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes(b[o..o + 4].try_into().unwrap())
}
fn i64_at(b: &[u8], o: usize) -> i64 {
    i64::from_le_bytes(b[o..o + 8].try_into().unwrap())
}
fn f32_at(b: &[u8], o: usize) -> f32 {
    f32::from_le_bytes(b[o..o + 4].try_into().unwrap())
}

/// Изображение RGBA8, строки сверху вниз, как в файле.
#[derive(Clone, Debug)]
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Текстура папы: либо данные внутри файла, либо ссылка на другой `.papa`.
#[derive(Clone, Debug)]
pub enum Texture {
    Inline(Image),
    External(String),
}

#[derive(Clone, Debug, Default)]
pub struct Material {
    pub shader: String,
    /// Имя параметра (`DiffuseTexture`, `NormalTexture`, …) и номер текстуры файла.
    pub textures: Vec<(String, usize)>,
}

#[derive(Clone, Debug)]
pub struct Group {
    pub material: usize,
    pub first_index: u32,
    pub count: u32,
}

/// Меш со сплошными массивами вершин.
#[derive(Clone, Debug, Default)]
pub struct Mesh {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub uvs: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
    pub groups: Vec<Group>,
}

#[derive(Debug, Default)]
pub struct Papa {
    pub strings: Vec<String>,
    pub textures: Vec<Texture>,
    pub materials: Vec<Material>,
    pub meshes: Vec<Mesh>,
}

impl Papa {
    pub fn read(path: &Path) -> Result<Papa, String> {
        let b = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
        Papa::parse(&b).map_err(|e| format!("{}: {e}", path.display()))
    }

    pub fn parse(b: &[u8]) -> Result<Papa, String> {
        if b.len() < 104 || u32_at(b, 0) != 0x5061_7061 {
            return Err("не файл papa".into());
        }
        let count = |i: usize| u16_at(b, 4 + i * 2) as usize;
        let offset = |i: usize| i64_at(b, 32 + i * 8);
        let (n_str, n_tex, n_vb, n_ib, n_mat, n_mesh) = (count(2), count(3), count(4), count(5), count(6), count(7));
        let (o_str, o_tex, o_vb, o_ib, o_mat, o_mesh) =
            (offset(0), offset(1), offset(2), offset(3), offset(4), offset(5));
        let check = |o: i64, len: usize| -> Result<usize, String> {
            if o < 0 || o as usize + len > b.len() {
                Err(format!("смещение {o} вне файла"))
            } else {
                Ok(o as usize)
            }
        };

        let mut strings = Vec::with_capacity(n_str);
        for i in 0..n_str {
            let h = check(o_str, (i + 1) * 16)? + i * 16;
            let len = i64_at(b, h) as usize;
            let at = check(i64_at(b, h + 8), len)?;
            strings.push(String::from_utf8_lossy(&b[at..at + len]).into_owned());
        }
        let name = |i: i64| strings.get(i as usize).cloned().unwrap_or_default();

        let mut textures = Vec::with_capacity(n_tex);
        for i in 0..n_tex {
            let h = check(o_tex, (i + 1) * 24)? + i * 24;
            let name_index = i16_at(b, h);
            let format = b[h + 2];
            let w = u16_at(b, h + 4) as u32;
            let hgt = u16_at(b, h + 6) as u32;
            let size = i64_at(b, h + 8);
            let data = i64_at(b, h + 16);
            if size <= 0 || data < 0 {
                textures.push(Texture::External(name(name_index as i64)));
                continue;
            }
            let at = check(data, size as usize)?;
            textures.push(Texture::Inline(decode(format, w, hgt, &b[at..at + size as usize])?));
        }

        struct Vb {
            format: u32,
            count: usize,
            at: usize,
        }
        let mut vbufs = Vec::with_capacity(n_vb);
        for i in 0..n_vb {
            let h = check(o_vb, (i + 1) * 24)? + i * 24;
            let size = i64_at(b, h + 8) as usize;
            vbufs.push(Vb { format: u32_at(b, h), count: u32_at(b, h + 4) as usize, at: check(i64_at(b, h + 16), size)? });
        }
        let mut ibufs = Vec::with_capacity(n_ib);
        for i in 0..n_ib {
            let h = check(o_ib, (i + 1) * 24)? + i * 24;
            let wide = b[h] == 1;
            let n = u32_at(b, h + 4) as usize;
            let size = i64_at(b, h + 8) as usize;
            let at = check(i64_at(b, h + 16), size)?;
            let idx: Vec<u32> = (0..n)
                .map(|k| if wide { u32_at(b, at + k * 4) } else { u16_at(b, at + k * 2) as u32 })
                .collect();
            ibufs.push(idx);
        }

        let mut materials = Vec::with_capacity(n_mat);
        for i in 0..n_mat {
            let h = check(o_mat, (i + 1) * 32)? + i * 32;
            let shader = name(u16_at(b, h) as i64);
            let n = u16_at(b, h + 4) as usize;
            let mut tex = Vec::new();
            if n > 0 {
                let at = check(i64_at(b, h + 16), n * 4)?;
                for k in 0..n {
                    tex.push((name(u16_at(b, at + k * 4) as i64), u16_at(b, at + k * 4 + 2) as usize));
                }
            }
            materials.push(Material { shader, textures: tex });
        }

        let mut meshes = Vec::with_capacity(n_mesh);
        for i in 0..n_mesh {
            let h = check(o_mesh, (i + 1) * 16)? + i * 16;
            let vb = vbufs.get(u16_at(b, h) as usize).ok_or("нет вершинного буфера")?;
            let ib = ibufs.get(u16_at(b, h + 2) as usize).ok_or("нет индексного буфера")?;
            let n_groups = u16_at(b, h + 4) as usize;
            let at = check(i64_at(b, h + 8), n_groups * 16)?;
            let mut mesh = Mesh { indices: ib.clone(), ..Default::default() };
            for k in 0..n_groups {
                let g = at + k * 16;
                if b[g + 12] != 2 {
                    continue; // только треугольники
                }
                mesh.groups.push(Group {
                    material: u16_at(b, g + 2) as usize,
                    first_index: u32_at(b, g + 4),
                    count: u32_at(b, g + 8) * 3,
                });
            }
            // Смещения нормали и первой UV по формату вершины.
            let (stride, normal, uv) = match vb.format {
                0 => (12, None, None),
                5 => (32, Some(12), Some(24)),
                6 => (36, Some(12), Some(28)),
                7 => (44, Some(12), Some(28)),
                8 => (40, Some(20), Some(32)),
                10 => (64, Some(12), Some(48)),
                f => return Err(format!("формат вершин {f} не поддержан")),
            };
            check(vb.at as i64, vb.count * stride)?;
            for k in 0..vb.count {
                let v = vb.at + k * stride;
                let f3 = |o: usize| [f32_at(b, v + o), f32_at(b, v + o + 4), f32_at(b, v + o + 8)];
                mesh.positions.push(f3(0));
                mesh.normals.push(normal.map_or([0.0, 0.0, 1.0], f3));
                mesh.uvs.push(uv.map_or([0.0, 0.0], |o| [f32_at(b, v + o), f32_at(b, v + o + 4)]));
            }
            meshes.push(mesh);
        }
        Ok(Papa { strings, textures, materials, meshes })
    }

    /// Первое изображение файла; для ссылки читает целевой файл от `media`.
    pub fn first_image(&self, media: &crate::vfs::Media) -> Option<Image> {
        match self.textures.first()? {
            Texture::Inline(img) => Some(img.clone()),
            Texture::External(p) => read_image(media, p).ok(),
        }
    }

    /// Путь текстуры параметра материала, например `DiffuseTexture`.
    pub fn material_texture(&self, material: usize, param: &str) -> Option<&str> {
        let m = self.materials.get(material)?;
        let (_, ti) = m.textures.iter().find(|(n, _)| n == param)?;
        match self.textures.get(*ti)? {
            Texture::External(p) => Some(p),
            Texture::Inline(_) => None,
        }
    }
}

/// Читает изображение по пути игры (`/pa/...papa`).
pub fn read_image(media: &crate::vfs::Media, spec: &str) -> Result<Image, String> {
    let papa = Papa::parse(&media.read(spec)?)?;
    match papa.textures.into_iter().next() {
        Some(Texture::Inline(img)) => Ok(img),
        Some(Texture::External(p)) if p != spec => read_image(media, &p),
        _ => Err(format!("{spec}: нет изображения")),
    }
}

fn rgb565(c: u16) -> [u8; 3] {
    let r = ((c >> 11) & 31) as u32;
    let g = ((c >> 5) & 63) as u32;
    let b = (c & 31) as u32;
    [((r * 527 + 23) >> 6) as u8, ((g * 259 + 33) >> 6) as u8, ((b * 527 + 23) >> 6) as u8]
}

fn color_block(blk: &[u8], dxt1: bool) -> [[u8; 4]; 4] {
    let c0 = u16_at(blk, 0);
    let c1 = u16_at(blk, 2);
    let (a, b) = (rgb565(c0), rgb565(c1));
    let mix = |wa: u32, wb: u32, d: u32| -> [u8; 4] {
        [
            ((a[0] as u32 * wa + b[0] as u32 * wb) / d) as u8,
            ((a[1] as u32 * wa + b[1] as u32 * wb) / d) as u8,
            ((a[2] as u32 * wa + b[2] as u32 * wb) / d) as u8,
            255,
        ]
    };
    let p0 = [a[0], a[1], a[2], 255];
    let p1 = [b[0], b[1], b[2], 255];
    if c0 > c1 || !dxt1 {
        [p0, p1, mix(2, 1, 3), mix(1, 2, 3)]
    } else {
        [p0, p1, mix(1, 1, 2), [0, 0, 0, 0]]
    }
}

/// Декодирует первый уровень мипмапа в RGBA8.
pub fn decode(format: u8, w: u32, h: u32, data: &[u8]) -> Result<Image, String> {
    let (wu, hu) = (w as usize, h as usize);
    let mut rgba = vec![0u8; wu * hu * 4];
    match format {
        1 | 2 | 3 => {
            let n = wu * hu * 4;
            if data.len() < n {
                return Err("короткие данные текстуры".into());
            }
            rgba.copy_from_slice(&data[..n]);
            for px in rgba.chunks_exact_mut(4) {
                if format == 3 {
                    px.swap(0, 2);
                }
                if format == 2 {
                    px[3] = 255;
                }
            }
        }
        13 => {
            if data.len() < wu * hu {
                return Err("короткие данные текстуры".into());
            }
            for (i, v) in data[..wu * hu].iter().enumerate() {
                rgba[i * 4..i * 4 + 4].copy_from_slice(&[*v, *v, *v, 255]);
            }
        }
        4 | 6 => {
            let bs = if format == 4 { 8 } else { 16 };
            let (bw, bh) = (wu.div_ceil(4), hu.div_ceil(4));
            if data.len() < bw * bh * bs {
                return Err("короткие данные текстуры".into());
            }
            for by in 0..bh {
                for bx in 0..bw {
                    let blk = &data[(by * bw + bx) * bs..][..bs];
                    let (alpha, col) = if format == 6 { (Some(&blk[..8]), &blk[8..]) } else { (None, blk) };
                    let pal = color_block(col, format == 4);
                    let bits = u32_at(col, 4);
                    let amap = alpha.map(|a| {
                        let (a0, a1) = (a[0] as u32, a[1] as u32);
                        let mut m = [a0, a1, 0, 0, 0, 0, 0, 0];
                        if a0 > a1 {
                            for j in 1..7 {
                                m[j + 1] = ((7 - j as u32) * a0 + j as u32 * a1) / 7;
                            }
                        } else {
                            for j in 1..5 {
                                m[j + 1] = ((5 - j as u32) * a0 + j as u32 * a1) / 5;
                            }
                            m[6] = 0;
                            m[7] = 255;
                        }
                        let mut ab = 0u64;
                        for i in 0..6 {
                            ab |= (a[2 + i] as u64) << (8 * i);
                        }
                        (m, ab)
                    });
                    for yy in 0..4 {
                        for xx in 0..4 {
                            let (x, y) = (bx * 4 + xx, by * 4 + yy);
                            if x >= wu || y >= hu {
                                continue;
                            }
                            let k = yy * 4 + xx;
                            let mut px = pal[((bits >> (2 * k)) & 3) as usize];
                            if let Some((m, ab)) = amap {
                                px[3] = m[((ab >> (3 * k)) & 7) as usize] as u8;
                            }
                            rgba[(y * wu + x) * 4..][..4].copy_from_slice(&px);
                        }
                    }
                }
            }
        }
        f => return Err(format!("формат текстуры {f} не поддержан")),
    }
    Ok(Image { width: w, height: h, rgba })
}

impl Image {
    /// Уменьшает изображение вдвое, пока сторона больше `max`.
    pub fn downscale_to(mut self, max: u32) -> Image {
        while self.width > max || self.height > max {
            let (w, h) = ((self.width / 2).max(1), (self.height / 2).max(1));
            let mut out = vec![0u8; (w * h * 4) as usize];
            for y in 0..h {
                for x in 0..w {
                    for c in 0..4 {
                        let mut s = 0u32;
                        for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                            let sx = (x * 2 + dx).min(self.width - 1);
                            let sy = (y * 2 + dy).min(self.height - 1);
                            s += self.rgba[((sy * self.width + sx) * 4 + c) as usize] as u32;
                        }
                        out[((y * w + x) * 4 + c) as usize] = (s / 4) as u8;
                    }
                }
            }
            self = Image { width: w, height: h, rgba: out };
        }
        self
    }

    /// Средний цвет, 0..1.
    pub fn mean(&self) -> [f32; 3] {
        let mut s = [0f64; 3];
        for px in self.rgba.chunks_exact(4) {
            for c in 0..3 {
                s[c] += px[c] as f64;
            }
        }
        let n = (self.rgba.len() / 4).max(1) as f64 * 255.0;
        [(s[0] / n) as f32, (s[1] / n) as f32, (s[2] / n) as f32]
    }
}
