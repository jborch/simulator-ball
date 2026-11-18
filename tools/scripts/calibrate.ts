// Calibration runs: the default line (random faults on) for an hour per seed, headless.
// Reports throughput, where time goes per station, faults by type, fail rates per process and
// rejects per mover. Usage: npx tsx tools/scripts/calibrate.ts [minutes=60] [seeds=1,2,3,4] [--json]
import { LINE } from '../../src/sim/config';
import { Simulation } from '../../src/sim/simulation';
import type { SimEvent } from '../../src/sim/types';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const minutes = Number(args[0] ?? 60);
const seeds = (args[1] ?? '1,2,3,4').split(',').map(Number);
const json = process.argv.includes('--json');

interface Run {
  seed: number;
  perMin: number;
  good: number;
  rejected: number;
  retests: number;
  trays: number;
  batches: number;
  busy: Record<string, number>;
  faultTime: Record<string, number>;
  faults: Record<string, number>;
  failRate: Record<string, { n: number; failed: number }>;
  movers: Record<number, { pens: number; rejects: number }>;
}

function runSeed(seed: number): Run {
  const sim = new Simulation({ seed, epochMs: Date.UTC(2026, 10, 18, 6) });
  sim.command({ type: 'start' });
  const faults: Record<string, number> = {};
  const failRate: Record<string, { n: number; failed: number }> = {};
  let batches = 0;
  const count = (e: SimEvent) => {
    if (e.kind === 'station' && !e.code.endsWith('Cleared') && !['labelRollChanged', 'destackerRefilled', 'rfidWriteRecovered'].includes(e.code)) faults[e.code] = (faults[e.code] ?? 0) + 1;
    if (e.kind === 'batch' && e.state === 'completed') batches++;
    if (e.kind === 'processed' && e.result) {
      const k = e.process.replace(`${LINE.id}-`, '');
      const x = (failRate[k] ??= { n: 0, failed: 0 });
      x.n++;
      if (e.result === 'Failed') x.failed++;
    }
  };
  for (let t = 0; t < minutes * 60; t += 10) {
    sim.advance(10);
    sim.drainEvents().forEach(count);
  }
  const { mes, plc, plant } = sim.state;
  const secs = minutes * 60;
  return {
    seed,
    perMin: (mes.good + mes.rejected) / minutes,
    good: mes.good,
    rejected: mes.rejected,
    retests: mes.retests,
    trays: plant.trayLine.stacked,
    batches,
    busy: Object.fromEntries(plc.stations.map((st) => [st.id, st.stats.busy / secs])),
    faultTime: Object.fromEntries(plc.stations.map((st) => [st.id, st.stats.faultTime / secs])),
    faults,
    failRate,
    movers: mes.movers,
  };
}

const runs = seeds.map(runSeed);
if (json) {
  console.log(JSON.stringify(runs));
  process.exit(0);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x: number) => `${(100 * x).toFixed(1)} %`;
console.log(`${minutes} min × ${runs.length} seeds (faults on)\n`);
for (const r of runs) {
  console.log(`seed ${r.seed}: ${r.perMin.toFixed(1)} pens/min, ${r.good} good, ${r.rejected} rejected (${pct(r.rejected / (r.good + r.rejected))}), ${r.retests} retests, ${r.trays} trays, ${r.batches} batches`);
}
console.log(`\nmean ${mean(runs.map((r) => r.perMin)).toFixed(1)} pens/min, reject ${pct(mean(runs.map((r) => r.rejected / (r.good + r.rejected))))}`);

console.log('\nstation busy / fault time (mean):');
for (const id of Object.keys(runs[0].busy)) {
  console.log(`  ${id.padEnd(6)} busy ${pct(mean(runs.map((r) => r.busy[id]))).padStart(7)}   fault ${pct(mean(runs.map((r) => r.faultTime[id]))).padStart(6)}`);
}

console.log('\nfaults per hour (mean):');
const codes = [...new Set(runs.flatMap((r) => Object.keys(r.faults)))].sort();
for (const c of codes) console.log(`  ${c.padEnd(16)} ${((mean(runs.map((r) => r.faults[c] ?? 0)) * 60) / minutes).toFixed(1)}`);

console.log('\nfail rate per process (pooled):');
const procs = [...new Set(runs.flatMap((r) => Object.keys(r.failRate)))].sort();
for (const k of procs) {
  const n = runs.reduce((a, r) => a + (r.failRate[k]?.n ?? 0), 0);
  const f = runs.reduce((a, r) => a + (r.failRate[k]?.failed ?? 0), 0);
  console.log(`  ${k.padEnd(14)} ${pct(f / n).padStart(7)}  of ${n}`);
}

console.log('\nreject rate per mover (pooled), worst first:');
const movers = Object.keys(runs[0].movers).map(Number);
const moverRate = movers
  .map((id) => {
    const pens = runs.reduce((a, r) => a + (r.movers[id]?.pens ?? 0), 0);
    const rej = runs.reduce((a, r) => a + (r.movers[id]?.rejects ?? 0), 0);
    return { id, rate: rej / (pens + rej), n: pens + rej };
  })
  .sort((a, b) => b.rate - a.rate);
for (const m of moverRate.slice(0, 6)) console.log(`  mover ${String(m.id).padStart(2)}  ${pct(m.rate).padStart(7)}  of ${m.n}`);
const rest = moverRate.slice(6);
console.log(`  others  ${pct(mean(rest.map((m) => m.rate))).padStart(7)} (mean)`);
