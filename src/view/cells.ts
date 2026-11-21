// World X/Z position and plan envelope of each machine base. The same outer
// edge sets the standing position of an operator attending a fault.
export const cells = [
  { x: -1.88, z: -0.79, w: 1.5, d: 1.27, id: 'UN01', name: 'PART INFEED', closed: true, guard: 1.24 },
  { x: -0.61, z: -0.76, w: 1.025, d: 1.21, id: 'EM13', name: 'ORIENTATION', closed: false, guard: 0 },
  { x: 0.53, z: -0.6, w: 1.245, d: 0.9, id: 'EM14', name: 'INSERTION', closed: true, guard: 1.04 },
  { x: 1.94, z: -0.6, w: 1.57, d: 0.9, id: 'EM15', name: 'INSPECTION', closed: false, guard: 0.87 },
  { x: 1.98, z: 0.93, w: 1.34, d: 1.52, id: 'UN02', name: 'HOUSING', closed: true, guard: 0.95 },
  { x: 0.69, z: 0.92, w: 1.23, d: 1.5, id: 'EM00', name: 'DE-NESTER', closed: true, guard: 1.01, hmi: true },
  { x: -0.53, z: 0.71, w: 1.2, d: 1.08, id: 'UN03', name: 'PACKING', closed: true, guard: 0 },
  { x: -1.85, z: 0.71, w: 1.43, d: 1.08, id: 'EM61', name: 'TRAY OUTFEED', closed: false, guard: 0 },
];
