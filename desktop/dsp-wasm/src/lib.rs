const MAX_DELAY_SAMPLES: usize = 48000; // ~1 second at 48kHz

struct DelayLine {
    buffer: Vec<f32>,
    write_idx: usize,
    sample_rate: f32,
}

impl DelayLine {
    fn new(sample_rate: f32) -> Self {
        Self {
            buffer: vec![0.0; MAX_DELAY_SAMPLES],
            write_idx: 0,
            sample_rate,
        }
    }

    fn write(&mut self, sample: f32) {
        self.buffer[self.write_idx] = sample;
        self.write_idx = (self.write_idx + 1) % MAX_DELAY_SAMPLES;
    }

    fn read(&self, delay_ms: f32) -> f32 {
        // write() has already advanced write_idx, so the newest sample is at write_idx - 1.
        // (Before 1 Oct 2026 this read write_idx itself: a 0 ms delay returned the
        // sample from ~1 second ago.) No longer used by the app: spatializer-worklet.js
        // now runs the same DSP in JS. Kept correct for reference.
        let delay_samples = (delay_ms * self.sample_rate / 1000.0)
            .max(0.0)
            .min((MAX_DELAY_SAMPLES - 3) as f32);
        let read_idx_f = self.write_idx as f32 - 1.0 - delay_samples;
        
        let mut read_idx = read_idx_f.floor() as isize;
        let frac = read_idx_f - read_idx_f.floor();

        if read_idx < 0 {
            read_idx += MAX_DELAY_SAMPLES as isize;
        }
        
        let idx1 = read_idx as usize % MAX_DELAY_SAMPLES;
        let idx2 = (idx1 + 1) % MAX_DELAY_SAMPLES;
        
        // Linear interpolation
        self.buffer[idx1] * (1.0 - frac) + self.buffer[idx2] * frac
    }
}

struct OnePoleLpf {
    z1: f32,
    a0: f32,
    b1: f32,
}

impl OnePoleLpf {
    fn new(fc: f32, sample_rate: f32) -> Self {
        let mut filter = Self { z1: 0.0, a0: 0.0, b1: 0.0 };
        filter.set_cutoff(fc, sample_rate);
        filter
    }

    fn set_cutoff(&mut self, fc: f32, sample_rate: f32) {
        let b = (-2.0 * std::f32::consts::PI * fc / sample_rate).exp();
        self.b1 = b;
        self.a0 = 1.0 - b;
    }

    fn process(&mut self, sample: f32) -> f32 {
        self.z1 = sample * self.a0 + self.z1 * self.b1;
        self.z1
    }
}

pub struct Spatializer {
    sample_rate: f32,
    delay_l: DelayLine,
    delay_r: DelayLine,
    
    // ER taps
    tap1_l: DelayLine, tap1_r: DelayLine,
    tap2_l: DelayLine, tap2_r: DelayLine,
    tap3_l: DelayLine, tap3_r: DelayLine,
    
    // LPFs for ER taps (warmth)
    lpf1_l: OnePoleLpf, lpf1_r: OnePoleLpf,
    lpf2_l: OnePoleLpf, lpf2_r: OnePoleLpf,
    lpf3_l: OnePoleLpf, lpf3_r: OnePoleLpf,
}

impl Spatializer {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            delay_l: DelayLine::new(sample_rate),
            delay_r: DelayLine::new(sample_rate),
            tap1_l: DelayLine::new(sample_rate), tap1_r: DelayLine::new(sample_rate),
            tap2_l: DelayLine::new(sample_rate), tap2_r: DelayLine::new(sample_rate),
            tap3_l: DelayLine::new(sample_rate), tap3_r: DelayLine::new(sample_rate),
            lpf1_l: OnePoleLpf::new(4000.0, sample_rate), lpf1_r: OnePoleLpf::new(4000.0, sample_rate),
            lpf2_l: OnePoleLpf::new(3000.0, sample_rate), lpf2_r: OnePoleLpf::new(3000.0, sample_rate),
            lpf3_l: OnePoleLpf::new(2000.0, sample_rate), lpf3_r: OnePoleLpf::new(2000.0, sample_rate),
        }
    }

    pub fn process(
        &mut self,
        in_l: *const f32,
        in_r: *const f32,
        out_l: *mut f32,
        out_r: *mut f32,
        len: usize,
        x: f32, // 0.0 (L) to 1.0 (R)
        y: f32, // 0.0 (bottom) to 1.0 (top)
        z: f32, // 0.0 (near) to 100.0 (far)
        intensity: f32, // 0.0 (dry) to 1.0 (wet)
    ) {
        if intensity <= 0.001 {
            unsafe {
                std::ptr::copy_nonoverlapping(in_l, out_l, len);
                std::ptr::copy_nonoverlapping(in_r, out_r, len);
            }
            return;
        }

        let pan = (x - 0.5) * 2.0;
        
        let angle = (pan + 1.0) * std::f32::consts::FRAC_PI_4;
        let amp_l = angle.cos();
        let amp_r = angle.sin();
        
        let mut haas_delay_l = 0.0;
        let mut haas_delay_r = 0.0;
        if pan > 0.0 {
            haas_delay_l = pan * 20.0;
        } else if pan < 0.0 {
            haas_delay_r = -pan * 20.0;
        }

        let z_norm = (z / 50.0).clamp(0.0, 1.0);
        let er_lpf_cutoff = 5000.0 * (1.0 - z_norm * 0.8).max(0.1);
        self.lpf1_l.set_cutoff(er_lpf_cutoff, self.sample_rate);
        self.lpf1_r.set_cutoff(er_lpf_cutoff, self.sample_rate);
        self.lpf2_l.set_cutoff(er_lpf_cutoff * 0.8, self.sample_rate);
        self.lpf2_r.set_cutoff(er_lpf_cutoff * 0.8, self.sample_rate);
        self.lpf3_l.set_cutoff(er_lpf_cutoff * 0.6, self.sample_rate);
        self.lpf3_r.set_cutoff(er_lpf_cutoff * 0.6, self.sample_rate);

        let tap1_ms = 15.0 + z_norm * 10.0;
        let tap2_ms = 28.0 + z_norm * 20.0;
        let tap3_ms = 42.0 + z_norm * 35.0;

        let er_gain = 0.3 * intensity;

        for i in 0..len {
            unsafe {
                let dry_l = *in_l.add(i) * amp_l;
                let dry_r = *in_r.add(i) * amp_r;

                self.delay_l.write(dry_l);
                self.delay_r.write(dry_r);

                let haas_l = self.delay_l.read(haas_delay_l);
                let haas_r = self.delay_r.read(haas_delay_r);

                self.tap1_l.write(haas_l);
                self.tap1_r.write(haas_r);
                self.tap2_l.write(haas_l);
                self.tap2_r.write(haas_r);
                self.tap3_l.write(haas_l);
                self.tap3_r.write(haas_r);

                let mut er_l = 0.0;
                let mut er_r = 0.0;
                
                er_l += self.lpf1_l.process(self.tap1_l.read(tap1_ms));
                er_r += self.lpf1_r.process(self.tap1_r.read(tap1_ms));
                
                er_l += self.lpf2_l.process(self.tap2_l.read(tap2_ms));
                er_r += self.lpf2_r.process(self.tap2_r.read(tap2_ms));
                
                er_l += self.lpf3_l.process(self.tap3_l.read(tap3_ms));
                er_r += self.lpf3_r.process(self.tap3_r.read(tap3_ms));

                let wet_mix_l = haas_l + er_l * er_gain;
                let wet_mix_r = haas_r + er_r * er_gain;

                let mixed_l = dry_l * (1.0 - intensity) + wet_mix_l * intensity;
                let mixed_r = dry_r * (1.0 - intensity) + wet_mix_r * intensity;

                *out_l.add(i) = mixed_l;
                *out_r.add(i) = mixed_r;
            }
        }
    }
}

// Memory allocator for the JS side to allocate audio buffers
#[no_mangle]
pub extern "C" fn alloc(size: usize) -> *mut u8 {
    let mut buf = Vec::with_capacity(size);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: *mut u8, cap: usize) {
    unsafe {
        let _buf = Vec::from_raw_parts(ptr, 0, cap);
    }
}

// C API exports
#[no_mangle]
pub extern "C" fn spatializer_new(sample_rate: f32) -> *mut Spatializer {
    let s = Box::new(Spatializer::new(sample_rate));
    Box::into_raw(s)
}

#[no_mangle]
pub extern "C" fn spatializer_free(ptr: *mut Spatializer) {
    if !ptr.is_null() {
        unsafe {
            let _ = Box::from_raw(ptr);
        }
    }
}

#[no_mangle]
pub extern "C" fn spatializer_process(
    ptr: *mut Spatializer,
    in_l: *const f32,
    in_r: *const f32,
    out_l: *mut f32,
    out_r: *mut f32,
    len: usize,
    x: f32,
    y: f32,
    z: f32,
    intensity: f32,
) {
    let spatializer = unsafe {
        assert!(!ptr.is_null());
        &mut *ptr
    };
    
    spatializer.process(in_l, in_r, out_l, out_r, len, x, y, z, intensity);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zero_delay_returns_newest_sample() {
        let mut d = DelayLine::new(48000.0);
        d.write(0.25);
        assert!((d.read(0.0) - 0.25).abs() < 1e-6);
        for _ in 0..48 { d.write(0.0); }
        assert!((d.read(1.0) - 0.25).abs() < 1e-6); // 48 samples = 1 ms at 48 kHz
    }
}
