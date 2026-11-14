// Check: the public inputs prove the required threshold — the balance
// disclosed in the proof (public_balance) meets the condition's minimum.
// Below it, the statement the proof makes is simply false for this condition
// (THRESHOLD_MISMATCH, ~8% of tasks), however genuine the proof is.
import { fail, pass, toBigIntOrNull } from './util.js';

export function checkThreshold(input) {
  const balance = toBigIntOrNull(input.public_balance);
  const minimum = toBigIntOrNull(input.minimum);
  if (balance === null || minimum === null) return fail('THRESHOLD_MISMATCH');
  if (balance < minimum) return fail('THRESHOLD_MISMATCH');
  return pass();
}
