// Thin fetch wrapper for the CATCH.AI REST API.

/** Used when CATCHAI_URL isn't set. */
export const DEFAULT_CATCHAI_URL = 'https://catchai-demo-axis-data.northeurope.cloudapp.azure.com';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }

  /** Worth retrying later (server down, overloaded, auth not yet configured), as opposed to a bad request. */
  get transient(): boolean {
    return this.status === 0 || this.status === 401 || this.status === 403 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

/** A request that gets no answer in this time counts as a connection failure. */
const TIMEOUT_MS = 30_000;

export class CatchAiApi {
  readonly url: string;

  /**
   * `url` is the server root.
   * `apiKey` is sent as x-api-key when given.
   */
  constructor(
    url: string,
    private readonly apiKey?: string,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
  ) {
    this.url = url.replace(/\/+$/, '');
  }

  get<T>(path: string): Promise<T> {
    return this.request('GET', path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request('POST', path, body);
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request('PUT', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.url}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new ApiError(`${method} ${path}: ${networkError(err)}`, 0, null);
    }
    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    // 207 (partial) and 422 (nothing inserted) on bulk endpoints carry a per-entry result.
    if (res.ok || (res.status === 422 && isBulk(data))) return data as T;
    const detail = typeof data === 'object' && data && 'detail' in data ? String((data as { detail: unknown }).detail) : text.slice(0, 300);
    throw new ApiError(`${method} ${path} failed: ${res.status} ${detail}`.trim(), res.status, data);
  }
}

/** fetch() only says "fetch failed"; the reason is in `cause`. Turns it into something readable. */
export function networkError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === 'TimeoutError') return `no answer within ${TIMEOUT_MS / 1000} s`;
  const cause = err.cause as { code?: string; message?: string } | undefined;
  const code = cause?.code ?? '';
  const known: Record<string, string> = {
    ENOTFOUND: 'host name not found (DNS)',
    EAI_AGAIN: 'host name lookup failed (DNS)',
    ECONNREFUSED: 'connection refused',
    ECONNRESET: 'connection reset',
    ETIMEDOUT: 'connection timed out',
    EHOSTUNREACH: 'host unreachable',
    ENETUNREACH: 'network unreachable',
    UND_ERR_CONNECT_TIMEOUT: 'connection timed out',
    UND_ERR_SOCKET: 'connection closed unexpectedly',
  };
  if (known[code]) return known[code];
  if (/CERT|SSL|TLS/i.test(code + (cause?.message ?? ''))) return `TLS/certificate problem${cause?.message ? ` (${cause.message})` : ''}`;
  return cause?.message ?? err.message;
}

function isBulk(data: unknown): boolean {
  return typeof data === 'object' && data !== null && 'InvalidEntries' in data;
}
