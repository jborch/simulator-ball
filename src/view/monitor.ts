// Monitoring-screen controls: pick one of the installed cameras (buttons or keys 1–6), and
// auto-hide the controls after a few seconds without input, like a video player, so the view
// reads as a clean camera feed. `?cam=<id>` picks the camera and `&ui=hidden` starts with auto-hide on
// (handy for a wall display).
import type * as THREE from 'three';
import type { LineConfig } from '../sim/config';
import { viewThrough } from './cameramounts';
import { CAMERAS, OVERVIEW, cameraPose } from './cameras';
import type { Stage } from './stage';

const IDLE_MS = 3000;
const AUTO_HIDE_KEY = 'ui.autoHide';
const CAMERA_KEY = 'ui.camera';

interface Choice {
  id: string;
  name: string;
  title: string;
}

export class Monitor {
  private readonly choices: Choice[] = [OVERVIEW, ...CAMERAS];
  /** Selected camera id, or null after the user moved the view by hand. */
  private active: string | null = OVERVIEW.id;
  private autoHide = false;
  private hidden = false;
  private idleTimer: number | undefined;
  /** Pointer is over a panel, or a form field has focus: don't hide under the user's hands. */
  private busy = false;

  constructor(
    private readonly cfg: LineConfig,
    private readonly stage: Stage,
    private readonly lineBounds: () => THREE.Box3,
    /** Width the side panel covers while the controls are shown. */
    private readonly sideInset: () => number,
  ) {
    const bar = document.querySelector<HTMLElement>('#camera-list')!;
    bar.innerHTML = this.choices
      .map((c, i) => `<button data-cam="${c.id}" title="${c.title} (key ${i + 1})"><kbd>${i + 1}</kbd>${c.name}</button>`)
      .join('');
    bar.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-cam]')?.dataset.cam;
      if (id) this.select(id);
    });
    document.querySelector('#autohide')!.addEventListener('click', () => this.setAutoHide(!this.autoHide));

    stage.onUserMove = () => {
      this.active = null;
      viewThrough(this.stage.camera, null);
      this.updateUi();
    };
    // The overview frames the line for the window's shape, so re-frame it when that changes.
    stage.onResize = () => {
      if (this.active === OVERVIEW.id) this.apply(OVERVIEW.id);
    };

    addEventListener('keydown', (e) => {
      this.activity();
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= this.choices.length) this.select(this.choices[n - 1].id);
      else if (e.key === 'h' || e.key === 'H') this.setAutoHide(!this.autoHide);
    });
    for (const ev of ['pointermove', 'pointerdown', 'wheel', 'touchstart'] as const) addEventListener(ev, () => this.activity(), { passive: true });
    document.addEventListener('pointerover', (e) => {
      const over = !!(e.target as HTMLElement).closest?.('.panel');
      if (over !== this.busy) {
        this.busy = over;
        this.activity();
      }
    });
    document.addEventListener('focusin', () => this.activity());
    document.addEventListener('focusout', () => this.activity());

    const params = new URLSearchParams(location.search);
    const wanted = params.get('cam') ?? localStorage.getItem(CAMERA_KEY);
    this.select(this.choices.some((c) => c.id === wanted) ? wanted! : OVERVIEW.id, false);
    this.setAutoHide(params.get('ui') === 'hidden' || localStorage.getItem(AUTO_HIDE_KEY) === 'true', params.get('ui') !== 'hidden');
    if (params.get('ui') === 'hidden') this.hide(true);
    setInterval(() => this.updateClock(), 1000);
  }

  select(id: string, remember = true): void {
    this.active = id;
    if (remember) localStorage.setItem(CAMERA_KEY, id);
    this.apply(id);
    this.updateUi();
  }

  /** The side panel changed size (or the controls hid/showed): keep the view centred in the free area. */
  insetChanged(immediate = false): void {
    this.stage.setInsetRight(this.hidden ? 0 : this.sideInset(), immediate);
  }

  private apply(id: string): void {
    // Looking through a station camera: leave out its own mount (cameramounts.ts).
    viewThrough(this.stage.camera, CAMERAS.some((c) => c.id === id) ? id : null);
    if (id === OVERVIEW.id) {
      this.stage.view(this.stage.fitPose(this.lineBounds(), OVERVIEW.direction));
      return;
    }
    const cam = CAMERAS.find((c) => c.id === id);
    if (cam) this.stage.view(cameraPose(this.cfg, cam));
  }

  private setAutoHide(on: boolean, remember = true): void {
    this.autoHide = on;
    if (remember) localStorage.setItem(AUTO_HIDE_KEY, String(on));
    const btn = document.querySelector<HTMLElement>('#autohide')!;
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Auto-hide is on: the controls hide after 3 s without input and come back when you move the mouse (H)' : 'Hide the controls after 3 s without input (H)';
    this.activity();
  }

  /** Any input shows the controls and restarts the idle timer. */
  private activity(): void {
    if (this.hidden) this.hide(false);
    clearTimeout(this.idleTimer);
    if (this.autoHide && !this.busy && !isTyping(document.activeElement)) this.idleTimer = window.setTimeout(() => this.hide(true), IDLE_MS);
  }

  private hide(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    document.body.classList.toggle('ui-hidden', hidden);
    this.insetChanged();
    this.updateClock();
  }

  private updateUi(): void {
    for (const btn of document.querySelectorAll<HTMLElement>('#camera-list [data-cam]')) btn.setAttribute('aria-pressed', String(btn.dataset.cam === this.active));
    const i = this.choices.findIndex((c) => c.id === this.active);
    document.querySelector('#osd-cam')!.textContent = i >= 0 ? `CAM ${i + 1}` : 'FREE';
    document.querySelector('#osd-title')!.textContent = i >= 0 ? this.choices[i].title : 'Free view';
  }

  private updateClock(): void {
    if (this.hidden) document.querySelector('#osd-time')!.textContent = new Date().toLocaleString();
  }
}

function isTyping(el: EventTarget | Element | null): boolean {
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable) && (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'checkbox';
}
