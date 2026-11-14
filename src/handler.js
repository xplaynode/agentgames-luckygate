// Task pipeline: idempotency -> decision engine -> local proving -> response.
//
// The circuit is the ultimate referee. If the engine's decision cannot be
// proven (witness generation fails) but the OPPOSITE decision can, the
// circuit's computed verdict wins and the decision flips — this makes the
// agent robust to any boundary-semantics difference between this code and
// the circuit (e.g. whether expiry_block is inclusive). A correct decision
// without a proof still beats a timeout, so if proving fails both ways we
// answer with the engine's decision and no proof fields (cost: the −2
// missing-proof penalty instead of a possible −6/−3 wrong decision).
import { evaluateTask, REASON } from './engine.js';
import { GATEKEEPER_VK_HASH, WitnessError } from './proof/prover.js';

function deriveOverrideRejectReason(envelope) {
  // Engine said APPROVE (all checks passed) but the circuit only proves
  // REJECT: the disagreement must be a boundary case. Name the borderline
  // check; equality cases are the only ones where our >= / <= could differ
  // from the circuit's strictness.
  const i = envelope.input || {};
  try {
    if (BigInt(i.public_balance) === BigInt(i.minimum)) return REASON.THRESHOLD_MISMATCH;
    if (BigInt(i.amount) === BigInt(i.max_transfer)) return REASON.AMOUNT_OVERFLOW;
    if (BigInt(i.current_block) === BigInt(i.expiry_block)) return REASON.EXPIRED_CONDITION;
  } catch { /* fall through */ }
  // Undocumented fallback label; expected to be unreachable after practice
  // calibration. Logged loudly whenever it fires.
  return 'CIRCUIT_DISAGREEMENT';
}

export function createTaskHandler({ store, verifier, prover, config, logger = console }) {
  async function submitAuditProof(taskId, proofFields) {
    try {
      const res = await verifier.submitOurProof({
        proof: proofFields.proof,
        publicSignals: proofFields.publicSignals,
        vkHash: GATEKEEPER_VK_HASH,
      });
      store.recordKurierJob(taskId, res);
    } catch (e) {
      logger.error(`[agent] audit proof submission failed for ${taskId}: ${e.message}`);
    }
  }

  /**
   * Handle one gatekeeper envelope. Returns the exact serialized response
   * body (the server signs those bytes). Never throws for task-level
   * problems — fail closed instead.
   */
  async function handleGatekeeperTask(envelope) {
    const taskId = envelope.task_id;
    const cached = store.getResponse(taskId);
    if (cached !== undefined) return cached; // platform retry: byte-identical replay

    const verdict = await evaluateTask(envelope, { store, verifier });
    let { decision, reason_code } = verdict;
    let proofFields = null;

    // PROOF_REUSED tasks are excluded from proof submission (event page:
    // "PROOF_REUSED tasks have no proof to submit and are excluded").
    if (reason_code !== REASON.PROOF_REUSED) {
      try {
        proofFields = await prover.prove(envelope, decision);
      } catch (e) {
        if (e instanceof WitnessError) {
          const opposite = decision === 'APPROVE' ? 'REJECT' : 'APPROVE';
          try {
            proofFields = await prover.prove(envelope, opposite);
            logger.warn(`[agent] circuit override on ${taskId}: engine=${decision} -> circuit=${opposite}`);
            decision = opposite;
            reason_code = opposite === 'APPROVE' ? REASON.VALID : deriveOverrideRejectReason(envelope);
          } catch {
            logger.error(`[agent] proving failed both ways for ${taskId}; answering without proof`);
          }
        } else {
          logger.error(`[agent] proving error for ${taskId}: ${e.message}; answering without proof`);
        }
      }
    }

    const body = {
      decision,
      reason_code,
      proof_tx: envelope.input?.proof_tx,
      ...(proofFields ? { proof: proofFields.proof, public_signals: proofFields.publicSignals } : {}),
    };
    const serialized = JSON.stringify(body);
    store.putResponse(taskId, serialized);

    if (proofFields) {
      // On-chain audit trail via zkVerify (Kurier). Never blocks the response:
      // the 60 s deadline belongs to the platform, and the response already
      // carries the proof the platform re-verifies.
      void submitAuditProof(taskId, proofFields);
    }
    return serialized;
  }

  return { handleGatekeeperTask };
}
