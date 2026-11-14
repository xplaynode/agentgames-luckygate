// Kurier REST client (zkVerify's hosted relay). API shape taken verbatim from
// the Agent Games build guide and docs.zkverify.io:
//   POST {base}/register-vk/{apiKey}
//   POST {base}/submit-proof/{apiKey}
//   GET  {base}/job-status/{apiKey}/{jobId}
// Status flow: Queued -> Valid -> Submitted -> IncludedInBlock -> Finalized
// (or Failed). The API key travels in the URL path per the official examples —
// never log a full Kurier URL.
export class KurierError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const TERMINAL_OK = 'Finalized';
const TERMINAL_BAD = new Set(['Failed', 'Invalid', 'Error']);

export class KurierClient {
  constructor({ apiKey, baseUrl = 'https://api.kurier.xyz/api/v1', fetchImpl = fetch } = {}) {
    if (!apiKey) throw new KurierError('KURIER_API_KEY is not set');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetch = fetchImpl;
  }

  async #request(method, pathSuffix, body) {
    const url = `${this.baseUrl}/${pathSuffix}/${this.apiKey}`;
    let res;
    try {
      res = await this.fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new KurierError(`Kurier request failed (${method} ${pathSuffix}): ${e.message}`);
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* leave null */ }
    if (!res.ok) {
      throw new KurierError(`Kurier ${method} ${pathSuffix} answered HTTP ${res.status}`, {
        status: res.status,
        body: text.slice(0, 500),
      });
    }
    return json;
  }

  /** Register a verification key once (not needed for the gatekeeper circuit — its VK is already registered on mainnet — but part of the documented flow). */
  async registerVk({ proofType = 'groth16', proofOptions, vk }) {
    return this.#request('POST', 'register-vk', { proofType, proofOptions, vk });
  }

  /**
   * Submit a Groth16 proof for verification against an already-registered VK.
   * Body shape is the build guide's own example, field for field.
   * @returns the job object (contains jobId).
   */
  async submitProof({ proof, publicSignals, vkHash }) {
    return this.#request('POST', 'submit-proof', {
      proofType: 'groth16',
      vkRegistered: true,
      proofOptions: { library: 'snarkjs', curve: 'bn128' },
      proofData: { proof, publicSignals, vk: vkHash },
    });
  }

  async getJobStatus(jobId) {
    const url = `${this.baseUrl}/job-status/${this.apiKey}/${jobId}`;
    let res;
    try {
      res = await this.fetch(url);
    } catch (e) {
      throw new KurierError(`Kurier job-status request failed: ${e.message}`);
    }
    const text = await res.text();
    if (!res.ok) throw new KurierError(`Kurier job-status answered HTTP ${res.status}`, { status: res.status, body: text.slice(0, 500) });
    return JSON.parse(text);
  }

  /** Poll a job until Finalized (or a terminal failure / timeout). */
  async waitForFinalized(jobId, { timeoutMs = 240_000, pollMs = 3_000 } = {}) {
    const started = Date.now();
    let last = null;
    for (;;) {
      last = await this.getJobStatus(jobId);
      const status = last?.status;
      if (status === TERMINAL_OK) return last;
      if (TERMINAL_BAD.has(status)) {
        throw new KurierError(`Kurier job ${jobId} ended in status ${status}`, { body: JSON.stringify(last).slice(0, 500) });
      }
      if (Date.now() - started > timeoutMs) {
        throw new KurierError(`Kurier job ${jobId} not finalized within ${timeoutMs}ms (last status: ${status})`);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}
