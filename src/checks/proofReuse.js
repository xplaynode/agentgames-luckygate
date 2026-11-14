// Check: the proof reference (proof_tx) has not already been used for
// another task. A valid proof does not gain re-entry by resubmission
// (PROOF_REUSED, ~11% of tasks). The caller (engine) consults the persistent
// seen-set; retries of the SAME task_id never reach this check because the
// idempotency cache answers them first (see seenStore.js).
import { fail, pass } from './util.js';

export function checkProofReuse(input, store) {
  if (store.hasSeenProofTx(input.proof_tx)) return fail('PROOF_REUSED');
  return pass();
}
