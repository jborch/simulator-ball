import type { LineConfig } from '../sim/config';
import { ACCEPTS } from '../sim/plc';
import type { Command, Frame } from '../sim/protocol';
import type { SimEvent } from '../sim/types';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const STATUS_TEXT: Record<string, string> = {
  waiting: 'Waiting',
  reading: 'Reading',
  working: 'Working',
  passing: 'Passing',
  stopped: 'Stopped',
  starved: 'Starved (waiting for parts)',
  blocked: 'Blocked (outfeed full)',
};

/** HTML overlay: machine controls, KPIs, station list, event log and mover inspector. */
export class Hud {
  private readonly history: { t: number; out: number }[] = [];
  private readonly log: { time: string; text: string; cls: string }[] = [];
  private speedDragging = false;
  private speedTimer: number | undefined;
  selectedMover: number | null = null;

  constructor(
    private readonly cfg: LineConfig,
    private readonly send: (c: Command) => void,
  ) {
    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-cmd]')) {
      btn.addEventListener('click', () => this.send({ type: btn.dataset.cmd as Exclude<Command['type'], 'speed'> }));
    }
    const speed = $<HTMLInputElement>('#speed');
    speed.addEventListener('pointerdown', () => (this.speedDragging = true));
    speed.addEventListener('pointerup', () => (this.speedDragging = false));
    speed.addEventListener('input', () => {
      $('#speed-val').textContent = `${speed.value}%`;
      clearTimeout(this.speedTimer);
      this.speedTimer = window.setTimeout(() => this.send({ type: 'speed', percent: Number(speed.value) }), 80);
    });
    $('#inspector-close').addEventListener('click', () => (this.selectedMover = null));

    $('#stations').innerHTML = cfg.stations
      .map(
        (d) =>
          `<div class="st" id="st-${d.id}"><span class="dot"></span><b>${d.id}</b><span class="name">${d.name}</span><span class="bar"><i></i></span></div>`,
      )
      .join('');
  }

  update(f: Frame): void {
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
      el.title = `${STATUS_TEXT[s.status]}${s.moverId ? ` · mover ${s.moverId}` : ''}`;
      (el.querySelector('.bar i') as HTMLElement).style.width = `${Math.round((s.progress ?? 0) * 100)}%`;
    });

    this.updateInspector(f);
  }

  private updateInspector(f: Frame): void {
    const panel = $('#inspector');
    const m = this.selectedMover ? f.movers[this.selectedMover - 1] : null;
    panel.hidden = !m;
    if (!m) return;
    const station = f.stations.find((s) => s.moverId === m.id);
    const row = (k: string, v: string) => `<div><span>${k}</span><b>${v}</b></div>`;
    $('#inspector-title').textContent = `Mover ${String(m.id).padStart(2, '0')}`;
    $('#inspector-body').innerHTML = [
      row('Tag', m.status.toUpperCase()),
      row('Item (SR id)', m.srId === null ? '–' : String(m.srId)),
      row('Parts', m.parts.length ? m.parts.join(', ') : 'empty'),
      row('At station', station ? `${station.id} (${STATUS_TEXT[station.status]})` : '–'),
      row('Speed', `${m.v.toFixed(3)} m/s`),
      row('Laps', String(m.laps)),
      row('Last lap', m.lastLap === null ? '–' : `${m.lastLap.toFixed(1)} s`),
      m.mark ? `<div class="mark"><span>Identifier</span><code>${m.mark}</code></div>` : '',
    ].join('');
  }

  addEvents(events: SimEvent[]): void {
    for (const e of events) {
      const entry = this.describe(e);
      if (entry) this.log.unshift(entry);
    }
    if (this.log.length > 12) this.log.length = 12;
    $('#log').innerHTML = this.log.map((l) => `<div class="${l.cls}"><time>${l.time}</time>${l.text}</div>`).join('');
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
        return { time: at(e.logged), text: `${short(e.process)}: ${e.message}${e.carrier ? ` (mover ${e.carrier})` : ''}`, cls: 'warn' };
      default:
        return null;
    }
  }
}
