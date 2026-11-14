// HTTP transport for the Agent Games agent.
//   - HMAC-SHA256 over the RAW request body, verified BEFORE JSON parsing,
//     constant-time (src/hmac.js). Bad signature -> 401.
//   - Preflight: { type: "agent-games.preflight.v1" } -> signed
//     { ok: true, protocolVersion: "v1" }.
//   - Gatekeeper tasks: delegated to src/handler.js; every response signed
//     with x-agent-games-signature over the raw response body.
//   - Health: GET /, /health, /healthz and the agent path answer 200 JSON.
//   - Fail closed: a task that somehow exceeds the response budget gets a
//     signed REJECT rather than silence (silence is a −2 timeout AND loses
//     the decision points).
import http from 'node:http';
import { loadConfig } from './config.js';
import { signBody, verifyBody, SIGNATURE_HEADER } from './hmac.js';
import { StateStore } from './seenStore.js';
import { GatekeeperProver } from './proof/prover.js';
import { createVerifier } from './proof/verifier.js';
import { createTaskHandler } from './handler.js';

const MAX_BODY_BYTES = 1_000_000;

export function buildServer(config = loadConfig(), deps = {}) {
  const store = deps.store || new StateStore(config.stateFile);
  const verifier = deps.verifier || createVerifier(config);
  const prover = deps.prover || new GatekeeperProver({ saltSecret: config.saltSecret, proveTimeoutMs: config.proveTimeoutMs });
  const handler = createTaskHandler({ store, verifier, prover, config });

  function sendSigned(res, status, bodyString) {
    res.writeHead(status, {
      'content-type': 'application/json',
      [SIGNATURE_HEADER]: signBody(bodyString, config.hmacSecret),
    });
    res.end(bodyString);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET') {
        if (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/healthz' || url.pathname === config.agentPath) {
          const body = JSON.stringify({
            ok: true,
            service: 'agent-games-gatekeeper',
            protocolVersion: 'v1',
            verifierMode: config.verifierMode,
            secretConfigured: !config.usingPlaceholderSecret,
          });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(body);
          return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      if (req.method !== 'POST' || url.pathname !== config.agentPath) {
        sendSigned(res, 404, JSON.stringify({ error: 'not_found' }));
        return;
      }

      // Read the raw body first — the signature covers these exact bytes.
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          sendSigned(res, 413, JSON.stringify({ error: 'body_too_large' }));
          return;
        }
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks);

      if (!verifyBody(rawBody, req.headers[SIGNATURE_HEADER], config.hmacSecret)) {
        sendSigned(res, 401, JSON.stringify({ error: 'invalid_signature' }));
        return;
      }

      let envelope;
      try {
        envelope = JSON.parse(rawBody.toString('utf8'));
      } catch {
        sendSigned(res, 400, JSON.stringify({ error: 'invalid_json' }));
        return;
      }

      if (envelope?.type === 'agent-games.preflight.v1') {
        sendSigned(res, 200, JSON.stringify({ ok: true, protocolVersion: 'v1' }));
        return;
      }

      if (envelope?.type === 'agent-games.proof-gatekeeper.v1') {
        let timer;
        const budget = new Promise((resolve) => {
          timer = setTimeout(() => resolve('__timeout__'), config.responseBudgetMs);
        });
        const result = await Promise.race([handler.handleGatekeeperTask(envelope), budget]);
        clearTimeout(timer);
        if (result === '__timeout__') {
          console.error(`[agent] response budget exceeded for task ${envelope.task_id}; failing closed`);
          sendSigned(res, 200, JSON.stringify({
            decision: 'REJECT',
            reason_code: 'INTERNAL_TIMEOUT', // internal label; unreachable in practice (engine ~ms, proving ~1 s)
            proof_tx: envelope.input?.proof_tx,
          }));
          return;
        }
        sendSigned(res, 200, result);
        return;
      }

      sendSigned(res, 400, JSON.stringify({ error: 'unknown_type' }));
    } catch (e) {
      console.error('[agent] unhandled request error:', e);
      try {
        sendSigned(res, 500, JSON.stringify({ error: 'internal_error' }));
      } catch { /* socket already gone */ }
    }
  });
  return { server, store, verifier, prover };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  if (config.usingPlaceholderSecret) {
    console.warn('[agent] WARNING: no AGENT_GAMES_HMAC_SECRET set — using an empty-secret placeholder. Local tests will pass, but platform preflight WILL fail until the real secret from Rotate Secret is configured.');
  }
  const { server } = buildServer(config);
  server.listen(config.port, () => {
    console.log(`[agent] gatekeeper listening on :${config.port} path ${config.agentPath} (verifier: ${config.verifierMode})`);
  });
}
