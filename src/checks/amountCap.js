// Check: the requested amount does not exceed the condition's single-transfer
// cap (amount <= max_transfer). Over the cap is AMOUNT_OVERFLOW (~6% of
// tasks) even when the proof is valid for the stated balance: "Approve only
// up to the cap; reject the rest" — the response schema has no partial
// approval, so the whole task is rejected.
import { fail, pass, toBigIntOrNull } from './util.js';

export function checkAmountCap(input) {
  const amount = toBigIntOrNull(input.amount);
  const cap = toBigIntOrNull(input.max_transfer);
  if (amount === null || cap === null) return fail('AMOUNT_OVERFLOW');
  if (amount > cap) return fail('AMOUNT_OVERFLOW');
  return pass();
}
