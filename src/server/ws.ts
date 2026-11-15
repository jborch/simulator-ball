// WebSocket endpoint at /ws: each connection is one viewer of the shared line.
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { LineHost } from './host';
import { parseToHost } from './validate';

export const WS_PATH = '/ws';

/** Above this much unsent data, frames are skipped for that viewer. */
const SKIP_FRAMES_BYTES = 1 << 20;
/** Above this, the viewer is too far behind to catch up and is disconnected. */
const DROP_BYTES = 16 << 20;
const MAX_MESSAGE_BYTES = 64 << 10;
const PING_MS = 15_000;

/**
 * Handles upgrades to /ws on `server`. Other upgrade requests are left alone (in development
 * Vite's HMR socket shares the server) unless `exclusive` is set, in which case they're refused.
 */
export function attachLineSocket(server: Server, host: LineHost, opts: { exclusive?: boolean; log?: (msg: string) => void } = {}): WebSocketServer {
  const log = opts.log ?? (() => {});
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: { threshold: 1024 } });

  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== WS_PATH) {
      if (opts.exclusive) socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws, req) => {
    const who = `${req.socket.remoteAddress ?? '?'}`;
    let alive = true;
    const disconnect = host.connect({
      send(json, droppable) {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > DROP_BYTES) {
          log(`viewer ${who} too slow, disconnecting`);
          ws.terminate();
          return;
        }
        if (droppable && ws.bufferedAmount > SKIP_FRAMES_BYTES) return;
        ws.send(json);
      },
    });
    log(`viewer connected from ${who} (${host.viewerCount} connected)`);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const msg = parseToHost(data.toString());
      if (!msg) return;
      if (msg.type === 'command') host.command(msg.command, msg.origin);
      else if (msg.type === 'catchai') host.setReporting(msg.enabled);
      else host.snapshot({ send: (json) => ws.readyState === WebSocket.OPEN && ws.send(json) });
    });
    ws.on('pong', () => (alive = true));
    // Pings find viewers whose connection died without a close (laptop lid, network change).
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, PING_MS);
    ws.on('close', () => {
      clearInterval(ping);
      disconnect();
      log(`viewer ${who} disconnected (${host.viewerCount} connected)`);
    });
    ws.on('error', (err) => log(`viewer ${who} error: ${err.message}`));
  });

  return wss;
}
