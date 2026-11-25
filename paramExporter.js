// Plugin eksport parameter reka bentuk (.txt) tanpa mengubah main.js

function getVal(id, fallback = '-') {
  const el = document.getElementById(id);
  return el ? el.value : fallback;
}

function getChecked(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}

function getText(id, fallback = '-') {
  const el = document.getElementById(id);
  return el ? el.textContent.trim() : fallback;
}

function buildParamReport(exportType) {
  const rpm = Number(getVal('inpRPM', 0));
  const hub = Number(getVal('inpHub', 0));
  const span = Number(getVal('inpSpan', 0));
  const blades = getVal('inpBlades');
  const diamMm = ((hub + span) * 2).toFixed(1);
  const omega = ((2 * Math.PI * rpm) / 60).toFixed(2);
  const autoTwist = getChecked('chkAutoTwist');
  const spinner = Number(getVal('inpSpinnerRatio', 0));
  const timestamp = new Date().toLocaleString('ms-MY');

  return `=== REKOD PARAMETER REKA BENTUK KIPAS PAKSI ===
Dijana oleh Makmal Maya Kipas Paksi Industri
Tarikh / Masa : ${timestamp}
Jenis Eksport : ${exportType}

1. TITIK OPERASI & AERODINAMIK
   - Kelajuan Motor (RPM) : ${rpm} rpm  (ω = ${omega} rad/s)
   - Sasaran Halaju (Vz)  : ${getVal('inpWind')} m/s
   - Mod Twist            : ${autoTwist ? `Auto-Twist Free Vortex (AoA = ${getVal('inpAoA')}°)` : `Manual (Root ${getVal('inpRootTwist')}° -> Tip ${getVal('inpTipTwist')}°)`}
   - Sudut Root -> Tip    : ${getText('outTwistRange')}

2. DIMENSI ROTOR & BILAH (mm)
   - Bilangan Bilah       : ${blades}
   - Diameter Luar Rotor  : ${diamMm} mm  (Jejari = ${(hub + span).toFixed(1)} mm)
   - Jejari Hab (Hub)     : ${hub} mm
   - Panjang Bilah (Span) : ${span} mm
   - Kord Pangkal (Root)  : ${getVal('inpRoot')} mm
   - Kembangan (Taper)    : ${getVal('inpTaper')} x
   - Kembung (Mid-Bulge)  : ${getVal('inpMidBulge')} x
   - Sapuan Sabit (Sweep) : ${getVal('inpSweep')} mm  (Mod: ${getVal('selSweepMode')})

3. PROFIL C4 & SPESIFIKASI INDUSTRI
   - Camber (Root -> Tip) : ${getVal('inpRootCamber')}% -> ${getVal('inpTipCamber')}%
   - Tebal (Root -> Tip)  : ${getVal('inpRootThick')}% -> ${getVal('inpTipThick')}%
   - Kecondongan (Lean)   : ${getVal('inpAxialLean')} mm
   - Tebal Min. TE        : ${getVal('inpTEMin')} mm
   - Diameter Lubang Aci  : ${getVal('inpShaftBore')} mm
   - Nisbah Spinner       : ${spinner.toFixed(1)} x ${spinner <= 0.05 ? '(Hab Rata)' : '(Elipsoid)'}
   - Concentric Tip Trim  : ${getChecked('chkTipTrim') ? 'Aktif' : 'Tidak Aktif'}

4. METRIK AERODINAMIK SEMASA
   - Diameter Rotor       : ${getText('outDiameter')}
   - Kadar Aliran (Q)     : ${getText('outFlow')}
   - Laju Hujung (Utip)   : ${getText('outTipSpeed')}
   - Pekali Aliran (φ)    : ${getText('outPhi')}
   - Solidity (Mid-Span)  : ${getText('outSolidity')}`;
}

function downloadParamFile(prefix, exportType) {
  const hub = Number(getVal('inpHub', 0));
  const span = Number(getVal('inpSpan', 0));
  const diamMm = Math.round((hub + span) * 2);
  const blades = getVal('inpBlades', '0');
  const rpm = getVal('inpRPM', '0');
  const filename = `${prefix}_${blades}B_D${diamMm}mm_${rpm}rpm_Params.txt`;

  const content = buildParamReport(exportType);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Pasang pendengar pada semua butang eksport 3D sedia ada
const exportButtons = [
  { id: 'btnExportBladeSTEP', prefix: 'Bilah', label: 'STEP (Satu Bilah)' },
  { id: 'btnExportRotorSTEP', prefix: 'Rotor', label: 'STEP (Rotor Lengkap)' },
  { id: 'btnExportBladeSTL',  prefix: 'Bilah', label: 'STL (Satu Bilah)' },
  { id: 'btnExportRotorSTL',  prefix: 'Rotor', label: 'STL (Rotor Lengkap)' },
  { id: 'btnExportBladeOBJ',  prefix: 'Bilah', label: 'OBJ (Satu Bilah)' },
  { id: 'btnExportRotorOBJ',  prefix: 'Rotor', label: 'OBJ (Rotor Lengkap)' }
];

exportButtons.forEach(({ id, prefix, label }) => {
  const btn = document.getElementById(id);
  if (btn) {
    btn.addEventListener('click', () => {
      // Jeda 300ms supaya tidak bertindih dengan cetusan klik utama
      setTimeout(() => downloadParamFile(prefix, label), 300);
    });
  }
});
