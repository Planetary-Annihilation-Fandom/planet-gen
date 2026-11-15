//! Векторная математика в том виде, в каком её считает `zu`: нормализация с малым
//! добавком к длине, кватернионы и поворотные матрицы с исходным порядком операций.

pub type V3 = [f32; 3];
pub type D3 = [f64; 3];

pub const F32_EPS: f32 = f32::MIN_POSITIVE; // 0x00800000
pub const F64_EPS: f64 = f64::MIN_POSITIVE; // 0x0010000000000000

#[inline]
pub fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
#[inline]
pub fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
#[inline]
pub fn scale(a: V3, k: f32) -> V3 {
    [a[0] * k, a[1] * k, a[2] * k]
}
#[inline]
pub fn dot(a: V3, b: V3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
#[inline]
pub fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
#[inline]
pub fn length(a: V3) -> f32 {
    (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt()
}
#[inline]
pub fn normalize(a: V3) -> V3 {
    let k = 1.0 / (length(a) + F32_EPS);
    [a[0] * k, a[1] * k, a[2] * k]
}
#[inline]
pub fn normalize_d(a: D3) -> D3 {
    // Порядок слагаемых y, x, z как в generateSurface.
    let k = 1.0 / ((a[1] * a[1] + a[0] * a[0] + a[2] * a[2]).sqrt() + F64_EPS);
    [a[0] * k, a[1] * k, a[2] * k]
}

/// `zu::makeDir`: направление грани куба по номеру.
pub fn make_dir(i: i32) -> V3 {
    match i.rem_euclid(6) {
        0 => [1.0, 0.0, 0.0],
        1 => [-1.0, 0.0, 0.0],
        2 => [0.0, 1.0, 0.0],
        3 => [0.0, -1.0, 0.0],
        4 => [0.0, 0.0, 1.0],
        _ => [0.0, 0.0, -1.0],
    }
}

/// `zu::Mat3x3<double>::rotation(axis, angle)`.
pub fn rotation_d(axis: D3, angle: f64) -> [[f64; 3]; 3] {
    let c = angle.cos();
    let s = angle.sin();
    let t = 1.0 - c;
    let k = 1.0 / ((axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]).sqrt() + F64_EPS);
    let x = axis[0] * k;
    let y = axis[1] * k;
    let z = axis[2] * k;
    let xt = x * t;
    let yzt = y * t * z;
    [
        [x * xt + c, xt * y + z * s, z * xt - y * s],
        [xt * y - z * s, y * t * y + c, yzt + x * s],
        [z * xt + y * s, yzt - x * s, z * t * z + c],
    ]
}

/// Вектор-строка, умноженный на матрицу: `v * M`.
#[inline]
pub fn mul_row_d(v: D3, m: &[[f64; 3]; 3]) -> D3 {
    [
        v[0] * m[0][0] + v[1] * m[1][0] + v[2] * m[2][0],
        v[0] * m[0][1] + v[1] * m[1][1] + v[2] * m[2][1],
        v[0] * m[0][2] + v[1] * m[1][2] + v[2] * m[2][2],
    ]
}

#[derive(Clone, Copy, Debug)]
pub struct Quat {
    pub v: V3,
    pub s: f32,
}

impl Quat {
    pub const IDENTITY: Quat = Quat { v: [0.0, 0.0, 0.0], s: 1.0 };

    pub fn from_axis_angle(axis: V3, angle: f32) -> Quat {
        let h = angle * 0.5;
        if h.abs() < 1e-5 {
            return Quat::IDENTITY;
        }
        let sn = h.sin();
        let k = 1.0 / (length(axis) + F32_EPS);
        let cs = h.cos();
        Quat { v: [axis[0] * k * sn, axis[1] * k * sn, axis[2] * k * sn], s: cs }
    }

    /// Поворот одного единичного вектора в другой (половинный вектор).
    pub fn from_dir_to_dir(a: V3, b: V3) -> Quat {
        let mut hx = a[0] + b[0];
        let mut hy = a[1] + b[1];
        let hz0 = a[2] + b[2];
        let l2 = hy * hy + hx * hx + hz0 * hz0;
        let hz;
        if 1e-6 <= l2 {
            let k = 1.0 / (l2.sqrt() + F32_EPS);
            hx *= k;
            hy *= k;
            hz = k * hz0;
        } else {
            hz = 0.0;
            if 0.6 <= a[0] {
                hx = 0.0;
                hy = 1.0;
            } else {
                hx = 1.0;
                hy = 0.0;
            }
        }
        Quat {
            v: [a[1] * hz - a[2] * hy, a[2] * hx - a[0] * hz, a[0] * hy - a[1] * hx],
            s: a[1] * hy + a[0] * hx + a[2] * hz,
        }
    }

    pub fn from_vec_to_vec(a: V3, b: V3) -> Quat {
        let bn = normalize(b);
        let an = normalize(a);
        Quat::from_dir_to_dir(an, bn)
    }

    /// `zu::operator*(q1, q2)`.
    pub fn mul(self, o: Quat) -> Quat {
        let [x1, y1, z1] = self.v;
        let s1 = self.s;
        let [x2, y2, z2] = o.v;
        let s2 = o.s;
        Quat {
            v: [
                x2 * s1 + x1 * s2 + (z2 * y1 - z1 * y2),
                y2 * s1 + y1 * s2 + (z1 * x2 - z2 * x1),
                z2 * s1 + z1 * s2 + (x1 * y2 - x2 * y1),
            ],
            s: s2 * s1 - (x2 * x1 + y2 * y1 + z2 * z1),
        }
    }

    /// `Quat::asRotationMatrix`; векторы поворачиваются как строка: `v * M`.
    pub fn matrix(self) -> [[f32; 3]; 3] {
        let s = self.s;
        let [x, y, z] = self.v;
        let z2 = z + z;
        let y2 = y + y;
        let sx2 = s * (x + x);
        let xx2 = x * (x + x);
        [
            [1.0 - (z * z2 + y * y2), x * y2 + s * z2, x * z2 - s * y2],
            [x * y2 - s * z2, 1.0 - (z * z2 + xx2), y * z2 + sx2],
            [x * z2 + s * y2, y * z2 - sx2, 1.0 - (y * y2 + xx2)],
        ]
    }
}

#[inline]
pub fn mul_row(v: V3, m: &[[f32; 3]; 3]) -> V3 {
    [
        v[1] * m[1][0] + v[0] * m[0][0] + v[2] * m[2][0],
        v[1] * m[1][1] + v[0] * m[0][1] + v[2] * m[2][1],
        v[1] * m[1][2] + v[0] * m[0][2] + v[2] * m[2][2],
    ]
}

/// `zu::math::calcGoldenSpiralDir`.
pub fn golden_spiral_dir(i: i32, step: f32) -> V3 {
    let golden = ((3.0 - 5.0f64.sqrt()) * (std::f32::consts::PI as f64)) as f32;
    let y = ((i as f32) * step - 1.0) + step * 0.5;
    let r = (1.0 - y * y).sqrt();
    let a = (i as f32) * golden;
    let x = a.cos() * r;
    let z = a.sin() * r;
    let k = 1.0 / ((x * x + y * y + z * z).sqrt() + F32_EPS);
    [k * x, k * y, k * z]
}
