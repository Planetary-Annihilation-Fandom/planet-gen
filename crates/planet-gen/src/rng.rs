//! `zu::Random`: xorshift32 с умножением сида, как в сервере PA.

#[derive(Clone, Copy, Debug)]
pub struct Random {
    pub state: u32,
}

impl Random {
    pub const SEED_MUL: u32 = 0x92D6_8CA2;

    pub fn new(seed: u32) -> Self {
        let state = if seed == 0 { 1 } else { seed.wrapping_mul(Self::SEED_MUL) };
        Self { state }
    }

    pub fn rand32(&mut self) -> u32 {
        let mut s = self.state;
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        self.state = s;
        s
    }

    /// Число в [0, 1): 23 младших бита как мантисса.
    pub fn float(&mut self) -> f32 {
        let u = self.rand32();
        f32::from_bits((u & 0x7f_ffff) | 0x3f80_0000) - 1.0
    }

    /// Равномерное направление на сфере (метод Марсальи).
    pub fn on_sphere(&mut self) -> [f32; 3] {
        loop {
            let v1 = self.float() * 2.0 - 1.0;
            let v2 = self.float() * 2.0 - 1.0;
            let s = v1 * v1 + v2 * v2;
            if s <= 1.0 {
                let k = (1.0 - s).sqrt();
                return [2.0 * v1 * k, 2.0 * v2 * k, 1.0 - 2.0 * s];
            }
        }
    }
}

/// `SimplexSampleSpec::makeSeed`: смещение по четвёртой координате шума.
pub fn make_seed(seed: u32, k: f32) -> f32 {
    let mut r = Random::new(seed);
    let f = r.float();
    ((f + f) - 1.0) * k * 10.0
}
