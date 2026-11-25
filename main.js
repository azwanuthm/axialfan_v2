import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { c4Surfaces, transformSectionPoint, getStationAero, getChord, lerp } from './fanMath.js';

const $ = (id) => document.getElementById(id);

// --- Persediaan Three.js ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef2f7);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 3000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
$('canvas-container').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Pencahayaan 3-Titik (Gaya CAD + Rim Light untuk memisahkan bilah bertindih)
scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 1.15));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.65);
keyLight.position.set(220, 380, 320);
keyLight.castShadow = true;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xe0f2fe, 0.75);
fillLight.position.set(-240, -120, 180);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 1.1);
rimLight.position.set(-180, 220, -320);
scene.add(rimLight);

scene.add(new THREE.GridHelper(700, 35, 0x94a3b8, 0xcbd5e1));

// Bahan Gaya CAD (Kelabu Cerah Satin supaya lekuk & twist jelas kelihatan)
const bladeMaterial = new THREE.MeshStandardMaterial({
  color: 0xcbd5e1,
  roughness: 0.42,
  metalness: 0.18,
  side: THREE.DoubleSide
});
const hubMaterial = new THREE.MeshStandardMaterial({
  color: 0x334155,
  roughness: 0.48,
  metalness: 0.2
});
const ductMaterial = new THREE.MeshStandardMaterial({
  color: 0x0284c7,
  transparent: true,
  opacity: 0.12,
  side: THREE.DoubleSide,
  roughness: 0.2
});
const ribMaterial = new THREE.LineBasicMaterial({ color: 0x0284c7 });

let rotorGroup = new THREE.Group();
let axisGroup = new THREE.Group();
let singleBladeGroup = new THREE.Group();
scene.add(rotorGroup, axisGroup);

const inputMap = {
  RPM: 'inpRPM', Wind: 'inpWind', AoA: 'inpAoA',
  RootTwist: 'inpRootTwist', TipTwist: 'inpTipTwist',
  Blades: 'inpBlades', Hub: 'inpHub', Span: 'inpSpan',
  Root: 'inpRoot', Taper: 'inpTaper', MidBulge: 'inpMidBulge',
  Sweep: 'inpSweep', RootCamber: 'inpRootCamber', TipCamber: 'inpTipCamber',
  RootThick: 'inpRootThick', TipThick: 'inpTipThick',
  AxialLean: 'inpAxialLean', TEMin: 'inpTEMin',
  ShaftBore: 'inpShaftBore', SpinnerRatio: 'inpSpinnerRatio'
};

// --- 4 Pratetap Aplikasi Sebenar ---
const PRESETS = {
  pc: {
    note: 'Kipas PC 120mm (Tekanan Statik): Hab rata (tanpa spinner), 7 bilah lebar di tengah (Mid-Bulge) dan melengkung sabit penuh (C-Curve) untuk menolak udara menembusi sirip heatsink/radiator.',
    values: { RPM: 1800, Wind: 3.5, AutoTwist: true, AoA: 4.5, Blades: 7, Hub: 20, Span: 38, Root: 20, Taper: 0.45, MidBulge: 0.65, Sweep: 22, SweepMode: 'c-curve', RootCamber: 10, TipCamber: 6, RootThick: 10, TipThick: 5, AxialLean: 2, TEMin: 0.8, ShaftBore: 6, SpinnerRatio: 0.0 }
  },
  radiator: {
    note: 'Kipas Radiator Automotif: Solidity tinggi, kord lebar dan sapuan sabit ke hadapan (Forward Sweep) untuk melawan rintangan tekanan tinggi serta mengurangkan hingar.',
    values: { RPM: 1800, Wind: 6.5, AutoTwist: true, AoA: 4.5, Blades: 9, Hub: 65, Span: 145, Root: 44, Taper: 1.55, MidBulge: 0.15, Sweep: 32, SweepMode: 's-curve', RootCamber: 10, TipCamber: 6, RootThick: 12, TipThick: 6, AxialLean: 10, TEMin: 1.2, ShaftBore: 20, SpinnerRatio: 1.0 }
  },
  hvac: {
    note: 'Kipas Terowong / HVAC Ducted: Nisbah hab-ke-hujung seimbang, spinner elipsoid, dan hujung dipotong sepusat bagi meminimumkan kebocoran aliran di dinding duct.',
    values: { RPM: 1450, Wind: 9.0, AutoTwist: true, AoA: 4.0, Blades: 7, Hub: 75, Span: 175, Root: 48, Taper: 1.20, MidBulge: 0.0, Sweep: 18, SweepMode: 's-curve', RootCamber: 8, TipCamber: 4, RootThick: 13, TipThick: 6, AxialLean: 6, TEMin: 1.4, ShaftBore: 28, SpinnerRatio: 1.4 }
  },
  cooling: {
    note: 'Kipas Aliran Bebas (Ekzos / Cooling): Bilah lebih ramping (solidity rendah) dan hab kecil untuk menggerakkan isipadu udara maksimum pada rintangan tekanan rendah.',
    values: { RPM: 1100, Wind: 4.5, AutoTwist: true, AoA: 3.5, Blades: 5, Hub: 45, Span: 185, Root: 38, Taper: 0.85, MidBulge: 0.0, Sweep: 10, SweepMode: 's-curve', RootCamber: 7, TipCamber: 3, RootThick: 11, TipThick: 5, AxialLean: 0, TEMin: 1.0, ShaftBore: 16, SpinnerRatio: 1.2 }
  }
};

function values() {
  const v = {};
  for (const [key, id] of Object.entries(inputMap)) v[key] = Number($(id).value);
  v.AutoTwist = $('chkAutoTwist').checked;
  v.TipTrim = $('chkTipTrim').checked;
  v.SweepMode = $('selSweepMode').value;
  return v;
}

function syncUIValues() {
  for (const [key, id] of Object.entries(inputMap)) {
    const decimals = ['Taper', 'MidBulge'].includes(key)
      ? 2
      : ['Wind', 'AoA', 'TEMin', 'SpinnerRatio'].includes(key)
      ? 1
      : 0;
    $(`val\${key}`).textContent = Number($(id).value).toFixed(decimals);
  }
  const auto = $('chkAutoTwist').checked;
  $('boxAoA').classList.toggle('hidden', !auto);
  $('boxManualTwist').classList.toggle('hidden', auto);
  $('badgeMode').textContent = auto ? 'FREE VORTEX' : 'MANUAL TWIST';
}

function clampToTipRadius(q, rTip, enabled) {
  if (!enabled) return q;
  const radial = Math.hypot(q.x, q.y);
  if (radial > rTip) {
    const scale = rTip / radial;
    return { ...q, x: q.x * scale, y: q.y * scale };
  }
  return q;
}

function buildBladeGeometry(v) {
  const stations = 20;
  const rTip = v.Hub + v.Span;
  const positions = [];
  const indices = [];
  const count = 40;
  const n = count * 2;

  for (let j = 0; j < stations; j++) {
    const s = j / (stations - 1);
    const thick = lerp(v.RootThick, v.TipThick, s);
    const camber = lerp(v.RootCamber, v.TipCamber, s);
    const chord = getChord(s, v);
    const { upper, lower } = c4Surfaces(camber, thick, chord, v.TEMin, count);
    const profile = [...upper.slice().reverse(), ...lower.slice(1)];

    for (const p of profile) {
      const q = clampToTipRadius(transformSectionPoint(p, s, v), rTip, v.TipTrim);
      positions.push(q.x, q.y, q.z);
    }
  }

  for (let j = 0; j < stations - 1; j++) {
    for (let i = 0; i < n; i++) {
      const ni = (i + 1) % n;
      const a = j * n + i, b = j * n + ni, c = (j + 1) * n + ni, d = (j + 1) * n + i;
      indices.push(a, b, d, b, c, d);
    }
  }

  const rc = transformSectionPoint({ x: 0.45, y: 0 }, 0, v);
  const rootCenter = positions.length / 3;
  positions.push(rc.x, rc.y, rc.z);

  // Potong titik tengah hujung bilah mengikut rTip supaya tiada bucu terjuih
  const tc = clampToTipRadius(transformSectionPoint({ x: 0.45, y: 0 }, 1, v), rTip, v.TipTrim);
  const tipCenter = positions.length / 3;
  positions.push(tc.x, tc.y, tc.z);

  for (let i = 0; i < n; i++) {
    const ni = (i + 1) % n;
    indices.push(rootCenter, ni, i);
    const a = (stations - 1) * n + i, b = (stations - 1) * n + ni;
    indices.push(tipCenter, a, b);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Bina garisan keratan rentas (Ribs) di Pangkal, Tengah & Hujung bilah
function buildBladeRibs(v) {
  const ribGroup = new THREE.Group();
  const rTip = v.Hub + v.Span;
  const ribStations = [0.02, 0.5, 0.98];

  for (const s of ribStations) {
    const thick = lerp(v.RootThick, v.TipThick, s);
    const camber = lerp(v.RootCamber, v.TipCamber, s);
    const chord = getChord(s, v);
    const { upper, lower } = c4Surfaces(camber, thick, chord, v.TEMin, 28);
    const profile = [...upper.slice().reverse(), ...lower.slice(1)];
    const pts = profile.map((p) => {
      const q = clampToTipRadius(transformSectionPoint(p, s, v), rTip, v.TipTrim);
      return new THREE.Vector3(q.x, q.y, q.z);
    });
    pts.push(pts[0].clone()); // Tutup gelung profil
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    ribGroup.add(new THREE.Line(lineGeo, ribMaterial));
  }
  return ribGroup;
}

function buildAxes(v, hubDepth) {
  axisGroup.clear();
  if (!$('chkAxis').checked) return;
  const R = v.Hub + v.Span;

  // Paksi XYZ & Anak panah arah aliran angin (Biru)
  axisGroup.add(new THREE.AxesHelper(Math.max(30, R * 0.45)));
  axisGroup.add(
    new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0, R * 1.35),
      R * 0.95,
      0x0284c7,
      R * 0.12,
      R * 0.06
    )
  );

  // Anak panah melengkung arah putaran CCW (Oren) di hadapan hab
  const arcR = v.Hub + v.Span * 0.28;
  const arcZ = hubDepth / 2 + (v.SpinnerRatio > 0.05 ? v.Hub * v.SpinnerRatio * 0.35 : 8);
  const startAng = Math.PI * 0.15;
  const endAng = Math.PI * 0.72;
  const arcPts = [];
  for (let i = 0; i <= 24; i++) {
    const a = lerp(startAng, endAng, i / 24);
    arcPts.push(new THREE.Vector3(Math.cos(a) * arcR, Math.sin(a) * arcR, arcZ));
  }
  const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
  axisGroup.add(new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: 0xf97316 })));

  // Kepala anak panah pada hujung lengkungan (arah tangen CCW)
  const tipPt = arcPts[arcPts.length - 1];
  const tangentDir = new THREE.Vector3(-Math.sin(endAng), Math.cos(endAng), 0).normalize();
  const coneLen = Math.max(6, R * 0.08);
  const coneRad = Math.max(2.5, R * 0.032);
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(coneRad, coneLen, 12),
    new THREE.MeshBasicMaterial({ color: 0xf97316 })
  );
  cone.position.copy(tipPt);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangentDir);
  axisGroup.add(cone);
}

function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
  });
  group.clear();
}

function updateRotor() {
  const v = values();
  disposeGroup(rotorGroup);
  singleBladeGroup.clear();

  const bladeGeometry = buildBladeGeometry(v);
  singleBladeGroup.add(new THREE.Mesh(bladeGeometry, bladeMaterial));

  const showRibs = $('chkRibs') ? $('chkRibs').checked : false;

  for (let i = 0; i < v.Blades; i++) {
    const bladeWrap = new THREE.Group();
    const mesh = new THREE.Mesh(bladeGeometry, bladeMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bladeWrap.add(mesh);

    if (showRibs) {
      bladeWrap.add(buildBladeRibs(v));
    }

    bladeWrap.rotation.z = (2 * Math.PI * i) / v.Blades;
    rotorGroup.add(bladeWrap);
  }

  const rootAero = getStationAero(0, v);
  const axialProj = v.Root * Math.sin((rootAero.twistDeg * Math.PI) / 180);
  const hubDepth = Math.max(16, axialProj * 1.25 + 6, v.Root * 1.05);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(v.Hub, v.Hub, hubDepth, 48), hubMaterial);
  hub.rotation.x = Math.PI / 2;
  hub.castShadow = true;
  rotorGroup.add(hub);

  // Papar Spinner Elipsoid hanya jika SpinnerRatio > 0
  if (v.SpinnerRatio > 0.05) {
    const spinnerGeo = new THREE.SphereGeometry(v.Hub, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    spinnerGeo.scale(1, v.SpinnerRatio, 1);
    const spinner = new THREE.Mesh(spinnerGeo, hubMaterial);
    spinner.rotation.x = Math.PI / 2;
    spinner.position.z = hubDepth / 2;
    spinner.castShadow = true;
    rotorGroup.add(spinner);
  }

  if ($('chkDuct').checked) {
    const ductRadius = v.Hub + v.Span + 2;
    const ductGeo = new THREE.CylinderGeometry(ductRadius + 3, ductRadius + 3, hubDepth * 1.6, 64, 1, true);
    const duct = new THREE.Mesh(ductGeo, ductMaterial);
    duct.rotation.x = Math.PI / 2;
    rotorGroup.add(duct);
  }

  buildAxes(v, hubDepth);
  updateOutputs(v);
  drawAirfoil(v);
  drawVelocityTriangle(v);
}

// --- Sudut Pandangan Kamera Pantas ---
function setCameraView(view) {
  const v = values();
  const R = v.Hub + v.Span;
  const dist = Math.max(150, R * 2.7);
  controls.target.set(0, 0, 0);

  if (view === 'front') camera.position.set(0, 0, dist);
  else if (view === 'side') camera.position.set(dist, 0, 0);
  else if (view === 'top') camera.position.set(0, dist, 0.01);
  else camera.position.set(dist * 0.62, dist * 0.45, dist * 0.85); // Isometrik

  controls.update();
}

function updateOutputs(v) {
  const R = (v.Hub + v.Span) / 1000;
  const R_hub = v.Hub / 1000;
  const diameter = 2 * R;
  const area = Math.PI * (R * R - R_hub * R_hub);
  const omega = (2 * Math.PI * v.RPM) / 60;
  const tipSpeed = omega * R;
  const flowQ = area * v.Wind;
  const phi = tipSpeed > 0 ? v.Wind / tipSpeed : 0;

  const midChord = getChord(0.5, v) / 1000;
  const midRadius = (R + R_hub) / 2;
  const solidity = (v.Blades * midChord) / (2 * Math.PI * midRadius);

  const rootAero = getStationAero(0, v);
  const tipAero = getStationAero(1, v);

  $('outDiameter').textContent = `${diameter.toFixed(3)} m`; $('outFlow').textContent = `${flowQ.toFixed(3)} m³/s`;
  $('outTipSpeed').textContent = `${tipSpeed.toFixed(2)} m/s`; $('outPhi').textContent = phi.toFixed(3); $('outSolidity').textContent = `${(solidity * 100).toFixed(1)}%`;
  $('outTwistRange').textContent = `${rootAero.twistDeg.toFixed(1)}° ➔${tipAero.twistDeg.toFixed(1)}°`;

  const alerts = [];
  if (tipSpeed > 80) {
    alerts.push(`<div class="rounded bg-amber-100 text-amber-900 px-2 py-1 font-semibold">⚠ L
