// Check: the recipient committed in the proof matches the recipient on the
// payment condition (recipient === condition_recipient). Otherwise the
// payment would go to the wrong party (RECIPIENT_MISMATCH, ~6% of tasks).
// Address comparison is case-insensitive hex.
import { fail, normHex, pass } from './util.js';

export function checkRecipient(input) {
  const recipient = normHex(input.recipient);
  const condition = normHex(input.condition_recipient);
  if (!recipient || !condition || recipient !== condition) return fail('RECIPIENT_MISMATCH');
  return pass();
}
