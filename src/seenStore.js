// Persistent agent state:
//   - seen proof references (proof_tx) — the PROOF_REUSED tripwire. The event
//     page says "reject and record the reference as seen", so every evaluated
//     task's proof_tx is recorded, whatever the verdict.
//   - idempotent responses by task_id — the platform rules state task IDs are
//     idempotency keys and the platform may retry after a network failure, so
//     a retried task_id must get the byte-identical response, not a fresh
//     evaluation (which would also falsely trip the reuse check).
//   - Kurier job ids for our own submitted proofs (retained for disputes —
//     build-guide readiness item 09).
//
// Storage is a single JSON file written through synchronously; task volume is
// tiny (8 tasks/round). The in-memory maps are the source of truth at runtime.
import fs from 'node:fs';
import path from 'node:path';

const MAX_CACHED_RESPONSES = 1000;

export class StateStore {
  constructor(file) {
    this.file = file;
    this.seenProofTx = new Map(); // proofTx -> { taskId, at }
    this.responses = new Map(); // taskId -> serialized response body (string)
    this.kurierJobs = new Map(); // taskId -> { jobId, status, at }
    this.#load();
  }

  #load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [k, v] of Object.entries(raw.seenProofTx || {})) this.seenProofTx.set(k, v);
      for (const [k, v] of Object.entries(raw.responses || {})) this.responses.set(k, v);
      for (const [k, v] of Object.entries(raw.kurierJobs || {})) this.kurierJobs.set(k, v);
    } catch { /* fresh state */ }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const data = {
      seenProofTx: Object.fromEntries(this.seenProofTx),
      responses: Object.fromEntries(this.responses),
      kurierJobs: Object.fromEntries(this.kurierJobs),
    };
    fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
  }

  hasSeenProofTx(proofTx) {
    return this.seenProofTx.has(proofTx);
  }

  recordProofTx(proofTx, taskId) {
    if (!this.seenProofTx.has(proofTx)) {
      this.seenProofTx.set(proofTx, { taskId, at: new Date().toISOString() });
      this.#save();
    }
  }

  getResponse(taskId) {
    return this.responses.get(taskId);
  }

  putResponse(taskId, serializedBody) {
    this.responses.set(taskId, serializedBody);
    while (this.responses.size > MAX_CACHED_RESPONSES) {
      this.responses.delete(this.responses.keys().next().value);
    }
    this.#save();
  }

  recordKurierJob(taskId, job) {
    this.kurierJobs.set(taskId, { ...job, at: new Date().toISOString() });
    this.#save();
  }
}
