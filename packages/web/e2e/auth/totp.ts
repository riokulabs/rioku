/**
 * Tiny RFC 6238 TOTP implementation for E2E — no dependency footprint.
 *
 * The daemon's `/auth/totp/setup` returns a base32 secret; we recompute the
 * 6-digit code at the current time and hand it back to `/auth/totp/verify`
 * (during enrollment) or `/auth/login` (during the TOTP challenge step).
 */
import { createHmac } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  const bits: number[] = [];
  for (const c of clean) {
    const v = BASE32_ALPHABET.indexOf(c);
    if (v < 0) throw new Error(`Invalid base32 char: ${c}`);
    for (let i = 4; i >= 0; i -= 1) {
      bits.push((v >> i) & 1);
    }
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j += 1) {
      b = (b << 1) | (bits[i + j] ?? 0);
    }
    bytes.push(b);
  }
  return Buffer.from(bytes);
}

/**
 * Compute the current TOTP code (6 digits, SHA-1, 30-s window).
 *
 * @param secretBase32 - base32-encoded shared secret returned by the daemon.
 * @param at - optional timestamp (defaults to now).
 */
export function totp(secretBase32: string, at: Date = new Date()): string {
  const counter = Math.floor(at.getTime() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));

  const key = base32Decode(secretBase32);
  const mac = createHmac('sha1', key).update(buf).digest();
  const offset = mac.readUInt8(mac.length - 1) & 0x0f;
  const code =
    (((mac.readUInt8(offset) & 0x7f) << 24) |
      ((mac.readUInt8(offset + 1) & 0xff) << 16) |
      ((mac.readUInt8(offset + 2) & 0xff) << 8) |
      (mac.readUInt8(offset + 3) & 0xff)) %
    1_000_000;
  return code.toString().padStart(6, '0');
}
