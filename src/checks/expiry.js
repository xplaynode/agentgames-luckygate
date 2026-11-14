// Check: the condition has not expired — the chain's current block must be
// strictly below expiry_block (EXPIRED_CONDITION, ~6% of tasks). An on-chain
// confirmation at a later block does not revive an expired payment window.
//
// BOUNDARY ASSUMPTION: expiry_block is treated as an exclusive upper bound
// (current_block == expiry_block counts as expired). The docs don't pin the
// boundary; failing closed is the stated platform philosophy, and the circuit
// override in the handler (see handler.js) rescues us if the circuit's own
// boundary semantics ever disagree with this module.
import { fail, pass, toBigIntOrNull } from './util.js';

export function checkExpiry(input) {
  const current = toBigIntOrNull(input.current_block);
  const expiry = toBigIntOrNull(input.expiry_block);
  if (current === null || expiry === null) return fail('EXPIRED_CONDITION');
  if (current >= expiry) return fail('EXPIRED_CONDITION');
  return pass();
}
