// Local Groth16 proving with snarkjs against the downloaded gatekeeper
// artifacts. Proving one decision takes ~0.1–1.5 s on this VM — far inside
// the 60 s platform deadline. Proves are serialized through a small queue:
// snarkjs proving is CPU-bound and the platform sends at most 8 tasks per
// round, so a queue can never build up dangerously.
import * as snarkjs from 'snarkjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCircuitInputs } from '../circuitInputs.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GATEKEEPER_WASM = path.join(ROOT, 'circuits', 'gatekeeper.wasm');
export const GATEKEEPER_ZKEY = path.join(ROOT, 'circuits', 'gatekeeper_final.zkey');
/** vk_hash registered on zkVerify mainnet (from /api/circuit-info). */
export const GATEKEEPER_VK_HASH = '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0';

export class ProofTimeoutError extends Error {}
export class WitnessError extends Error {}

export class GatekeeperProver {
  constructor({ saltSecret, proveTimeoutMs = 30_000 } = {}) {
    this.saltSecret = saltSecret;
    this.proveTimeoutMs = proveTimeoutMs;
    this.tail = Promise.resolve();
  }

  /** Build the circuit inputs for an envelope + decision (exposed for tests). */
  inputsFor(envelope, decision) {
    return buildCircuitInputs(envelope, decision, this.saltSecret);
  }

  /**
   * Generate { proof, publicSignals } for (envelope, decision).
   * Throws WitnessError when the circuit refuses the decision (its computed
   * verdict differs) and ProofTimeoutError past the configured budget.
   */
  async prove(envelope, decision) {
    const run = async () => {
      const inputs = this.inputsFor(envelope, decision);
      let timer;
      try {
        const timeout = new Promise((_, rej) => {
          timer = setTimeout(() => rej(new ProofTimeoutError(`proving exceeded ${this.proveTimeoutMs}ms`)), this.proveTimeoutMs);
        });
        const { proof, publicSignals } = await Promise.race([
          snarkjs.groth16.fullProve(inputs, GATEKEEPER_WASM, GATEKEEPER_ZKEY),
          timeout,
        ]);
        return { proof, publicSignals };
      } catch (e) {
        if (e instanceof ProofTimeoutError) throw e;
        throw new WitnessError(`witness/proof failed for decision=${decision}: ${String(e.message || e).slice(0, 300)}`);
      } finally {
        clearTimeout(timer);
      }
    };
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => {});
    return result;
  }
}
