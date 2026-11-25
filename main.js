// --- Penjana Nama Fail Dinamik & Rekod Parameter + Panduan SWFS ---
function getBaseFilename(prefix) {
  const v = values();
  const diamMm = Math.round((v.Hub + v.Span) * 2);
  return `${prefix}_${v.Blades}B_D${diamMm}mm_${v.RPM}rpm`;
}

function generateSWFSText() {
  const v = values();
  const rTipMm = v.Hub + v.Span;
  const R = rTipMm / 1000;
  const R_hub = v.Hub / 1000;
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
  const axialProj = v.Root * Math.sin((rootAero.twistDeg * Math.PI) / 180);
  const hubDepth = Math.max(16, axialProj * 1.25 + 6, v.Root * 1.05);
  const timestamp = new Date().toLocaleString('ms-MY');

  return `=== REKOD PARAMETER REKA BENTUK & PANDUAN SWFS ===
Dijana oleh Makmal Maya Kipas Paksi Industri
Tarikh / Masa : ${timestamp}

1. TITIK OPERASI & AERODINAMIK
   - Kelajuan Motor (RPM) : ${v.RPM} rpm  (ω = ${omega.toFixed(2)} rad/s)
   - Sasaran Halaju (Vz)  : ${v.Wind.toFixed(1)} m/s
   - Mod Twist            : ${v.AutoTwist ? `Auto-Twist Free Vortex (AoA = ${v.AoA.toFixed(1)}°)` : `Manual (${v.RootTwist}° -> ${v.TipTwist}°)`}
   - Sudut Root -> Tip    : ${rootAero.twistDeg.toFixed(1)}° -> ${tipAero.twistDeg.toFixed(1)}°

2. PARAMETER GEOMETRI ROTOR & BILAH (mm)
   - Bilangan Bilah       : ${v.Blades}
   - Diameter Luar Rotor  : ${(rTipMm * 2).toFixed(1)} mm (Jejari = ${rTipMm.toFixed(1)} mm)
   - Jejari Hab (Hub)     : ${v.Hub} mm  (Ketebalan Hab = ${hubDepth.toFixed(1)} mm)
   - Panjang Bilah (Span) : ${v.Span} mm
   - Kord Pangkal (Root)  : ${v.Root} mm
   - Kembangan (Taper)    : ${v.Taper.toFixed(2)} x
   - Kembung (Mid-Bulge)  : ${v.MidBulge.toFixed(2)} x
   - Sapuan Sabit (Sweep) : ${v.Sweep} mm  (Mod: ${v.SweepMode})

3. PROFIL C4 & SPESIFIKASI INDUSTRI
   - Camber (Root -> Tip) : ${v.RootCamber}% -> ${v.TipCamber}%
   - Tebal (Root -> Tip)  : ${v.RootThick}% -> ${v.TipThick}%
   - Kecondongan (Lean)   : ${v.AxialLean} mm
   - Tebal Min. TE        : ${v.TEMin.toFixed(1)} mm
   - Diameter Lubang Aci  : ${v.ShaftBore} mm
   - Nisbah Spinner       : ${v.SpinnerRatio.toFixed(1)} x ${v.SpinnerRatio <= 0.05 ? '(Hab Rata)' : '(Elipsoid)'}
   - Concentric Tip Trim  : ${v.TipTrim ? 'Aktif' : 'Tidak Aktif'}

4. METRIK PRESTASI ANGGARAN
   - Kadar Aliran (Q)     : ${flowQ.toFixed(4)} m³/s  (${(flowQ * 3600).toFixed(1)} m³/jam)
   - Laju Hujung (Utip)   : ${tipSpeed.toFixed(2)} m/s
   - Pekali Aliran (φ)    : ${phi.toFixed(3)}
   - Solidity (Mid-Span)  : ${(solidity * 100).toFixed(1)}%

5. PANDUAN TETAPAN SOLIDWORKS FLOW SIMULATION (SWFS)
   - Unit Fail STEP       : Milimeter (mm)
   - Rotating Region      : Local Region(s) - Sliding Mesh / Averaging
   - Cadangan Jejari Zon  : ${(rTipMm + 2).toFixed(1)} mm (Tip Clearance ~2 mm)
   - Cadangan Panjang Zon : ${(hubDepth * 1.6).toFixed(1)} mm (merangkumi bilah & hab)
   - Halaju Sudut (ω)     : ${omega.toFixed(2)} rad/s  (${v.RPM} RPM)
   - Boundary Conditions  : Inlet Vz = ${v.Wind.toFixed(2)} m/s | Outlet = Environment Pressure (101325 Pa)
     *(Untuk ujian Aliran Bebas / Free Delivery, set Environment Pressure pada kedua-dua Inlet & Outlet.)*
   - Tip Meshing & Goals  : Tambah Local Initial Mesh pada permukaan bilah. Tetapkan Surface Goals
     untuk Static Pressure (Inlet & Outlet) bagi ΔP, serta Torque (Z-axis) bagi kuasa aci & kecekapan.`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadParamsTxt(baseName) {
  setTimeout(() => {
    downloadBlob(new Blob([generateSWFSText()], { type: 'text/plain;charset=utf-8' }), `${baseName}_Params.txt`);
  }, 350);
}

// --- Enjin CAD (.STEP) melalui Web Worker ---
let cadWorker = null;
function setStepBusy(busy, msg = '') {
  $('btnExportBladeSTEP').disabled = busy;
  $('btnExportRotorSTEP').disabled = busy;
  $('cadStatus').textContent = msg;
  $('cadStatus').classList.toggle('hidden', !msg);
}

function requestSTEP(mode, baseName) {
  if (!cadWorker) {
    cadWorker = new Worker(new URL('./cad.worker.js', import.meta.url), { type: 'module' });
  }
  setStepBusy(true, 'Memulakan enjin CAD...');
  cadWorker.onmessage = (e) => {
    const { type, message, buffer } = e.data;
    if (type === 'progress') setStepBusy(true, message);
    else if (type === 'done') {
      downloadBlob(new Blob([buffer], { type: 'application/step' }), `${baseName}.step`);
      downloadParamsTxt(baseName);
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
['chkAutoTwist', 'chkTipTrim', 'chkDuct', 'chkAxis', 'chkRibs', 'selStation', 'selSweepMode'].forEach((id) => {
  if ($(id)) $(id).addEventListener('change', scheduleUpdate);
});

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const p = PRESETS[btn.dataset.preset];
    if (!p) return;
    $('presetNote').textContent = p.note;
    for (const [k, val] of Object.entries(p.values)) {
      if (k === 'AutoTwist') $('chkAutoTwist').checked = val;
      else if (k === 'SweepMode') $('selSweepMode').value = val;
      else if (inputMap[k]) $(inputMap[k]).value = val;
    }
    scheduleUpdate();
    setTimeout(() => setCameraView('iso'), 40);
  });
});

document.querySelectorAll('.view-btn').forEach((btn) => {
  btn.addEventListener('click', () => setCameraView(btn.dataset.view));
});

$('btnExportBladeSTEP').addEventListener('click', () => requestSTEP('blade', getBaseFilename('Bilah')));
$('btnExportRotorSTEP').addEventListener('click', () => requestSTEP('rotor', getBaseFilename('Rotor')));
$('btnExportBladeSTL').addEventListener('click', () => {
  const base = getBaseFilename('Bilah');
  singleBladeGroup.updateMatrixWorld(true);
  downloadBlob(new Blob([new STLExporter().parse(singleBladeGroup, { binary: true })], { type: 'model/stl' }), `${base}.stl`);
  downloadParamsTxt(base);
});
$('btnExportRotorSTL').addEventListener('click', () => {
  const base = getBaseFilename('Rotor');
  rotorGroup.updateMatrixWorld(true);
  downloadBlob(new Blob([new STLExporter().parse(rotorGroup, { binary: true })], { type: 'model/stl' }), `${base}.stl`);
  downloadParamsTxt(base);
});
$('btnExportBladeOBJ').addEventListener('click', () => {
  const base = getBaseFilename('Bilah');
  singleBladeGroup.updateMatrixWorld(true);
  downloadBlob(new Blob([new OBJExporter().parse(singleBladeGroup)], { type: 'text/plain' }), `${base}.obj`);
  downloadParamsTxt(base);
});
$('btnExportRotorOBJ').addEventListener('click', () => {
  const base = getBaseFilename('Rotor');
  rotorGroup.updateMatrixWorld(true);
  downloadBlob(new Blob([new OBJExporter().parse(rotorGroup)], { type: 'text/plain' }), `${base}.obj`);
  downloadParamsTxt(base);
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
  const base = getBaseFilename('Rotor');
  downloadBlob(new Blob([$('swfsContent').textContent], { type: 'text/plain;charset=utf-8' }), `${base}_Params.txt`);
});
// --- Loop Animasi ---
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
  if ($('chkSpin').checked && rpm > 0) {
    const physical = $('chkPhysical').checked;
    const omega = (2 * Math.PI * rpm) / 60;
    rotorGroup.rotation.z += omega * dt * (physical ? 1 : 0.05);
  }
  controls.update();
  renderer.render(scene, camera);
}

syncUIValues();
updateRotor();
setCameraView('iso');
animate();
