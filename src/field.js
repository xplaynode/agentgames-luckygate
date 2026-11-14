// Field-element conversion helpers for the BN128 (alt_bn128) scalar field,
// plus a Keccak-256 implementation re-exported from @noble/hashes (already a
// snarkjs dependency — no new packages).
//
// IMPORTANT (see SPEC-NOTES.md): the platform docs never state how task
// fields are encoded as circuit field elements. The conversions here are the
// canonical ones (integer value of the hex/decimal string, reduced mod p —
// exactly what circom's witness calculator does to oversized inputs) and are
// isolated in this module so practice-mode feedback can correct them in one
// place.
import { keccak_256 as nobleKeccak256 } from '@noble/hashes/sha3.js';

/** BN128 scalar field prime. */
export const FIELD_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Reduce any integer-like value into the field, returned as a decimal string (snarkjs input format). */
export function toField(value) {
  let v;
  if (typeof value === 'bigint') v = value;
  else if (typeof value === 'number') v = BigInt(value);
  else if (typeof value === 'string') {
    const s = value.trim();
    v = s.startsWith('0x') || s.startsWith('0X') ? BigInt(s) : BigInt(s);
  } else if (value instanceof Uint8Array) {
    v = BigInt('0x' + Buffer.from(value).toString('hex'));
  } else {
    throw new TypeError(`cannot convert ${typeof value} to a field element`);
  }
  const r = v % FIELD_PRIME;
  return (r < 0n ? r + FIELD_PRIME : r).toString(10);
}

/** "0x7d3a..." (any length hex) -> field element decimal string. */
export function hexToField(hex) {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(hex.trim())) {
    throw new TypeError(`expected a 0x-prefixed hex string, got: ${hex}`);
  }
  return toField(BigInt(hex.trim()));
}

/** An EVM-style address -> field element decimal string (the integer value of the address). */
export function addressToField(address) {
  return hexToField(address);
}

/** Decimal string / number (amounts, blocks) -> field element decimal string. */
export function decimalToField(value) {
  return toField(value);
}

const encoder = new TextEncoder();

/** UTF-8 encode a string (ethers-style helper name kept for readability). */
export function toUtf8Bytes(str) {
  return encoder.encode(str);
}

/** Keccak-256 digest of bytes, returned as a Uint8Array. */
export function keccak256(bytes) {
  return nobleKeccak256(bytes);
}

/** A string task id -> field element via keccak256(utf8(id)) mod p. Default taskId encoding (see SPEC-NOTES). */
export function taskIdToField(taskId) {
  return toField(keccak256(toUtf8Bytes(String(taskId))));
}
