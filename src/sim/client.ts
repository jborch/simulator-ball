import type { Command, Frame, ToClient, ToHost } from './protocol';
import type { SimEvent, SimState } from './types';

/**
 * Client side of the protocol. Today it talks to a local worker; a remote viewer would
 * implement the same interface over a network transport.
 */
export interface LineClient {
  send(command: Command): void;
  requestSnapshot(): void;
  onFrame?: (frame: Frame) => void;
  onEvents?: (events: SimEvent[]) => void;
  onSnapshot?: (state: SimState) => void;
}

export function connectLocal(origin = 'local'): LineClient {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const post = (m: ToHost) => worker.postMessage(m);
  const client: LineClient = {
    send: (command) => post({ type: 'command', command, origin }),
    requestSnapshot: () => post({ type: 'snapshot' }),
  };
  worker.onmessage = (e: MessageEvent<ToClient>) => {
    const m = e.data;
    if (m.type === 'frame') client.onFrame?.(m.frame);
    else if (m.type === 'events') client.onEvents?.(m.events);
    else client.onSnapshot?.(m.state);
  };
  return client;
}
