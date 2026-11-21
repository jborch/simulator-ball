import type { ReporterStatus } from '../catchai/reporter';
import type { Command, Frame, ToClient, ToHost } from './protocol';
import type { SimEvent, SimState } from './types';

export type ConnectionState = 'connecting' | 'open' | 'closed';

/** Viewer side of the protocol: the simulation runs on the server and streams here. */
export interface LineClient {
  send(command: Command): void;
  requestSnapshot(): void;
  /** Turns CATCH.AI reporting on or off for the line (on the server, for every viewer). */
  setReporting(enabled: boolean): void;
  onConnection?: (state: ConnectionState) => void;
  onReporting?: (status: ReporterStatus | null) => void;
  onFrame?: (frame: Frame) => void;
  onEvents?: (events: SimEvent[]) => void;
  onSnapshot?: (state: SimState) => void;
}

const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 10_000;

/**
 * Connects to the server's /ws endpoint and reconnects with backoff when the connection drops.
 * Messages sent while disconnected are dropped (operator commands shouldn't fire late).
 */
export function connectRemote(origin: string, url = defaultUrl()): LineClient {
  let ws: WebSocket | null = null;
  let retry = RETRY_MIN_MS;

  const post = (m: ToHost) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };
  const client: LineClient = {
    send: (command) => post({ type: 'command', command, origin }),
    requestSnapshot: () => post({ type: 'snapshot' }),
    setReporting: (enabled) => post({ type: 'catchai', enabled }),
  };

  const open = () => {
    client.onConnection?.('connecting');
    const sock = new WebSocket(url);
    ws = sock;
    sock.onopen = () => {
      retry = RETRY_MIN_MS;
      client.onConnection?.('open');
    };
    sock.onmessage = (e: MessageEvent<string>) => {
      const m = JSON.parse(e.data) as ToClient;
      if (m.type === 'frame') client.onFrame?.(m.frame);
      else if (m.type === 'events') client.onEvents?.(m.events);
      else if (m.type === 'catchai') client.onReporting?.(m.status);
      else if (m.type === 'snapshot') client.onSnapshot?.(m.state);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      client.onConnection?.('closed');
      setTimeout(open, retry);
      retry = Math.min(retry * 2, RETRY_MAX_MS);
    };
  };
  open();
  return client;
}

function defaultUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/ws`;
}
