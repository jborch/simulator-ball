// Turns the reporter status into what the HUD shows: a short word on the CATCH.AI chip and, when
// reporting isn't getting through, an alert that says what's wrong and what to do about it.
import type { ReporterProblem, ReporterStatus } from '../catchai/reporter';

export interface CatchAiView {
  /** Short status next to "CATCH.AI" in the top bar, or '' when all is well / off. */
  chip: string;
  /** Shown while there is a problem. */
  alert: { kind: ReporterProblem['kind']; title: string; detail: string; hint: string; meta: string[] } | null;
}

const HTTP_TEXT: Record<number, string> = {
  401: 'Unauthorized',
  403: 'Forbidden',
  408: 'Request Timeout',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export function describeCatchAi(s: Partial<ReporterStatus> | null, nowMs = Date.now()): CatchAiView {
  if (!s) return { chip: '', alert: null };
  if (s.state === 'connecting') return { chip: 'connecting…', alert: null };
  const p = s.problem;
  if (s.state !== 'error' || !p) return { chip: '', alert: null };

  const url = s.url ?? 'CATCH.AI';
  const http = p.status ? `HTTP ${p.status}${HTTP_TEXT[p.status] ? ` ${HTTP_TEXT[p.status]}` : ''}` : '';
  const retry = p.retryInMs === null ? '' : p.retryInMs < 1000 ? 'Retrying now…' : `Retrying in ${Math.ceil(p.retryInMs / 1000)} s.`;

  const meta: string[] = [`Since ${new Date(p.since).toLocaleTimeString()} (${ago(nowMs - p.since)}).`];
  if (s.queued) meta.push(`${s.queued.toLocaleString()} records waiting. They're sent when CATCH.AI is reachable again.`);
  if (s.dropped) meta.push(`${s.dropped.toLocaleString()} records dropped because the queue was full.`);

  switch (p.kind) {
    case 'config':
      return {
        chip: 'not configured',
        alert: {
          kind: p.kind,
          title: 'CATCH.AI reporting isn’t configured',
          detail: 'The server has no CATCH.AI API key, so no data is being sent.',
          hint: 'Set CATCHAI_API_KEY in the server’s environment (or .env.local) and restart the server.',
          meta: [],
        },
      };
    case 'unreachable':
      return {
        chip: 'no connection',
        alert: {
          kind: p.kind,
          title: 'No connection to CATCH.AI',
          detail: `The server can’t reach ${url}: ${reason(p.detail)}.`,
          hint: `Check the server’s network connection, firewall or proxy, and CATCHAI_URL. ${retry}`.trim(),
          meta,
        },
      };
    case 'auth':
      return {
        chip: 'key rejected',
        alert: {
          kind: p.kind,
          title: 'CATCH.AI rejected the API key',
          detail: `${url} answered ${http}.`,
          hint: `Check CATCHAI_API_KEY on the server. ${retry}`.trim(),
          meta,
        },
      };
    case 'server':
      return {
        chip: 'server error',
        alert: {
          kind: p.kind,
          title: 'CATCH.AI isn’t accepting data right now',
          detail: `${url} answered ${http}${extra(p.detail)}.`,
          hint: `This is usually temporary. ${retry}`.trim(),
          meta,
        },
      };
    case 'refused':
      return {
        chip: 'setup failed',
        alert: {
          kind: p.kind,
          title: 'CATCH.AI refused the line setup',
          detail: `${url} answered ${http}${extra(p.detail)}.`,
          hint: `${retry} If it keeps failing, the server log has the full request.`.trim(),
          meta,
        },
      };
  }
}

/** "GET /api/x: host name not found (DNS)" → "host name not found (DNS)". */
function reason(detail: string): string {
  const i = detail.indexOf(': ');
  return (i >= 0 ? detail.slice(i + 2) : detail).replace(/\.$/, '');
}

/** "GET /api/x failed: 503 Upstream down" → ": Upstream down" (the server's own words, if any). */
function extra(detail: string): string {
  const m = /failed: \d{3}\s*(.*)$/s.exec(detail);
  const text = (m ? m[1] : '').trim().replace(/\s+/g, ' ');
  if (!text || /^<!doctype|^<html/i.test(text)) return '';
  return `: ${text.length > 160 ? `${text.slice(0, 157)}…` : text}`;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
