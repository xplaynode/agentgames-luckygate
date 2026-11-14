// The Gatekeeper decision engine: deterministic, fail-closed, no model in the
// loop (the build guide is explicit — "the model may recommend an action;
// deterministic code should enforce the final safety rules").
//
// Checks run in a fixed order and the FIRST failure decides the reason code.
// Order rationale: envelope sanity, then identity of the proof (VK), then
// replay, then the statement's economics (threshold, recipient, expiry,
// amount), then chain finality. Practice tasks carry exactly one trap each,
// so ordering only matters for multiply-broken inputs.
import { checkEnvelope } from './checks/envelope.js';
import { checkVkMatch } from './checks/vkMatch.js';
import { checkProofReuse } from './checks/proofReuse.js';
import { checkThreshold } from './checks/threshold.js';
import { checkRecipient } from './checks/recipient.js';
import { checkExpiry } from './checks/expiry.js';
import { checkAmountCap } from './checks/amountCap.js';
import { checkFinalized } from './checks/finalized.js';

export const REASON = Object.freeze({
  VALID: 'VALID_CONDITION',
  VK_SUBSTITUTION: 'VK_SUBSTITUTION',
  PROOF_REUSED: 'PROOF_REUSED',
  THRESHOLD_MISMATCH: 'THRESHOLD_MISMATCH',
  RECIPIENT_MISMATCH: 'RECIPIENT_MISMATCH',
  EXPIRED_CONDITION: 'EXPIRED_CONDITION',
  AMOUNT_OVERFLOW: 'AMOUNT_OVERFLOW',
});

/**
 * Evaluate one gatekeeper envelope.
 * @param {object} envelope parsed task envelope
 * @param {{store: object, verifier: object, now?: Date}} deps
 * @returns {Promise<{decision: 'APPROVE'|'REJECT', reason_code: string, checks: Array}>}
 * Side effect: the task's proof_tx is recorded in the seen-set (per the event
 * page: "reject and record the reference as seen" — recording happens for
 * every evaluated task so a later resubmission is caught).
 */
export async function evaluateTask(envelope, { store, verifier, now = new Date() }) {
  const input = (envelope && envelope.input) || {};
  const trail = [];
  const run = (name, result) => {
    trail.push({ check: name, pass: result.pass, ...(result.pass ? {} : { reasonCode: result.reasonCode }) });
    return result;
  };
  const reject = (reasonCode) => ({ decision: 'REJECT', reason_code: reasonCode, checks: trail });

  let r = run('envelope', checkEnvelope(envelope, now));
  if (!r.pass) return reject(r.reasonCode);

  r = run('vk_match', checkVkMatch(input));
  if (!r.pass) { store.recordProofTx(input.proof_tx, envelope.task_id); return reject(r.reasonCode); }

  r = run('proof_reuse', checkProofReuse(input, store));
  if (!r.pass) return reject(r.reasonCode); // already recorded by its first task

  r = run('threshold', checkThreshold(input));
  if (!r.pass) { store.recordProofTx(input.proof_tx, envelope.task_id); return reject(r.reasonCode); }

  r = run('recipient', checkRecipient(input));
  if (!r.pass) { store.recordProofTx(input.proof_tx, envelope.task_id); return reject(r.reasonCode); }

  r = run('expiry', checkExpiry(input));
  if (!r.pass) { store.recordProofTx(input.proof_tx, envelope.task_id); return reject(r.reasonCode); }

  r = run('amount_cap', checkAmountCap(input));
  if (!r.pass) { store.recordProofTx(input.proof_tx, envelope.task_id); return reject(r.reasonCode); }

  let lookup = null;
  try {
    lookup = await verifier.lookupIncomingProof(input.proof_tx);
  } catch {
    lookup = { finalized: null, note: 'verifier lookup threw; treated as unknown' };
  }
  r = run('finalized', checkFinalized(lookup));
  if (!r.pass) { store.recordProofTx(input.proof_tx, envelope.task_id); return reject(r.reasonCode); }

  store.recordProofTx(input.proof_tx, envelope.task_id);
  return { decision: 'APPROVE', reason_code: REASON.VALID, checks: trail };
}
