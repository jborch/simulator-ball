import type { CatchAiConnection, ConnectionStatus } from './connection';

export interface CatchAiConsole {
  connect(apiKey: string, url?: string): Promise<void>;
  disconnect(): void;
  status(): ConnectionStatus;
}

declare global {
  interface Window {
    catchai: CatchAiConsole;
  }
}

export function installConsoleApi(conn: CatchAiConnection): void {
  window.catchai = {
    connect: (apiKey, url) => conn.connect(apiKey, url),
    disconnect: () => conn.disconnect(),
    status: () => conn.status(),
  };
}

const LABELS: Record<ConnectionStatus['state'], string> = {
  off: 'CATCH.AI: off — run catchai.connect(apiKey) in the console',
  connecting: 'CATCH.AI: connecting',
  ok: 'CATCH.AI: sending',
  error: 'CATCH.AI: error',
};

export function bindStatusDot(el: HTMLElement, conn: CatchAiConnection): void {
  const update = () => {
    const s = conn.status();
    el.className = `dot ${s.state}`;
    const lines = [LABELS[s.state]];
    if (s.state !== 'off') lines.push(`${s.url} · ${s.deviceId}`, `queued: ${s.queued}, dropped: ${s.dropped}`);
    if (s.lastError) lines.push(s.lastError);
    el.title = lines.join('\n');
  };
  update();
  window.setInterval(update, 500);
}
