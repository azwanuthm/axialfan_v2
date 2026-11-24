import opencascade from 'replicad-opencascadejs/src/replicad_single.js';
import opencascadeWasm from 'replicad-opencascadejs/src/replicad_single.wasm?url';
import { setOC, draw, Plane, makeCylinder } from 'replicad';
import { c4Surfaces, transformSectionPoint, getStationAero, lerp, clamp } from './fanMath.js';

let ocLoaded = false;

async function initCAD() {
  if (ocLoaded) return;
  const OC = await opencascade({
    locateFile: () => opencascadeWasm
  });
  setOC(OC);
  ocLoaded = true;
}

function drawSmoothCurve(pen, pts) {
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];

    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    pen.cubicBezierCurveTo(p2, c1, c2);
  }
}

function buildBladeSolid(v, rootEmbed = 0) {
  const stations = 12;
  const sketches = [];
  const sList = [];

  // Panjangkan pangkal sedikit ke dalam hab untuk cantuman Boolean yang kukuh
  if (rootEmbed > 0) {
    sList.push({ s: 0, yPos: v.Hub - rootEmbed });
  }
  for (let j = 0; j < stations; j++) {
    const s = j / (stations - 1);
    sList.push({ s, yPos: v.Hub + s * v.Span });
  }
  // Panjangkan sedikit melepasi R_tip supaya Concentric Tip Trim memotong dengan bersih
  if (v.TipTrim) {
    sList.push({ s: 1.06, yPos: v.Hub + 1.06 * v.Span });
  }

  for (const { s, yPos } of sList) {
    const sClamped = clamp(s, 0, 1);
    const thick = lerp(v.RootThick, v.TipThick, sClamped);
    const camber = lerp(v.RootCamber, v.TipCamber, sClamped);
    const chord = v.Root * (1 + (v.Taper - 1) * Math.pow(sClamped, 1.5));

    const { upper, lower } = c4Surfaces(camber, thick, chord, v.TEMin, 18);

    // Pada Plane(origin, xDir=[1,0,0], normal=[0,1,0]), paksi Y lokal ialah -Z global
    const upperPts = upper.map((p) => {
      const q = transformSectionPoint(p, s, v);
      return [q.x, -q.z];
    });
    const lowerPts = lower
      .slice()
      .reverse()
      .map((p) => {
        const q = transformSectionPoint(p, s, v);
        return [q.x, -q.z];
      });

    const pen = draw(upperPts[0]);
    drawSmoothCurve(pen, upperPts);
    pen.lineTo(lowerPts[0]); // Tutup hujung trailing edge (ketebalan minimum DFM)
    drawSmoothCurve(pen, lowerPts);
    const drawing = pen.close();

    const plane = new Plane([0, yPos, 0], [1, 0, 0], [0, 1, 0]);
    sketches.push(drawing.sketchOnPlane(plane));
  }

  let blade = sketches[0].loftWith(sketches.slice(1));

  // Potongan hujung sepusat (Concentric Tip Trimming)
  if (v.TipTrim) {
    const rTip = v.Hub + v.Span;
    const trimDepth = Math.max(400, (v.Root * v.Taper + Math.abs(v.AxialLean)) * 4);
    const trimCyl = makeCylinder(rTip, trimDepth, [0, 0, -trimDepth / 2], [0, 0, 1]);
    blade = blade.intersect(trimCyl);
  }

  return blade;
}

function buildEllipsoidSpinner(radius, length, zBase) {
  // Lengkung suku elips menggunakan Cubic Bezier (pemalar k = 0.55228)
  const k = 0.55228;
  const profile = draw([0, 0])
    .lineTo([radius, 0])
    .cubicBezierCurveTo([0, length], [radius, length * k], [radius * k, length])
    .close();

  return profile.sketchOnPlane('XZ').revolve([0, 0, 1]).translate([0, 0, zBase]);
}

function buildRotorSolid(v) {
  const hubDepth = Math.max(30, v.Root * 1.25);
  const rootEmbed = Math.min(8, v.Hub * 0.25);
  const spinnerLen = v.Hub * v.SpinnerRatio;

  self.postMessage({ type: 'progress', message: 'Membina bilah (NURBS Loft & Tip Trim)...' });
  const masterBlade = buildBladeSolid(v, rootEmbed);

  self.postMessage({ type: 'progress', message: 'Membina hab & spinner elipsoid...' });
  const hub = makeCylinder(v.Hub, hubDepth, [0, 0, -hubDepth / 2], [0, 0, 1]);
  const spinner = buildEllipsoidSpinner(v.Hub, spinnerLen, hubDepth / 2);
  let rotor = hub.fuse(spinner);

  for (let i = 0; i < v.Blades; i++) {
    self.postMessage({ type: 'progress', message: `Mencantum bilah ${i + 1} / ${v.Blades}...` });
    const angleDeg = (360 * i) / v.Blades;
    const rotated = masterBlade.clone().rotate(angleDeg, [0, 0, 0], [0, 0, 1]);
    rotor = rotor.fuse(rotated);
  }

  // Tebuk lubang aci (Shaft Bore) dari belakang hab (blind bore)
  if (v.ShaftBore > 0 && v.ShaftBore < v.Hub * 1.6) {
    self.postMessage({ type: 'progress', message: 'Menebuk lubang aci (Shaft Bore)...' });
    const boreDepth = hubDepth * 0.85;
    const bore = makeCylinder(v.ShaftBore / 2, boreDepth + 5, [0, 0, -hubDepth / 2 - 5], [0, 0, 1]);
    rotor = rotor.cut(bore);
  }

  return rotor;
}

self.onmessage = async (e) => {
  const { mode, params } = e.data;
  try {
    self.postMessage({ type: 'progress', message: 'Memuatkan OpenCascade WASM...' });
    await initCAD();

    let shape;
    if (mode === 'blade') {
      self.postMessage({ type: 'progress', message: 'Membina pepejal satu bilah...' });
      shape = buildBladeSolid(params, 0);
    } else {
      shape = buildRotorSolid(params);
    }

    self.postMessage({ type: 'progress', message: 'Mengeksport fail .STEP...' });
    const blob = shape.blobSTEP();
    const buffer = await blob.arrayBuffer();
    self.postMessage({ type: 'done', buffer }, [buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || String(err) });
  }
};
