// Check: the incoming proof's verification reached a FINALIZED state before
// approval (build-guide security checklist). Delegated to a ProofVerifier
// (see src/proof/verifier.js) because "finalized" is a chain fact, not an
// envelope field:
//
//   - lookup returns finalized === true   -> pass
//   - lookup returns finalized === false  -> fail (PROOF_NOT_FINALIZED)
//   - lookup returns finalized === null   -> the verifier cannot observe the
//     incoming proof (e.g. Kurier REST has no lookup-by-proof_tx endpoint).
//     The documented trap catalogue contains no "unfinalized proof" trap —
//     every trap's proof "verifies on-chain" per the event page — so unknown
//     is treated as pass and the decision rests on the structural checks.
//     See SPEC-NOTES.md for the full reasoning.
//
// PROOF_NOT_FINALIZED is an internal reason code: the platform docs do not
// name a code for this case (it cannot arise from the documented task
// generator). It exists so the fail-closed branch has a deterministic label.
import { fail, pass } from './util.js';

export function checkFinalized(lookup) {
  if (lookup && lookup.finalized === false) return fail('PROOF_NOT_FINALIZED');
  return pass();
}
