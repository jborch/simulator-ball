import type { Device, DeviceData, EventDefinition, PropertyDefinition } from './types';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class CatchAiClient {
  readonly url: string;

  constructor(
    url: string,
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
  ) {
    this.url = url.replace(/\/+$/, '');
  }

  version(): Promise<unknown> {
    return this.request('GET', '/api/version');
  }

  getDevices(): Promise<Device[]> {
    return this.request('GET', '/api/device');
  }

  createDevice(device: Device): Promise<unknown> {
    return this.request('POST', '/api/device', device);
  }

  getProperties(): Promise<PropertyDefinition[]> {
    return this.request('GET', '/api/property');
  }

  createProperty(property: PropertyDefinition): Promise<unknown> {
    return this.request('POST', '/api/property', property);
  }

  getEvents(): Promise<EventDefinition[]> {
    return this.request('GET', '/api/event');
  }

  createEvent(event: EventDefinition): Promise<unknown> {
    return this.request('POST', '/api/event', event);
  }

  async postDeviceData(records: DeviceData[]): Promise<void> {
    await this.request('POST', '/api/deviceData', records);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.url}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'x-api-key': this.apiKey,
        'ngrok-skip-browser-warning': 'true',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        detail = JSON.parse(text).detail ?? text;
      } catch {
        // Non-JSON error body; use as-is.
      }
      throw new Error(`${method} ${path} failed: ${res.status} ${detail}`.trim());
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
