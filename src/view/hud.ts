import type { LineConfig, MoverProfile } from '../sim/config';
import { ACCEPTS, SUBLINE_FAULTS, overloadTargets } from '../sim/commands';
import type { ReporterStatus } from '../catchai/reporter';
import type { ConnectionState } from '../sim/client';
import { describeCatchAi } from './catchaiStatus';
import type { Command, Frame } from '../sim/protocol';
import { INCIDENT_KINDS, INCIDENT_TEXT, type IncidentKind } from '../sim/incidents';
import { LIGHTINGS, type Lighting, type SimEvent } from '../sim/types';
import { CAMERAS } from './cameras';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/**
 * Text from the server (event messages, command origins, identifiers) goes into HTML escaped: any
 * viewer can name itself, and its name shows up in everyone's event log.
 */
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** Commands without arguments, sent by buttons with a data-cmd attribute. */
type SimpleCommand = 'start' | 'stop' | 'hold' | 'unhold' | 'abort' | 'reset' | 'endBatch';

/** A worn mover's deliberate faults, as an operator would note them. */
function describeWear(w: Partial<MoverProfile>, shift: number): string {
  const parts: string[] = [];
  if (w.badness) parts.push(`worn fixture (badness ${w.badness}: every check reads ${(w.badness * shift).toFixed(1)} σ low)`);
  if (w.rfidOk !== undefined) parts.push(`flaky RFID tag (${(100 * w.rfidOk).toFixed(0)} % first reads)`);
  if (w.mu !== undefined) parts.push(`worn drive pad (μ ${w.mu})`);
  if (w.settle !== undefined) parts.push(`bounces at gates (settles in ${w.settle} s)`);
  if (w.slip !== undefined) parts.push(`slips ${(100 * w.slip).toFixed(0)} % on the belt`);
  if (w.fixtureOffset !== undefined) parts.push(`fixture ${w.fixtureOffset} mm off`);
  return parts.join('; ');
}

const STATUS_TEXT: Record<string, string> = {
  waiting: 'Waiting',
  reading: 'Reading',
  working: 'Working',
  passing: 'Passing',
  stopped: 'Stopped',
  starved: 'Starved (waiting for parts)',
  fault: 'Fault',
  blocked: 'Blocked (outfeed full)',
};

/** HTML overlay: machine controls, KPIs, station list, event log and mover inspector. */
export class Hud {
  private readonly history: { t: number; out: number }[] = [];
  private readonly log: { time: string; text: string; cls: string }[] = [];
  private speedDragging = false;
  private speedTimer: number | undefined;
  selectedMover: number | null = null;
  onToggleReporting?: () => void;
  onReportingOff?: () => void;
  /** Problem the user dismissed; the alert comes back when the problem changes. */
  private dismissed: string | null = null;
  /** Tallies from the events since connecting: pass/fail per unit and per EM14 press, per mover. */
  private units: Record<string, { n: number; failed: number }> = {};
  private presses: Record<string, { n: number; failed: number }> = {};
  private movers: Record<string, { rejects: number; retests: number }> = {};
  /** EM40's latest snap curve, and the verdicts of recent EM40 records by item. */
  private snap: { force: number[]; displacement: number[]; item: number } | null = null;
  private readonly snapVerdicts = new Map<number, { result: string; reason?: string; peak?: number; position?: number }>();
  private frames = 0;

  constructor(
    private readonly cfg: LineConfig,
    private readonly send: (c: Command) => void,
  ) {
    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-cmd]')) {
      btn.addEventListener('click', () => this.send({ type: btn.dataset.cmd as SimpleCommand }));
    }
    $('#b-size-set').addEventListener('click', () => this.send({ type: 'batchSize', size: Number($<HTMLInputElement>('#b-size').value) }));
    $<HTMLInputElement>('#b-auto').addEventListener('change', (e) => this.send({ type: 'autoBatch', on: (e.target as HTMLInputElement).checked }));
    const targets = [
      ...cfg.stations.flatMap((d) => (d.robots ?? []).map((r) => ({ id: r.id, text: `${r.id} robot: axis fault` }))),
      ...cfg.feeders.map((f) => ({ id: f.id, text: `Feeder ${f.id}: jam` })),
      ...overloadTargets(cfg).map((id) => ({ id, text: `${id.replace(/-OVERLOAD$/, '')} press: overload` })),
      ...Object.entries(SUBLINE_FAULTS).map(([id, text]) => ({ id, text })),
    ];
    $('#fault-target').innerHTML = targets.map((t) => `<option value="${t.id}">${t.text}</option>`).join('');
    $('#fault-inject').addEventListener('click', () => this.send({ type: 'fault', target: $<HTMLSelectElement>('#fault-target').value }));
    // Visible incidents, injected in view of a camera (at the station it watches).
    $('#incident-kind').innerHTML = INCIDENT_KINDS.map((k) => `<option value="${k}">${INCIDENT_TEXT[k]}</option>`).join('');
    $('#incident-cam').innerHTML =
      CAMERAS.map((c) => `<option value="${c.mount.station}">${c.name}</option>`).join('') + '<option value="">Anywhere</option>';
    $('#incident-inject').addEventListener('click', () => {
      const station = $<HTMLSelectElement>('#incident-cam').value;
      this.send({ type: 'incident', kind: $<HTMLSelectElement>('#incident-kind').value as IncidentKind, ...(station ? { station } : {}) });
    });
    $('#scene-lighting').innerHTML = LIGHTINGS.map((l) => `<option value="${l}">${l[0].toUpperCase()}${l.slice(1)}</option>`).join('');
    $<HTMLSelectElement>('#scene-lighting').addEventListener('change', (e) => this.send({ type: 'scene', lighting: (e.target as HTMLSelectElement).value as Lighting }));
    $('#scene-seed').addEventListener('click', () => this.send({ type: 'scene', seed: Math.floor(Math.random() * 0xffffffff) }));
    const speed = $<HTMLInputElement>('#speed');
    speed.addEventListener('pointerdown', () => (this.speedDragging = true));
    speed.addEventListener('pointerup', () => (this.speedDragging = false));
    speed.addEventListener('input', () => {
      $('#speed-val').textContent = `${speed.value}%`;
      clearTimeout(this.speedTimer);
      this.speedTimer = window.setTimeout(() => this.send({ type: 'speed', percent: Number(speed.value) }), 80);
    });
    $('#inspector-close').addEventListener('click', () => (this.selectedMover = null));
    $('#catchai').addEventListener('click', () => this.onToggleReporting?.());
    $('#catchai-alert [data-act="off"]').addEventListener('click', () => this.onReportingOff?.());
    $('#catchai-alert [data-act="dismiss"]').addEventListener('click', () => {
      this.dismissed = $('#catchai-alert').dataset.key ?? null;
      $('#catchai-alert').hidden = true;
    });

    $('#stations').innerHTML = cfg.stations
      .map(
        (d) =>
          `<div class="st" id="st-${d.id}"><span class="dot"></span><b>${d.id}</b><span class="name">${d.name}</span><span class="bar"><i></i></span></div>`,
      )
      .join('');
  }

  /** CATCH.AI chip in the top bar (state colour, short status, counts in the tooltip) and the alert. */
  reporting(s: Partial<ReporterStatus> | null): void {
    const el = $('#catchai');
    el.dataset.state = s?.state ?? 'off';
    const view = describeCatchAi(s);
    $('#catchai-state').textContent = view.chip;
    this.reportingAlert(view.alert);
    if (!s) {
      el.title = 'CATCH.AI reporting is off. Click to turn it on.';
      return;
    }
    const lines = [`CATCH.AI: ${s.state === 'ok' ? 'reporting' : s.state}${s.url ? ` to ${s.url} as ${s.line}` : ''}`];
    if (s.sent) lines.push(`sent: ${s.sent.items} items, ${s.sent.merges} merges, ${s.sent.data} device data`, `queued: ${s.queued}`);
    if (s.rejected) lines.push(`refused by server: ${s.rejected}`);
    if (s.dropped) lines.push(`dropped (queue full): ${s.dropped}`);
    if (s.lastError) lines.push(`last error: ${s.lastError}`);
    lines.push('Click to turn reporting off.');
    el.title = lines.join('\n');
  }

  private reportingAlert(a: ReturnType<typeof describeCatchAi>['alert']): void {
    const box = $('#catchai-alert');
    if (!a) {
      box.hidden = true;
      this.dismissed = null;
      return;
    }
    // Text only: details can contain whatever the remote server answered.
    box.dataset.kind = a.kind;
    box.dataset.key = `${a.kind}:${a.title}`;
    box.querySelector('.title')!.textContent = a.title;
    box.querySelector('.detail')!.textContent = a.detail;
    box.querySelector('.hint')!.textContent = a.hint;
    box.querySelector('.meta')!.replaceChildren(
      ...a.meta.map((line) => {
        const d = document.createElement('div');
        d.textContent = line;
        return d;
      }),
    );
    box.hidden = this.dismissed === box.dataset.key;
  }

  /** Connection to the server. Frames stop while it's down, so show that instead of a stale state. */
  connection(state: ConnectionState): void {
    if (state === 'open') {
      // The server sends its recent events again on connect: start the tallies afresh.
      this.log.length = 0;
      this.units = {};
      this.presses = {};
      this.movers = {};
      this.snapVerdicts.clear();
      this.renderQuality();
      return;
    }
    const machine = $('#machine');
    machine.textContent = state === 'connecting' ? 'Connecting' : 'Offline';
    machine.dataset.state = 'Offline';
    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-cmd]')) btn.disabled = true;
  }

  update(f: Frame): void {
    const lighting = $<HTMLSelectElement>('#scene-lighting');
    if (document.activeElement !== lighting) lighting.value = f.scene.lighting;
    const active = f.incidents.length ? ` · ${f.incidents.length} incident${f.incidents.length > 1 ? 's' : ''} on` : '';
    $('#scene-info').textContent = `seed ${f.scene.seed}${active}`;
    const machine = $('#machine');
    machine.textContent = f.machine;
    machine.dataset.state = f.machine;
    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-cmd]')) {
      btn.disabled = !ACCEPTS[btn.dataset.cmd as Command['type']].includes(f.machine);
    }
    if (!this.speedDragging) {
      const pct = Math.round(f.speedTarget * 100);
      $<HTMLInputElement>('#speed').value = String(pct);
      $('#speed-val').textContent = `${pct}%`;
    }
    $('#speed-actual').textContent = `actual ${Math.round(f.speed * 100)}% · belt ${f.beltSpeed.toFixed(2)} m/s`;

    const { good, rejected, traysOut } = f.counters;
    const out = good + rejected;
    this.history.push({ t: f.t, out });
    while (this.history.length > 2 && this.history[0].t < f.t - 60) this.history.shift();
    const h0 = this.history[0];
    const rate = f.t - h0.t > 5 ? ((out - h0.out) / (f.t - h0.t)) * 60 : 0;
    $('#k-good').textContent = String(good);
    $('#k-rej').textContent = String(rejected);
    $('#k-rate').textContent = out > 0 ? `${((100 * rejected) / out).toFixed(1)}%` : '–';
    $('#k-ppm').textContent = rate.toFixed(1);
    $('#k-trays').textContent = String(traysOut);

    f.stations.forEach((s) => {
      const el = $(`#st-${s.id}`);
      el.dataset.status = s.status;
      const fault = s.fault > 0 ? ` · repair in ${Math.ceil(s.fault)} s` : '';
      el.title = `${STATUS_TEXT[s.status]}${fault}${s.moverId ? ` · mover ${s.moverId}` : ''}${s.scrap ? ` · ${s.scrap} scrapped` : ''}`;
      (el.querySelector('.bar i') as HTMLElement).style.width = `${Math.round((s.progress ?? 0) * 100)}%`;
    });

    const b = f.batch;
    if (!b) {
      $('#b-name').textContent = 'No batch';
      $('#b-state').textContent = '';
    } else {
      $('#b-name').textContent = `Batch ${b.name}`;
      $('#b-state').textContent = b.state === 'completing' ? 'running out' : b.state;
      $('#b-state').dataset.state = b.state;
      // Batches count trays (checked at EM61); the bar follows the good pens they need.
      const pens = b.target * this.cfg.traySize;
      $('#b-bar').style.width = `${Math.min(100, (100 * b.good) / pens)}%`;
      $('#b-loaded').textContent = `${b.trays} / ${b.target} trays${b.traysRejected ? ` (${b.traysRejected} rejected)` : ''}`;
      $('#b-out').textContent = `${b.good}/${pens} pens · ${b.rejected} rejected`;
    }
    const size = $<HTMLInputElement>('#b-size');
    if (document.activeElement !== size) size.value = String(f.batchSettings.size);
    $<HTMLInputElement>('#b-auto').checked = f.batchSettings.autoNext;

    this.updateInspector(f);
    // Buffers change slowly; a few times a second is plenty.
    if (this.frames++ % 6 === 0) this.renderBuffers(f);
  }

  /** How full each sub-line buffer is, and whether its consumable or equipment is down. */
  private renderBuffers(f: Frame): void {
    const c = this.cfg;
    const springs = c.feeders.find((x) => x.inline)!;
    const checked = f.feeders.find((x) => x.id === springs.id)?.items.filter((x) => x < springs.inline!.at).length ?? 0;
    const springRoom = Math.floor(springs.inline!.at / springs.pitch) + 1;
    const cups = f.distribution.cups.filter((x) => x === 1).length;
    const labelled = f.dial.slots.filter((x) => x === 3).length;
    const collets = f.cartridges.collets.filter(([, full]) => full === 1).length;
    const pockets = c.cartridges.tub.cols * c.cartridges.tub.rows;
    const a = f.alarms;
    const rows: [string, number, number, string, boolean][] = [
      ['Checked springs', checked, springRoom, `${checked}/${springRoom}`, false],
      ['Spring bases', f.distribution.items.length + cups, 30, a.orienter > 0 ? 'EM13 fault' : `${f.distribution.items.length} + ${cups}/4`, a.orienter > 0],
      ['Labelled housings', labelled, c.dial.nests, a.dialJam > 0 ? 'dial jam' : `${labelled}/${c.dial.nests}`, a.dialJam > 0],
      ['Label roll', f.dial.roll, c.faults.labelRoll, a.labelRoll > 0 ? 'changing' : String(f.dial.roll), a.labelRoll > 0],
      ['Full collets', collets, c.cartridges.collets.count, `${collets}/${c.cartridges.collets.count}`, false],
      ['Cartridges in nest', pockets - f.cartridges.used, pockets, f.cartridges.changing > 0 ? 'changing' : String(pockets - f.cartridges.used), false],
      ['Empty trays', f.tray.stack, c.faults.trayStack, a.destacker > 0 ? 'refilling' : String(f.tray.stack), a.destacker > 0],
    ];
    $('#buffers').innerHTML = rows
      .map(([name, v, cap, text, alarm]) => `<div class="gauge${alarm ? ' alarm' : ''}"><span>${name}</span><span class="g-bar"><i style="width:${Math.min(100, (100 * v) / cap)}%"></i></span><b>${text}</b></div>`)
      .join('');
  }

  /**
   * Share of checks passed per unit (every inspection counts once; a pen failing one of several
   * checks still adds its passes), the four presses side by side, and EM40's last snap curve.
   */
  private renderQuality(): void {
    const pct = (x: number) => `${(100 * x).toFixed(1)} %`;
    $('#fpy').innerHTML = this.cfg.units
      .map((u) => {
        const t = this.units[u.id];
        const y = t && t.n > 0 ? 1 - t.failed / t.n : null;
        return `<div class="gauge" title="${u.name}: ${t ? `${t.n - t.failed} of ${t.n} checks passed` : 'no checks yet'}"><span>${u.id}</span><span class="g-bar"><i style="width:${y === null ? 0 : 100 * y}%"></i></span><b>${y === null ? '–' : pct(y)}</b></div>`;
      })
      .join('');
    const ids = this.cfg.stations.filter((d) => d.group === 'EM14').map((d) => d.id);
    const rates = ids.map((id) => {
      const t = this.presses[id];
      return t && t.n > 0 ? t.failed / t.n : null;
    });
    // One scale for all four, so the outlier shows as the longest bar.
    const top = Math.max(0.4, ...rates.map((r) => r ?? 0));
    $('#presses').innerHTML = ids
      .map((id, i) => {
        const r = rates[i];
        const t = this.presses[id];
        return `<div class="gauge" title="${t ? `${t.failed} of ${t.n} spring bases failed` : 'no cycles yet'}"><span>${id}</span><span class="g-bar"><i style="width:${r === null ? 0 : (100 * r) / top}%"></i></span><b>${r === null ? '–' : pct(r)}</b></div>`;
      })
      .join('');
    this.renderSnap();
  }

  private renderSnap(): void {
    const svg = $('#snap') as unknown as SVGSVGElement;
    const snap = this.snap;
    if (!snap) {
      svg.innerHTML = '';
      return;
    }
    const v = this.snapVerdicts.get(snap.item);
    const verdict = !v ? '' : v.result === 'Passed' ? ' · passed' : ` · ${v.reason ?? 'failed'}`;
    const peakText = v?.peak !== undefined ? `: ${v.peak.toFixed(1)} N at ${v.position!.toFixed(2)} mm` : '';
    $('#snap-title').textContent = `EM40 snap, housing ${snap.item}${peakText}${verdict}`;
    const W = 276;
    const H = 120;
    const [L, R, T, B] = [32, 8, 6, 16];
    const xmax = this.cfg.snap.stroke;
    const ymax = Math.max(10, Math.ceil(Math.max(...snap.force) / 10) * 10);
    const sx = (x: number) => L + (x / xmax) * (W - L - R);
    const sy = (y: number) => T + (1 - y / ymax) * (H - T - B);
    const step = ymax > 60 ? 20 : 10;
    let g = '<g class="grid">';
    // Units ride on the outermost tick labels, so nothing overlaps.
    for (let y = 0; y <= ymax; y += step) g += `<line x1="${L}" x2="${W - R}" y1="${sy(y)}" y2="${sy(y)}"/><text x="${L - 4}" y="${sy(y) + 3}" text-anchor="end">${y}${y + step > ymax ? ' N' : ''}</text>`;
    for (let x = 0; x <= xmax; x += 2) g += `<text x="${sx(x)}" y="${H - 4}" text-anchor="${x === xmax ? 'end' : 'middle'}">${x}${x === xmax ? ' mm' : ''}</text>`;
    g += '</g>';
    // At most ~300 points: plenty for 250 px.
    const every = Math.max(1, Math.floor(snap.force.length / 300));
    const pts = snap.force.filter((_, i) => i % every === 0).map((y, i) => `${sx(snap.displacement[i * every]).toFixed(1)},${sy(y).toFixed(1)}`);
    g += `<polyline class="curve" points="${pts.join(' ')}"/>`;
    if (v?.peak !== undefined) g += `<circle class="peak" cx="${sx(v.position!)}" cy="${sy(v.peak)}" r="4"/>`;
    g += `<line class="xh" y1="${T}" y2="${H - B}" visibility="hidden"/>`;
    svg.innerHTML = g;
    const xh = svg.querySelector('.xh')!;
    const tip = $('#snap-tip');
    svg.onmousemove = (e) => {
      const r = svg.getBoundingClientRect();
      const x = (((e.clientX - r.left) / r.width) * W - L) / (W - L - R);
      const i = Math.max(0, Math.min(snap.force.length - 1, Math.round(x * (snap.force.length - 1))));
      xh.setAttribute('x1', String(sx(snap.displacement[i])));
      xh.setAttribute('x2', String(sx(snap.displacement[i])));
      xh.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.textContent = `${snap.displacement[i].toFixed(2)} mm · ${snap.force[i].toFixed(1)} N`;
    };
    svg.onmouseleave = () => {
      xh.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    };
  }

  private updateInspector(f: Frame): void {
    const panel = $('#inspector');
    const m = this.selectedMover ? f.movers[this.selectedMover - 1] : null;
    panel.hidden = !m;
    if (!m) return;
    const station = f.stations.find((s) => s.moverId === m.id);
    const row = (k: string, v: string) => `<div><span>${k}</span><b>${v}</b></div>`;
    const id = String(m.id).padStart(2, '0');
    const worn = this.cfg.moverProfiles.worn[m.id];
    $('#inspector-title').textContent = `Mover ${String(m.id).padStart(2, '0')}`;
    $('#inspector-body').innerHTML = [
      row('Tag', m.status.toUpperCase()),
      row('Item (SR id)', m.srId === null ? '–' : String(m.srId)),
      row('Parts', m.parts.length ? m.parts.join(', ') : 'empty'),
      row('At station', station ? `${station.id} (${STATUS_TEXT[station.status]})` : '–'),
      row('Speed', `${m.v.toFixed(3)} m/s`),
      row('Laps', String(m.laps)),
      row('Last lap', m.lastLap === null ? '–' : `${m.lastLap.toFixed(1)} s`),
      row('Rejected / retested', `${this.movers[id]?.rejects ?? 0} / ${this.movers[id]?.retests ?? 0} (since connect)`),
      row('Condition', worn ? describeWear(worn, this.cfg.fragileShift) : 'normal'),
      m.mark ? `<div class="mark"><span>Identifier</span><code>${esc(m.mark)}</code></div>` : '',
    ].join('');
  }

  addEvents(events: SimEvent[]): void {
    let quality = false;
    for (const e of events) {
      const entry = this.describe(e);
      if (entry) this.log.unshift(entry);
      quality = this.tally(e) || quality;
    }
    if (quality) this.renderQuality();
    if (this.log.length > 12) this.log.length = 12;
    $('#log').innerHTML = this.log.map((l) => `<div class="${l.cls}"><time>${esc(l.time)}</time>${esc(l.text)}</div>`).join('');
  }

  /** Adds an event to the quality tallies; true if it changed them. */
  private tally(e: SimEvent): boolean {
    if (e.kind === 'series') {
      this.snap = { force: e.values.Force, displacement: e.values.Displacement, item: e.scopedId };
      return true;
    }
    if (e.kind !== 'processed') return false;
    let changed = false;
    if (e.result === 'Passed' || e.result === 'Failed') {
      const unit = e.process.split('-')[1];
      const u = (this.units[unit] ??= { n: 0, failed: 0 });
      u.n++;
      if (e.result === 'Failed') u.failed++;
      const press = this.cfg.stations.find((d) => d.group === 'EM14' && e.process.endsWith(`-${d.id}`));
      if (press) {
        const p = (this.presses[press.id] ??= { n: 0, failed: 0 });
        p.n++;
        if (e.result === 'Failed') p.failed++;
      }
      if (e.properties?.['Peak Force'] !== undefined) {
        this.snapVerdicts.set(e.scopedId, {
          result: e.result,
          reason: e.properties['Failure Reason'] as string | undefined,
          peak: e.properties['Peak Force'] as number,
          position: e.properties['Snap Position'] as number,
        });
        if (this.snapVerdicts.size > 50) this.snapVerdicts.delete(this.snapVerdicts.keys().next().value!);
      }
      changed = true;
    }
    if (e.carrier) {
      const m = (this.movers[e.carrier] ??= { rejects: 0, retests: 0 });
      if (e.properties?.['Reject Cause'] && e.properties.Bin) m.rejects++;
      if (e.result === 'Inconclusive') m.retests++;
    }
    return changed;
  }

  private describe(e: SimEvent): { time: string; text: string; cls: string } | null {
    const at = (ms: number) => new Date(ms).toLocaleTimeString();
    const short = (p: string) => p.replace(`${this.cfg.id}-`, '');
    switch (e.kind) {
      case 'processed': {
        const cause = e.properties?.['Reject Cause'];
        if (e.itemType === 'Tray') return { time: at(e.to), text: `Tray ${e.scopedId} full → outfeed`, cls: 'ok' };
        if (cause && e.properties?.Bin) return { time: at(e.to), text: `Pen ${e.scopedId} (mover ${e.carrier}) → ${e.properties.Bin}: ${cause}`, cls: 'bad' };
        return null;
      }
      case 'command':
        return { time: at(e.logged), text: `${e.command} by ${e.origin}${e.accepted ? '' : ' (rejected)'}`, cls: 'cmd' };
      case 'machine':
        return { time: at(e.logged), text: `Machine → ${e.state}`, cls: 'state' };
      case 'station':
        return { time: at(e.logged), text: `${short(e.process)}: ${e.message}${e.carrier ? ` (mover ${e.carrier})` : ''}`, cls: e.message.includes('cleared') ? 'ok' : 'warn' };
      case 'batch':
        return {
          time: at(e.logged),
          text: e.state === 'started' ? `Batch ${e.name} started (${e.target} trays)` : `Batch ${e.name} complete: ${e.good} good pens, ${e.rejected} rejected`,
          cls: 'state',
        };
      default:
        return null;
    }
  }
}
