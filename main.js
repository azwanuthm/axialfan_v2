import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { c4Surfaces, transformSectionPoint, getStationAero, lerp } from './fanMath.js';

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

scene.add(new THREE.HemisphereLight(0xffffff, 0x475569, 1.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
keyLight.position.set(200, 400, 300);
keyLight.castShadow = true;
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
fillLight.position.set(-200, -100, -200);
scene.add(fillLight);
scene.add(new THREE.GridHelper(700, 35, 0x94a3b8, 0xcbd5e1));

const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.55, side: THREE.DoubleSide });
const hubMaterial = new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.45, metalness: 0.15 });
const ductMaterial = new THREE.MeshStandardMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.14, side: THREE.DoubleSide, roughness: 0.2 });

let rotorGroup = new THREE.Group();
let axisGroup = new THREE.Group();
let singleBladeGroup = new THREE.Group();
scene.add(rotorGroup, axisGroup);

const inputMap = {
  RPM: 'inpRPM', Wind: 'inpWind', AoA: 'inpAoA',
  RootTwist: 'inpRootTwist', TipTwist: 'inpTipTwist',
  Blades: 'inpBlades', Hub: 'inpHub', Span: 'inpSpan',
  Root: 'inpRoot', Taper: 'inpTaper', Sweep: 'inpSweep',
  RootCamber: 'inpRootCamber', TipCamber: 'inpTipCamber',
  RootThick: 'inpRootThick', TipThick: 'inpTipThick',
  AxialLean: 'inpAxialLean', TEMin: 'inpTEMin',
  ShaftBore: 'inpShaftBore', SpinnerRatio: 'inpSpinnerRatio'
};

// --- Pratetap Aplikasi Sebenar ---
const PRESETS = {
  radiator: {
    note: 'Kipas Radiator Automotif: Solidity tinggi, kord hujung lebar (taper 1.55x) dan sapuan sabit ketara untuk melawan rintangan tekanan tinggi serta mengurangkan hingar.',
    values: { RPM: 1800, Wind: 6.5, AutoTwist: true, AoA: 4.5, Blades: 9, Hub: 65, Span: 145, Root: 44, Taper: 1.55, Sweep: 32, RootCamber: 10, TipCamber: 6, RootThick: 12, TipThick: 6, AxialLean: 10, TEMin: 1.2, ShaftBore: 20, SpinnerRatio: 1.0 }
  },
  hvac: {
    note: 'Kipas Terowong / HVAC Ducted: Nisbah hab-ke-hujung seimbang, bilangan bilah sederhana, dan hujung dipotong sepusat bagi meminimumkan kebocoran aliran di dinding duct.',
    values: { RPM: 1450, Wind: 9.0, AutoTwist: true, AoA: 4.0, Blades: 7, Hub: 75, Span: 175, Root: 48, Taper: 1.20, Sweep: 18, RootCamber: 8, TipCamber: 4, RootThick: 13, TipThick: 6, AxialLean: 6, TEMin: 1.4, ShaftBore: 28, SpinnerRatio: 1.4 }
  },
  cooling: {
    note: 'Kipas Aliran Bebas (Cooling): Bilah lebih ramping (taper < 1.0) dan solidity rendah untuk menggerakkan isipadu udara tinggi pada rintangan tekanan rendah.',
    values: { RPM: 1100, Wind: 4.5, AutoTwist: true, AoA: 3.5, Blades: 5, Hub: 45, Span: 185, Root: 38, Taper: 0.85, Sweep: 10, RootCamber: 7, TipCamber: 3, RootThick: 11, TipThick: 5, AxialLean: 0, TEMin: 1.0, ShaftBore: 16, SpinnerRatio: 1.2 }
  }
};

function values() {
  const v = {};
  for (const [key, id] of Object.entries(inputMap)) v[key] = Number($(id).value);
  v.AutoTwist = $('chkAutoTwist').checked;
  v.TipTrim = $('chkTipTrim').checked;
  return v;
}

function syncUIValues() {
  for (const [key, id] of Object.entries(inputMap)) {
    const decimals = ['Taper', 'Wind', 'AoA', 'TEMin', 'SpinnerRatio'].includes(key) ? (key === 'Taper' ? 2 : 1) : 0;
    $(`val${key}`).textContent = Number($(id).value).toFixed(decimals);
  }
  const auto = $('chkAutoTwist').checked;
  $('boxAoA').classList.toggle('hidden', !auto);
  $('boxManualTwist').classList.toggle('hidden', auto);
  $('badgeMode').textContent = auto ? 'FREE VORTEX' : 'MANUAL TWIST';
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
    const chord = v.Root * (1 + (v.Taper - 1) * Math.pow(s, 1.5));
    const { upper, lower } = c4Surfaces(camber, thick, chord, v.TEMin, count);
    const profile = [...upper.slice().reverse(), ...lower.slice(1)];

    for (const p of profile) {
      let q = transformSectionPoint(p, s, v);
      // Visualisasi Concentric Tip Trimming pada Three.js
      if (v.TipTrim) {
        const radial = Math.hypot(q.x, q.y);
        if (radial > rTip) {
          const scale = rTip / radial;
          q.x *= scale;
          q.y *= scale;
        }
      }
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

  const tc = transformSectionPoint({ x: 0.45, y: 0 }, 1, v);
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

function buildAxes(v) {
  axisGroup.clear();
  if (!$('chkAxis').checked) return;
  const R = v.Hub + v.Span;
  axisGroup.add(new THREE.AxesHelper(Math.max(80, R * 0.55)));
  axisGroup.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, R * 1.5), R * 1.2, 0x0ea5e9, R * 0.1, R * 0.05));
}

function updateRotor() {
  const v = values();
  rotorGroup.children.forEach((c) => { if (c.geometry) c.geometry.dispose(); });
  rotorGroup.clear();
  singleBladeGroup.clear();

  const bladeGeometry = buildBladeGeometry(v);
  singleBladeGroup.add(new THREE.Mesh(bladeGeometry, bladeMaterial));

  for (let i = 0; i < v.Blades; i++) {
    const mesh = new THREE.Mesh(bladeGeometry, bladeMaterial);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.rotation.z = (2 * Math.PI * i) / v.Blades;
    rotorGroup.add(mesh);
  }

  const hubDepth = Math.max(30, v.Root * 1.25);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(v.Hub, v.Hub, hubDepth, 48), hubMaterial);
  hub.rotation.x = Math.PI / 2; hub.castShadow = true;
  rotorGroup.add(hub);

  // Spinner Elipsoid
  const spinnerGeo = new THREE.SphereGeometry(v.Hub, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  spinnerGeo.scale(1, v.SpinnerRatio, 1);
  const spinner = new THREE.Mesh(spinnerGeo, hubMaterial);
  spinner.rotation.x = Math.PI / 2;
  spinner.position.z = hubDepth / 2;
  spinner.castShadow = true;
  rotorGroup.add(spinner);

  if ($('chkDuct').checked) {
    const ductRadius = v.Hub + v.Span + 2;
    const ductGeo = new THREE.CylinderGeometry(ductRadius + 4, ductRadius + 4, hubDepth * 2, 64, 1, true);
    const duct = new THREE.Mesh(ductGeo, ductMaterial);
    duct.rotation.x = Math.PI / 2;
    rotorGroup.add(duct);
  }

  buildAxes(v);
  updateOutputs(v);
  drawAirfoil(v);
  drawVelocityTriangle(v);
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

  const midChord = (v.Root * (1 + (v.Taper - 1) * Math.pow(0.5, 1.5))) / 1000;
  const midRadius = (R + R_hub) / 2;
  const solidity = (v.Blades * midChord) / (2 * Math.PI * midRadius);

  const rootAero = getStationAero(0, v);
  const tipAero = getStationAero(1, v);

  $('outDiameter').textContent = `${diameter.toFixed(3)} m`;
  $('outFlow').textContent = `${flowQ.toFixed(3)} m³/s`;
  $('outTipSpeed').textContent = `${tipSpeed.toFixed(2)} m/s`;
  $('outPhi').textContent = phi.toFixed(3);
  $('outSolidity').textContent = `${(solidity * 100).toFixed(1)}%`;
  $('outTwistRange').textContent = `${rootAero.twistDeg.toFixed(1)}° ➔ ${tipAero.twistDeg.toFixed(1)}°`;

  // Amaran Pintar Aerodinamik
  const alerts = [];
  if (tipSpeed > 80) {
    alerts.push(`<div class="rounded bg-amber-100 text-amber-900 px-2 py-1 font-semibold">⚠ Laju hujung tinggi (${tipSpeed.toFixed(0)} m/s): Risiko hingar aerodinamik tinggi.</div>`);
  }
  if (rootAero.actualAoA > 12 || tipAero.actualAoA > 12) {
    alerts.push(`<div class="rounded bg-rose-100 text-rose-900 px-2 py-1 font-semibold">⚠ Risiko Stall: Sudut serangan melebihi 12°. Aktifkan Auto-Twist atau laraskan RPM/Vz.</div>`);
  } else if (rootAero.actualAoA < -2 || tipAero.actualAoA < -2) {
    alerts.push(`<div class="rounded bg-amber-100 text-amber-900 px-2 py-1 font-semibold">⚠ Sudut serangan negatif: Bilah tidak menjana daya angkat efektif.</div>`);
  } else {
    alerts.push(`<div class="rounded bg-emerald-100 text-emerald-900 px-2 py-1 font-semibold">✓ Julat operasi stabil (tiada risiko stall ketara).</div>`);
  }
  $('aeroAlerts').innerHTML = alerts.join('');
}

function drawAirfoil(v) {
  const s = Number($('selStation').value);
  const canvas = $('airfoilCanvas');
  const ctx = canvas.getContext('2d');
  const thick = lerp(v.RootThick, v.TipThick, s);
  const camber = lerp(v.RootCamber, v.TipCamber, s);
  const chord = v.Root * (1 + (v.Taper - 1) * Math.pow(s, 1.5));
  const { upper, lower } = c4Surfaces(camber, thick, chord, v.TEMin, 40);
  const pts = [...upper.slice().reverse(), ...lower.slice(1)];

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const pad = 28, w = canvas.width - 2 * pad, h = canvas.height - 2 * pad;
  ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, canvas.height / 2); ctx.lineTo(canvas.width - pad, canvas.height / 2); ctx.stroke();

  const ys = pts.map((p) => p.y);
  const scaleY = Math.min(w, h / Math.max(0.2, Math.max(...ys) - Math.min(...ys)));
  ctx.strokeStyle = '#0ea5e9'; ctx.fillStyle = 'rgba(14,165,233,0.16)'; ctx.lineWidth = 3;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = pad + p.x * w;
    const y = canvas.height / 2 - p.y * scaleY;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath(); ctx.fill(); ctx.stroke();

  $('airfoilInfo').innerHTML = `Kord: <b>${chord.toFixed(1)} mm</b> | Camber: <b>${camber.toFixed(1)}%</b> | Tebal: <b>${thick.toFixed(1)}%</b> | TE: <b>${v.TEMin} mm</b>`;
}

function drawVelocityTriangle(v) {
  const s = Number($('selStation').value);
  const aero = getStationAero(s, v);
  const canvas = $('velCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const ox = 55, oy = canvas.height - 32;
  const maxVel = Math.max(aero.U, aero.Vz, 10);
  const scale = Math.min((canvas.width - 110) / maxVel, (canvas.height - 65) / maxVel);

  const ux = ox + aero.U * scale;
  const uy = oy;
  const vx = ux;
  const vy = oy - aero.Vz * scale;

  function arrow(x1, y1, x2, y2, color, label, lx, ly) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 10 * Math.cos(ang - 0.4), y2 - 10 * Math.sin(ang - 0.4));
    ctx.lineTo(x2 - 10 * Math.cos(ang + 0.4), y2 - 10 * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
    ctx.font = 'bold 18px Inter, sans-serif';
    ctx.fillText(label, lx, ly);
  }

  // Lukis vektor U (Tangen), Vz (Paksi), W (Relatif)
  arrow(ox, oy, ux, uy, '#0ea5e9', `U=${aero.U.toFixed(1)}`, (ox + ux) / 2 - 25, oy + 22);
  arrow(ux, uy, vx, vy, '#10b981', `Vz=${aero.Vz.toFixed(1)}`, ux + 8, (uy + vy) / 2);
  arrow(ox, oy, vx, vy, '#6366f1', `W=${aero.W.toFixed(1)}`, (ox + vx) / 2 - 55, (oy + vy) / 2 - 8);

  // Garis panduan sudut bilah (twist)
  const rad = (aero.twistDeg * Math.PI) / 180;
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox + 130 * Math.cos(rad), oy - 130 * Math.sin(rad));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#334155'; ctx.font = 'bold 16px Inter, sans-serif';
  ctx.fillText(`β=${aero.flowAngleDeg.toFixed(1)}° | Twist=${aero.twistDeg.toFixed(1)}° | α=${aero.actualAoA.toFixed(1)}°`, 12, 22);
}

// --- Panduan Tetapan SWFS ---
function generateSWFSText() {
  const v = values();
  const rTipMm = v.Hub + v.Span;
  const R = rTipMm / 1000;
  const R_hub = v.Hub / 1000;
  const area = Math.PI * (R * R - R_hub * R_hub);
  const omega = (2 * Math.PI * v.RPM) / 60;
  const flowQ = area * v.Wind;
  const hubDepth = Math.max(30, v.Root * 1.25);

  return `=== PANDUAN TETAPAN SOLIDWORKS FLOW SIMULATION (SWFS) ===
Dijana oleh Makmal Maya Kipas Paksi

1. GEOMETRI & UNIT
   - Unit Fail STEP       : Milimeter (mm)
   - Diameter Luar Rotor  : ${(rTipMm * 2).toFixed(1)} mm (Jejari = ${rTipMm.toFixed(1)} mm)
   - Bilangan Bilah       : ${v.Blades}
   - Mod Twist            : ${v.AutoTwist ? `Auto Free Vortex (AoA = ${v.AoA}°)` : `Manual (${v.RootTwist}° -> ${v.TipTwist}°)`}

2. ROTATING REGION (LOKAL)
   - Jenis Analisis       : Internal (dengan Duct) atau External
   - Tetapan Putaran      : Local Region(s) - Sliding Mesh / Averaging
   - Cadangan Jejari Zon  : ${(rTipMm + 2).toFixed(1)} mm (Tip Clearance ~2 mm)
   - Cadangan Panjang Zon : ${(hubDepth * 1.6).toFixed(1)} mm (merangkumi bilah & spinner)
   - Halaju Sudut (ω)     : ${omega.toFixed(2)} rad/s  (${v.RPM} RPM)

3. BOUNDARY CONDITIONS (SYARAT SEMPADAN)
   - Inlet Velocity (Vz)  : ${v.Wind.toFixed(2)} m/s (arah paksi -Z ke +Z / mengikut orientasi)
   - Anggaran Aliran (Q)  : ${flowQ.toFixed(4)} m³/s  (${(flowQ * 3600).toFixed(1)} m³/jam)
   - Outlet               : Environment Pressure (101325 Pa)

4. TIP MESHING & GOALS
   - Tambah Local Initial Mesh pada permukaan bilah (Refine Fluid/Solid cells).
   - Tetapkan Surface Goals: Static Pressure (Inlet & Outlet) untuk kira ΔP,
     serta Torque (Z-axis) pada permukaan rotor untuk kira kuasa aci & kecekapan.`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Enjin CAD (.STEP) melalui Web Worker ---
let cadWorker = null;
function setStepBusy(busy, msg = '') {
  $('btnExportBladeSTEP').disabled = busy;
  $('btnExportRotorSTEP').disabled = busy;
  $('cadStatus').textContent = msg;
  $('cadStatus').classList.toggle('hidden', !msg);
}

function requestSTEP(mode, filename) {
  if (!cadWorker) {
    cadWorker = new Worker(new URL('./cad.worker.js', import.meta.url), { type: 'module' });
  }
  setStepBusy(true, 'Memulakan enjin CAD...');
  cadWorker.onmessage = (e) => {
    const { type, message, buffer } = e.data;
    if (type === 'progress') setStepBusy(true, message);
    else if (type === 'done') {
      downloadBlob(new Blob([buffer], { type: 'application/step' }), filename);
      setStepBusy(false);
    } else if (type === 'error') {
      alert('Ralat menjana STEP: ' + message);
      setStepBusy(false);
    }
  };
  cadWorker.postMessage({ mode, params: values() });
}

// --- Event Listeners ---
let timer;
function scheduleUpdate() {
  syncUIValues();
  clearTimeout(timer);
  timer = setTimeout(updateRotor, 30);
}

for (const id of Object.values(inputMap)) {
  $(id).addEventListener('input', scheduleUpdate);
}
['chkAutoTwist', 'chkTipTrim', 'chkDuct', 'chkAxis', 'selStation'].forEach((id) => {
  $(id).addEventListener('change', scheduleUpdate);
});

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const p = PRESETS[btn.dataset.preset];
    if (!p) return;
    $('presetNote').textContent = p.note;
    for (const [k, val] of Object.entries(p.values)) {
      if (k === 'AutoTwist') $('chkAutoTwist').checked = val;
      else if (inputMap[k]) $(inputMap[k]).value = val;
    }
    scheduleUpdate();
  });
});

$('btnExportBladeSTEP').addEventListener('click', () => requestSTEP('blade', 'Bilah_Industri_mm.step'));
$('btnExportRotorSTEP').addEventListener('click', () => requestSTEP('rotor', 'Rotor_Industri_Lengkap_mm.step'));
$('btnExportBladeSTL').addEventListener('click', () => {
  singleBladeGroup.updateMatrixWorld(true);
  downloadBlob(new Blob([new STLExporter().parse(singleBladeGroup, { binary: true })], { type: 'model/stl' }), 'Bilah_mm.stl');
});
$('btnExportRotorSTL').addEventListener('click', () => {
  rotorGroup.updateMatrixWorld(true);
  downloadBlob(new Blob([new STLExporter().parse(rotorGroup, { binary: true })], { type: 'model/stl' }), 'Rotor_mm.stl');
});
$('btnExportBladeOBJ').addEventListener('click', () => {
  singleBladeGroup.updateMatrixWorld(true);
  downloadBlob(new Blob([new OBJExporter().parse(singleBladeGroup)], { type: 'text/plain' }), 'Bilah_mm.obj');
});
$('btnExportRotorOBJ').addEventListener('click', () => {
  rotorGroup.updateMatrixWorld(true);
  downloadBlob(new Blob([new OBJExporter().parse(rotorGroup)], { type: 'text/plain' }), 'Rotor_mm.obj');
});

// Modal SWFS
$('btnSWFSSheet').addEventListener('click', () => {
  $('swfsContent').textContent = generateSWFSText();
  $('swfsModal').classList.remove('hidden');
  $('swfsModal').classList.add('flex');
});
$('btnCloseModal').addEventListener('click', () => {
  $('swfsModal').classList.add('hidden');
  $('swfsModal').classList.remove('flex');
});
$('btnCopySWFS').addEventListener('click', () => {
  navigator.clipboard.writeText($('swfsContent').textContent);
  $('btnCopySWFS').textContent = 'Disalin!';
  setTimeout(() => ($('btnCopySWFS').textContent = 'Salin Teks'), 1500);
});
$('btnDownloadSWFS').addEventListener('click', () => {
  downloadBlob(new Blob([$('swfsContent').textContent], { type: 'text/plain' }), 'Panduan_Tetapan_SWFS.txt');
});

// --- Loop Animasi ---
camera.position.set(260, 190, 390);
controls.target.set(0, 0, 0);
controls.update();
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const rpm = Number($('inpRPM').value);
  if (rpm > 0) {
    const physical = $('chkPhysical').checked;
    const omega = (2 * Math.PI * rpm) / 60;
    rotorGroup.rotation.z += omega * dt * (physical ? 1 : 0.05);
  }
  controls.update();
  renderer.render(scene, camera);
}

syncUIValues();
updateRotor();
animate();