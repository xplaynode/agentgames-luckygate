// Check: the proof's verification key matches the key registered for this
// condition (registered_vk === proof_vk). A substituted VK means the proof
// attests to a DIFFERENT statement than the condition requires — the classic
// VK_SUBSTITUTION trap (~13% of tasks). Comparison is exact after hex
// normalization; these are key identifiers, not quantities, so no tolerance.
import { fail, normHex, pass } from './util.js';

export function checkVkMatch(input) {
  const registered = normHex(input.registered_vk);
  const proof = normHex(input.proof_vk);
  if (!registered || !proof || registered !== proof) return fail('VK_SUBSTITUTION');
  return pass();
}
