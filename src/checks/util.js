// Shared helpers for the check modules.

/** Normalize a hex string for comparison (case/whitespace-insensitive). */
export function normHex(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/** Parse a decimal/hex integer string to BigInt; null when unparseable. */
export function toBigIntOrNull(v) {
  try {
    if (typeof v === 'number') return Number.isInteger(v) ? BigInt(v) : null;
    if (typeof v === 'string') return BigInt(v.trim());
    return null;
  } catch {
    return null;
  }
}

export const pass = () => ({ pass: true });
export const fail = (reasonCode) => ({ pass: false, reasonCode });
