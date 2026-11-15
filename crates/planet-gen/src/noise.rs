//! 4D симплекс-шум `zu::simplexRawNoise` и октавная сумма `zu::simplexScaledNoise`.
//! Порядок операций повторяет сервер, чтобы результаты совпадали побитно.

use crate::tables::{GRAD4, PERM, SIMPLEX};

#[inline]
fn fast_floor(x: f32) -> i32 {
    let i = x as i32;
    // В игре единица вычитается и при x == 0.
    if x <= 0.0 { i - 1 } else { i }
}

#[inline]
fn perm(i: u32) -> u32 {
    PERM[i as usize] as u32
}

#[inline]
fn corner(t: f32, g: usize, x: f32, y: f32, z: f32, w: f32) -> f32 {
    if t < 0.0 {
        return 0.0;
    }
    let gr = GRAD4[g];
    (gr[1] as f32 * y + gr[0] as f32 * x + gr[2] as f32 * z + gr[3] as f32 * w) * t * t * t * t
}

pub fn simplex_raw(x: f32, y: f32, z: f32, w: f32) -> f32 {
    let sqrt5 = 5.0f32.sqrt();
    let g4 = (5.0 - sqrt5) / 20.0;
    let s = (x + y + z + w) * (sqrt5 - 1.0) * 0.25;
    let i = fast_floor(s + x);
    let j = fast_floor(s + y);
    let k = fast_floor(s + z);
    let l = fast_floor(s + w);
    let t = (l.wrapping_add(k).wrapping_add(j).wrapping_add(i)) as f32 * g4;
    let x0 = x - (i as f32 - t);
    let y0 = y - (j as f32 - t);
    let z0 = z - (k as f32 - t);
    let w0 = w - (l as f32 - t);

    let c = (if x0 > y0 { 32 } else { 0 })
        + (if x0 > z0 { 16 } else { 0 })
        + (if y0 > z0 { 8 } else { 0 })
        + (if x0 > w0 { 4 } else { 0 })
        + (if y0 > w0 { 2 } else { 0 })
        + (if z0 > w0 { 1 } else { 0 });
    let sc = SIMPLEX[c];
    let off = |lvl: i32| -> [u32; 4] {
        [(sc[0] > lvl) as u32, (sc[1] > lvl) as u32, (sc[2] > lvl) as u32, (sc[3] > lvl) as u32]
    };
    let o1 = off(2);
    let o2 = off(1);
    let o3 = off(0);

    let x1 = (x0 - o1[0] as f32) + g4;
    let y1 = (y0 - o1[1] as f32) + g4;
    let z1 = (z0 - o1[2] as f32) + g4;
    let w1 = (w0 - o1[3] as f32) + g4;
    let g42 = g4 + g4;
    let x2 = (x0 - o2[0] as f32) + g42;
    let y2 = (y0 - o2[1] as f32) + g42;
    let z2 = (z0 - o2[2] as f32) + g42;
    let w2 = (w0 - o2[3] as f32) + g42;
    let g43 = g4 * 3.0;
    let g44 = g4 * 4.0;
    let x3 = (x0 - o3[0] as f32) + g43;
    let y3 = (y0 - o3[1] as f32) + g43;
    let z3 = (z0 - o3[2] as f32) + g43;
    let w3 = (w0 - o3[3] as f32) + g43;
    let x4 = (x0 - 1.0) + g44;
    let y4 = (y0 - 1.0) + g44;
    let z4 = (z0 - 1.0) + g44;
    let w4 = (w0 - 1.0) + g44;

    let ii = (i as u32) & 0xff;
    let jj = (j as u32) & 0xff;
    let kk = (k as u32) & 0xff;
    let ll = (l as u32) & 0xff;
    let gi = |o: [u32; 4]| -> usize {
        (perm(ii + o[0] + perm(jj + o[1] + perm(kk + o[2] + perm(ll + o[3])))) & 31) as usize
    };
    let g0 = gi([0, 0, 0, 0]);
    let g1 = gi(o1);
    let g2 = gi(o2);
    let g3 = gi(o3);
    let g4i = gi([1, 1, 1, 1]);

    let t0 = (((0.6 - x0 * x0) - y0 * y0) - z0 * z0) - w0 * w0;
    let n0 = corner(t0, g0, x0, y0, z0, w0);
    let t1 = (((0.6 - x1 * x1) - y1 * y1) - z1 * z1) - w1 * w1;
    let n1 = corner(t1, g1, x1, y1, z1, w1);
    let t2 = (((0.6 - x2 * x2) - y2 * y2) - z2 * z2) - w2 * w2;
    let n2 = corner(t2, g2, x2, y2, z2, w2);
    let t3 = (((0.6 - x3 * x3) - y3 * y3) - z3 * z3) - w3 * w3;
    let n3 = corner(t3, g3, x3, y3, z3, w3);
    let t4 = (((0.6 - x4 * x4) - y4 * y4) - z4 * z4) - w4 * w4;
    let n4 = corner(t4, g4i, x4, y4, z4, w4);
    (n1 + n0 + n2 + n3 + n4) * 27.0
}

#[allow(clippy::too_many_arguments)]
pub fn simplex_scaled(
    octaves: f32,
    persistence: f32,
    mut scale: f32,
    lo: f32,
    hi: f32,
    x: f32,
    y: f32,
    z: f32,
    w: f32,
) -> f32 {
    let mut total = 0.0f32;
    let mut max_amp = 0.0f32;
    let mut amp = 1.0f32;
    let mut i = 0i32;
    if 0.0 < octaves {
        loop {
            let n = simplex_raw(scale * x, scale * y, scale * z, scale * w);
            max_amp += amp;
            i += 1;
            scale += scale;
            total += n * amp;
            amp *= persistence;
            if !((i as f32) < octaves) {
                break;
            }
        }
    }
    (total / max_amp) * (hi - lo) * 0.5 + (lo + hi) * 0.5
}
