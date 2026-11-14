// Envelope -> gatekeeper circuit inputs.
//
// The circuit's 13 input signals were recovered from the WASM's signal map
// (see tools/discover-signals.js) and confirmed by proving locally:
//   registeredVkHash, proofVkHash, minimum, publicBalance, expiryBlock,
//   currentBlock, recipient, conditionRecipient, amount, maxTransfer,
//   decision, taskId            (all public, size 1)
//   salt                        (private, size 1)
// Public signals come back as [output, ...those 12 public inputs in order].
//
// decision encoding (verified empirically against the artifacts):
//   1 = APPROVE, 0 = REJECT. The circuit asserts decision == its own computed
//   verdict: proving (valid task, REJECT) or (trap, APPROVE) fails witness
//   generation. handler.js relies on that as a safety net.
import { addressToField, decimalToField, hexToField, taskIdToField, toField, keccak256, toUtf8Bytes } from './field.js';

/** Deterministic per-task salt: keccak256("agentgames-salt:" + secret + ":" + taskId) mod p. */
export function deriveSalt(taskId, saltSecret) {
  const digest = keccak256(toUtf8Bytes(`agentgames-salt:${saltSecret}:${taskId}`));
  return toField(digest);
}

export function buildCircuitInputs(envelope, decision, saltSecret) {
  const input = envelope.input;
  return {
    registeredVkHash: hexToField(input.registered_vk),
    proofVkHash: hexToField(input.proof_vk),
    minimum: decimalToField(input.minimum),
    publicBalance: decimalToField(input.public_balance),
    expiryBlock: decimalToField(input.expiry_block),
    currentBlock: decimalToField(input.current_block),
    recipient: addressToField(input.recipient),
    conditionRecipient: addressToField(input.condition_recipient),
    amount: decimalToField(input.amount),
    maxTransfer: decimalToField(input.max_transfer),
    decision: decision === 'APPROVE' ? '1' : '0',
    taskId: taskIdToField(envelope.task_id),
    salt: deriveSalt(envelope.task_id, saltSecret),
  };
}
