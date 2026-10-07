/**
 * 胸骨圧迫リズム判定コア（cpr-rhythm core） v0.1.0
 *
 * 画面もカメラも触らない、計算だけのまとまり。外部ライブラリに依存しない。
 * 各部品の説明は、隣の cpr-rhythm-core.d.ts に入っている。
 * 計算の中身まで読むなら、コメント付きの TypeScript が 3-full-source/ の ZIP にある。
 */
class MotionSignal {
  constructor(width, height, opts = {}) {
    this.width = width;
    this.n = width * height;
    this.diffThreshold = opts.diffThreshold ?? 8;
    this.gradThreshold = opts.gradThreshold ?? 4;
    this.leakTauSec = opts.leakTauSec ?? 1.2;
    this.livThreshold = opts.livThreshold ?? 20;
    this.luma = new Float32Array(this.n);
    this.prevLuma = new Float32Array(this.n);
  }
  n;
  diffThreshold;
  gradThreshold;
  leakTauSec;
  livThreshold;
  luma;
  prevLuma;
  hasPrev = false;
  wave = 0;
  lastT = 0;
  reset() {
    this.hasPrev = false;
    this.wave = 0;
    this.lastT = 0;
    this.luma.fill(0);
    this.prevLuma.fill(0);
  }
  /**
   * @param rgba canvas から取り出した RGBA 画素列
   * @param t performance.now() のミリ秒
   */
  push(rgba, t) {
    const { width: w, n } = this;
    const luma = this.luma;
    const prev = this.prevLuma;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      luma[i] = rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114;
    }
    if (!this.hasPrev) {
      this.swapBuffers();
      this.hasPrev = true;
      this.lastT = t;
      return { t, raw: 0, wave: 0, energy: 0, livSum: 0 };
    }
    let num = 0;
    let den = 0;
    let energy = 0;
    let livSum = 0;
    const rowEnd = n - w;
    for (let i = w; i < rowEnd; i++) {
      const it = luma[i] - prev[i];
      const a = it < 0 ? -it : it;
      if (a <= this.diffThreshold) continue;
      energy += a;
      if (a > this.livThreshold) livSum += it;
      const iy = (luma[i + w] - luma[i - w]) * 0.5;
      if (iy > -this.gradThreshold && iy < this.gradThreshold) continue;
      num += it * iy;
      den += iy * iy;
    }
    this.swapBuffers();
    const dt = Math.max(1, t - this.lastT) / 1e3;
    this.lastT = t;
    const vyPerFrame = den > 1e-6 ? -num / den : 0;
    const raw = vyPerFrame / dt;
    const decay = Math.exp(-dt / this.leakTauSec);
    this.wave = this.wave * decay + raw * dt;
    return { t, raw, wave: this.wave, energy: energy / n, livSum: livSum / n };
  }
  swapBuffers() {
    const tmp = this.prevLuma;
    this.prevLuma = this.luma;
    this.luma = tmp;
  }
}
class BeatDetector {
  smoothTauSec;
  rmsTauSec;
  armFactor;
  minIntervalMs;
  minEnergy;
  smoothed = 0;
  prevSmoothed = 0;
  prevT = 0;
  hasPrev = false;
  msq = 0;
  energyAvg = 0;
  armed = false;
  lastBeatT = null;
  constructor(opts = {}) {
    this.smoothTauSec = opts.smoothTauSec ?? 0.045;
    this.rmsTauSec = opts.rmsTauSec ?? 2;
    this.armFactor = opts.armFactor ?? 0.5;
    this.minIntervalMs = opts.minIntervalMs ?? 250;
    this.minEnergy = opts.minEnergy ?? 0.6;
  }
  reset() {
    this.smoothed = 0;
    this.prevSmoothed = 0;
    this.hasPrev = false;
    this.msq = 0;
    this.energyAvg = 0;
    this.armed = false;
    this.lastBeatT = null;
  }
  /** いま使っているしきい値。画面に出して調整するために公開する */
  get threshold() {
    return this.armFactor * Math.sqrt(this.msq);
  }
  get smoothedValue() {
    return this.smoothed;
  }
  get energyLevel() {
    return this.energyAvg;
  }
  get motionPresent() {
    return this.energyAvg >= this.minEnergy;
  }
  push(sample) {
    const { t, raw, energy } = sample;
    if (!this.hasPrev) {
      this.prevT = t;
      this.hasPrev = true;
      this.smoothed = raw;
      this.prevSmoothed = raw;
      return null;
    }
    const dt = Math.max(1, t - this.prevT) / 1e3;
    const aSmooth = Math.exp(-dt / this.smoothTauSec);
    const aRms = Math.exp(-dt / this.rmsTauSec);
    this.prevSmoothed = this.smoothed;
    this.smoothed = this.smoothed * aSmooth + raw * (1 - aSmooth);
    this.msq = this.msq * aRms + this.smoothed * this.smoothed * (1 - aRms);
    this.energyAvg = this.energyAvg * aRms + energy * (1 - aRms);
    const prevT = this.prevT;
    this.prevT = t;
    if (!this.motionPresent) {
      this.armed = false;
      return null;
    }
    const th = this.threshold;
    if (this.smoothed < -th) this.armed = true;
    if (!this.armed) return null;
    if (!(this.prevSmoothed <= 0 && this.smoothed > 0)) return null;
    const span = this.smoothed - this.prevSmoothed;
    const frac = span === 0 ? 0 : -this.prevSmoothed / span;
    const t0 = prevT + (t - prevT) * Math.min(1, Math.max(0, frac));
    this.armed = false;
    if (this.lastBeatT !== null && t0 - this.lastBeatT < this.minIntervalMs) return null;
    const intervalMs = this.lastBeatT === null ? null : t0 - this.lastBeatT;
    this.lastBeatT = t0;
    return {
      t: t0,
      intervalMs,
      bpm: intervalMs === null ? null : 6e4 / intervalMs
    };
  }
}
function magnitudeSpectrum(input) {
  const n = input.length;
  if ((n & n - 1) !== 0) throw new Error(`FFT の長さは2のべき乗である必要があります: ${n}`);
  const re = Float64Array.from(input);
  const im = new Float64Array(n);
  transform(re, im);
  const half = n / 2;
  const mag = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) mag[k] = Math.hypot(re[k], im[k]);
  return mag;
}
function transform(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}
function hann(n) {
  const w = new Float64Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
  return w;
}
function parabolicPeakOffset(mag, k) {
  if (k <= 0 || k >= mag.length - 1) return 0;
  const denom = 2 * (2 * mag[k] - mag[k + 1] - mag[k - 1]);
  if (denom === 0) return 0;
  const off = (mag[k + 1] - mag[k - 1]) / denom;
  return Number.isFinite(off) && Math.abs(off) <= 1 ? off : 0;
}
const FAILED = (rejected) => ({
  bpm: null,
  sharpness: 0,
  rejected
});
function estimateTempo(samples, opts = {}) {
  const fftSize = opts.fftSize ?? 256;
  const minHz = opts.minHz ?? 0.55;
  const maxHz = opts.maxHz ?? 2.9;
  const minSharpness = opts.minSharpness ?? 1.4;
  const minSamples = opts.minSamples ?? 24;
  const minEnergy = opts.minEnergy ?? 0.6;
  const n = samples.length;
  if (n < minSamples) return FAILED("too-few-samples");
  const spanSec = (samples[n - 1].t - samples[0].t) / 1e3;
  if (spanSec <= 0) return FAILED("too-few-samples");
  let energySum = 0;
  for (const s of samples) energySum += s.energy;
  if (energySum / n < minEnergy) return FAILED("no-motion");
  const fs = (n - 1) / spanSec;
  if (!Number.isFinite(fs) || fs < 2 * maxHz) return FAILED("too-few-samples");
  let mean = 0;
  for (const s of samples) mean += s.raw;
  mean /= n;
  const win = hann(n);
  const buf = new Float64Array(fftSize);
  const take = Math.min(n, fftSize);
  const offset = n - take;
  for (let i = 0; i < take; i++) buf[i] = (samples[offset + i].raw - mean) * win[offset + i];
  const mag = magnitudeSpectrum(buf);
  const lo = Math.max(1, Math.floor(minHz * fftSize / fs));
  const hi = Math.min(mag.length - 2, Math.ceil(maxHz * fftSize / fs));
  if (hi <= lo) return FAILED("too-few-samples");
  const peaks = [];
  let best = -1;
  for (let k = lo; k <= hi; k++) {
    if (mag[k] > mag[k - 1] && mag[k] > mag[k + 1]) {
      peaks.push(k);
      if (best < 0 || mag[k] > mag[best]) best = k;
    }
  }
  if (best < 0) return FAILED("no-peak");
  let bandSum = 0;
  for (let k = lo; k <= hi; k++) bandSum += mag[k];
  const bandMean = bandSum / (hi - lo + 1);
  const sharpness = bandMean > 0 ? mag[best] / bandMean : 0;
  if (sharpness < minSharpness) return { bpm: null, sharpness, rejected: "not-distinct" };
  let chosen = best;
  const strong = peaks.filter((k) => mag[k] > mag[best] * 0.6).sort((a, b) => a - b);
  if (strong.length >= 2) {
    const [low, high] = strong;
    const ratio = high / low;
    const balance = mag[high] / mag[low];
    if (ratio > 1.7 && ratio < 2.3 && balance > 0.75 && balance < 1.5) chosen = low;
  }
  const freq = (chosen + parabolicPeakOffset(mag, chosen)) * fs / fftSize;
  const bpm = freq * 60;
  if (!Number.isFinite(bpm) || bpm <= 0) return FAILED("no-peak");
  return { bpm, sharpness, rejected: null };
}
function nearestOffset(beatT, clicks, maxAbsMs) {
  let best = null;
  for (const c of clicks) {
    const d = beatT - c;
    if (Math.abs(d) > maxAbsMs) continue;
    if (best === null || Math.abs(d) < Math.abs(best)) best = d;
  }
  return best;
}
function latencyStats(offsets) {
  const n = offsets.length;
  if (n === 0) return { count: 0, meanMs: 0, sdMs: 0, p90AbsMs: 0 };
  let sum = 0;
  for (const o of offsets) sum += o;
  const mean = sum / n;
  let sq = 0;
  for (const o of offsets) sq += (o - mean) ** 2;
  const sd = n > 1 ? Math.sqrt(sq / (n - 1)) : 0;
  const centered = offsets.map((o) => Math.abs(o - mean)).sort((a, b) => a - b);
  const idx = Math.min(centered.length - 1, Math.floor(centered.length * 0.9));
  return { count: n, meanMs: mean, sdMs: sd, p90AbsMs: centered[idx] };
}
function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
export {
  BeatDetector,
  MotionSignal,
  estimateTempo,
  hann,
  latencyStats,
  magnitudeSpectrum,
  median,
  nearestOffset,
  parabolicPeakOffset
};
