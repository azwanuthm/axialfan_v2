export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// Kira sudut aliran relatif (beta) dan sudut bilah (twist) pada kedudukan s (0..1)
export function getStationAero(s, v) {
  const sClamped = clamp(s, 0, 1);
  const rMm = v.Hub + s * v.Span;
  const rM = Math.max(0.005, rMm / 1000);
  const omega = (2 * Math.PI * v.RPM) / 60;
  const U = omega * rM; // Halaju tangen (m/s)
  const Vz = v.Wind;    // Halaju paksi (m/s)
  const W = Math.hypot(U, Vz);

  // Sudut aliran relatif dari satah putaran (darjah)
  const flowAngleDeg = U > 0.01 ? (Math.atan2(Vz, U) * 180) / Math.PI : 45;

  let twistDeg;
  if (v.AutoTwist) {
    // Free Vortex: sudut aliran + sudut serangan optimum (AoA)
    twistDeg = clamp(flowAngleDeg + v.AoA, 5, 75);
  } else {
    twistDeg = lerp(v.RootTwist, v.TipTwist, sClamped);
  }

  const actualAoA = twistDeg - flowAngleDeg;
  return { rMm, U, Vz, W, flowAngleDeg, twistDeg, actualAoA };
}

// Jana koordinat permukaan atas & bawah profil C4 dengan ketebalan minimum Trailing Edge
export function c4Surfaces(camberPct, thicknessPct, chordMm, teMinMm, count = 24) {
  const h = camberPct / 100;
  const t = thicknessPct / 100;
  const teHalfNorm = chordMm > 0 ? teMinMm / (2 * chordMm) : 0;
  const upper = [];
  const lower = [];

  for (let i = 0; i <= count; i++) {
    const beta = (i * Math.PI) / count;
    const x = (1 - Math.cos(beta)) / 2;
    let yc = 0;
    let slope = 0;

    if (h > 0) {
      const R = 1 / (8 * h) + h / 2;
      const yCenter = h - R;
      const underSqrt = Math.max(0, R * R - Math.pow(x - 0.5, 2));
      yc = Math.sqrt(underSqrt) + yCenter;
      slope = -(x - 0.5) / Math.sqrt(Math.max(0.0001, underSqrt));
    }

    const ytBase =
      5 *
      t *
      (0.2969 * Math.sqrt(x) -
        0.126 * x -
        0.3516 * Math.pow(x, 2) +
        0.2843 * Math.pow(x, 3) -
        0.1015 * Math.pow(x, 4));

    // Tambah ketebalan minimum trailing edge secara linear ke hujung x = 1
    const yt = ytBase + x * teHalfNorm;
    const th = Math.atan(slope);

    upper.push({ x: x - yt * Math.sin(th), y: yc + yt * Math.cos(th) });
    lower.push({ x: x + yt * Math.sin(th), y: yc - yt * Math.cos(th) });
  }
  return { upper, lower };
}

// Transformasi titik profil 2D kepada koordinat 3D (xr, yPos, zr)
export function transformSectionPoint(p, s, v) {
  const sClamped = clamp(s, 0, 1);
  const chordFactor = 1 + (v.Taper - 1) * Math.pow(sClamped, 1.5);
  const chord = v.Root * chordFactor;
  const { twistDeg } = getStationAero(s, v);

  const sweepOffset = -v.Sweep * (2 * Math.pow(sClamped, 3) - sClamped);
  const leanOffset = v.AxialLean * Math.pow(sClamped, 1.5);

  const pitchAxis = 0.45;
  const x = (p.x - pitchAxis) * chord;
  const z = p.y * chord;
  const a = -(twistDeg * Math.PI) / 180;

  const xr = x * Math.cos(a) - z * Math.sin(a) + sweepOffset;
  const zr = x * Math.sin(a) + z * Math.cos(a) + leanOffset;
  const y = v.Hub + s * v.Span;

  return { x: xr, y, z: zr, chord };
}
