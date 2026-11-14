// ProofVerifier: the seam between the decision engine / handler and zkVerify.
//
// Two responsibilities live behind this interface:
//   lookupIncomingProof(proofTx) — is the task's incoming proof finalized?
//     Returns { found, finalized } where finalized === null means "this
//     verifier cannot observe incoming proofs" (see checks/finalized.js).
//   submitOurProof({proof, publicSignals, vkHash}) — submit OUR response
//     proof to zkVerify and track it to Finalized; used as an on-chain audit
//     trail (the response itself already carries the proof; the platform
//     re-verifies it against its own registered key).
//
// MockVerifier powers the local test harness. KurierVerifier is the real
// implementation once KURIER_API_KEY exists. NOTE (documented gap): Kurier's
// REST API exposes job-status only for jobs WE submitted — there is no
// lookup-by-proof_tx endpoint in the public docs — so KurierVerifier reports
// incoming finality as unknown (null). Confirming an arbitrary incoming
// proof_tx on-chain would need zkVerifyJS + a chain query; see SPEC-NOTES.md.
import { KurierClient } from './kurier.js';

export class MockVerifier {
  constructor() {
    this.incoming = new Map(); // proofTx -> { found, finalized }
    this.submitted = [];
  }

  setIncoming(proofTx, result) {
    this.incoming.set(proofTx, result);
  }

  async lookupIncomingProof(proofTx) {
    // Fixtures default to a genuine, finalized on-chain proof — matching the
    // event page, where every documented trap's proof "verifies on-chain".
    return this.incoming.get(proofTx) || { found: true, finalized: true, source: 'mock' };
  }

  async submitOurProof({ proof, publicSignals, vkHash }) {
    const jobId = `mock_job_${this.submitted.length + 1}`;
    this.submitted.push({ jobId, proof, publicSignals, vkHash });
    return { jobId, status: 'Finalized', source: 'mock' };
  }
}

export class KurierVerifier {
  constructor({ apiKey, baseUrl } = {}) {
    this.client = new KurierClient({ apiKey, baseUrl });
  }

  async lookupIncomingProof(_proofTx) {
    return { found: null, finalized: null, source: 'kurier', note: 'no lookup-by-proof_tx endpoint in the Kurier REST docs' };
  }

  async submitOurProof({ proof, publicSignals, vkHash }) {
    const job = await this.client.submitProof({ proof, publicSignals, vkHash });
    const jobId = job?.jobId || job?.job_id || job?.id;
    if (!jobId) throw new Error(`Kurier submit-proof returned no jobId: ${JSON.stringify(job).slice(0, 200)}`);
    const final = await this.client.waitForFinalized(jobId);
    return { jobId, status: final.status, source: 'kurier', txHash: final.txHash || final.extrinsicHash || null };
  }
}

export function createVerifier(config) {
  if (config.verifierMode === 'kurier') {
    if (!config.kurierApiKey) throw new Error('VERIFIER_MODE=kurier requires KURIER_API_KEY');
    return new KurierVerifier({ apiKey: config.kurierApiKey, baseUrl: config.kurierBaseUrl });
  }
  return new MockVerifier();
}
