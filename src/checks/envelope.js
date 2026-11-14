// Check: envelope structure + task signature/timestamp validity.
// (The HMAC signature itself is verified at the transport layer before this
// runs — see server.js. This module validates the envelope's shape and that
// its timestamps describe a live task: issued in the past, deadline not yet
// passed. Fail closed on anything unparseable.)
import { fail, pass, toBigIntOrNull } from './util.js';

export const REQUIRED_INPUT_FIELDS = [
  'registered_vk', 'proof_vk', 'minimum', 'public_balance',
  'expiry_block', 'current_block', 'recipient', 'condition_recipient',
  'amount', 'max_transfer', 'proof_tx',
];

export function checkEnvelope(envelope, now = new Date()) {
  if (!envelope || typeof envelope !== 'object') return fail('INVALID_ENVELOPE');
  if (envelope.type !== 'agent-games.proof-gatekeeper.v1') return fail('INVALID_ENVELOPE');
  if (typeof envelope.task_id !== 'string' || envelope.task_id.length === 0) return fail('INVALID_ENVELOPE');
  const input = envelope.input;
  if (!input || typeof input !== 'object') return fail('INVALID_ENVELOPE');
  for (const f of REQUIRED_INPUT_FIELDS) {
    if (input[f] === undefined || input[f] === null || input[f] === '') return fail('INVALID_ENVELOPE');
  }
  for (const f of ['minimum', 'public_balance', 'amount', 'max_transfer']) {
    if (toBigIntOrNull(input[f]) === null) return fail('INVALID_ENVELOPE');
  }
  for (const f of ['expiry_block', 'current_block']) {
    if (toBigIntOrNull(input[f]) === null) return fail('INVALID_ENVELOPE');
  }
  const issued = Date.parse(envelope.issued_at);
  const deadline = Date.parse(envelope.deadline_at);
  if (Number.isNaN(issued) || Number.isNaN(deadline)) return fail('INVALID_ENVELOPE');
  if (deadline <= issued) return fail('INVALID_ENVELOPE');
  // A task whose deadline has already passed cannot be answered in time;
  // fail closed rather than approve stale work.
  if (now.getTime() > deadline) return fail('STALE_TASK');
  return pass();
}
