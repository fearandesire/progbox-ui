/**
 * Seeded replacement for Math.random. BBGM and NET both call the global
 * Math.random, so every run gets its own deterministic stream.
 */

/** splitmix32: spreads one integer seed into well-mixed state words. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** sfc32 generator returning floats in [0, 1). */
export function createRng(seed: number): () => number {
  const mix = splitmix32(seed);
  let a = mix();
  let b = mix();
  let c = mix();
  let d = mix();
  return () => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
}

/** Stable per-run seed from the run's base seed and index. */
export function runSeed(baseSeed: number, run: number): number {
  return splitmix32(Math.imul(baseSeed >>> 0, 2654435761) ^ run)();
}

/** A Math object whose random() draws from the given generator. */
export function seededMath(random: () => number): Math {
  const math = Object.create(Math) as Math & { random: () => number };
  math.random = random;
  return math;
}
