import { type RngState, random } from './rng';

const SERIAL_CHARS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** GS1 mod-10 check digit appended to a GTIN body. */
export function gtinWithCheck(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return body + String((10 - (sum % 10)) % 10);
}

function yymmdd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return p(d.getUTCFullYear() % 100) + p(d.getUTCMonth() + 1) + p(d.getUTCDate());
}

export interface Gs1Fields {
  gtin: string;
  expiry: string;
  batch: string;
  serial: string;
}

/**
 * Identifier in GS1 human-readable form, AIs in parentheses: (01) GTIN, (17) expiry, (10) batch, (21) serial.
 * Fixed-length AIs first and the serial last, so only one FNC1 separator is needed in the symbol.
 */
export function gs1Text(f: Gs1Fields): string {
  return `(01)${f.gtin}(17)${f.expiry}(10)${f.batch}(21)${f.serial}`;
}

export function makeIdentifier(rng: RngState, gtinBody: string, nowMs: number, expiryYears: number): string {
  const now = new Date(nowMs);
  const expiry = new Date(now);
  expiry.setUTCFullYear(now.getUTCFullYear() + expiryYears);
  let serial = '';
  for (let i = 0; i < 12; i++) serial += SERIAL_CHARS[Math.floor(random(rng) * SERIAL_CHARS.length)];
  return gs1Text({ gtin: gtinWithCheck(gtinBody), expiry: yymmdd(expiry), batch: 'B' + yymmdd(now), serial });
}
