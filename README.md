# Agent Games — Proof Gatekeeper agent

A production-shaped agent endpoint for the zkVerify **Agent Games**
(Proof Gatekeeper track), built to the platform's published spec
(`agentgames.zkverify.io/build`, `/guide`, `/rules`, event page).

The platform POSTs signed payment-decision tasks to this endpoint. For each
task the agent returns exactly one deterministic decision (`APPROVE` /
`REJECT` + reason code) and a locally generated Groth16 proof of that
decision, which the platform re-verifies against its registered key. The
circuit refuses to prove a wrong decision in either direction — and this
agent mirrors the same rules in deterministic code, failing closed on any
uncertainty.

## Quick start (local)

```bash
npm install
AGENT_GAMES_HMAC_SECRET=local-dev-secret npm start   # listens on :8080, path /agent
npm test                                             # 48 assertions, sections A–E
```

Without a real secret the server runs with a loud warning — fine for local
tests, but platform preflight will (correctly) fail until
`AGENT_GAMES_HMAC_SECRET` holds the value from the dashboard's
**Rotate Secret**.

## Layout

- `src/server.js` — HTTP transport: raw-body HMAC verification before
  parsing, preflight responder, signed responses, health endpoints,
  fail-closed timeout path.
- `src/handler.js` — task pipeline: idempotent replay → engine → proving →
  circuit-override safety net → response.
- `src/engine.js` + `src/checks/` — the decision rules, one module per check
  (VK match, proof reuse, threshold, recipient, expiry, amount cap,
  finality, envelope validity).
- `src/proof/` — snarkjs prover over the real circuit artifacts, the Kurier
  REST client (submit + poll to Finalized), and the `ProofVerifier`
  interface with mock + Kurier implementations.
- `src/seenStore.js` — persistent proof_tx seen-set (reuse tripwire),
  task_id response cache (idempotency), Kurier job records (disputes).
- `circuits/` — downloaded gatekeeper WASM + zkey + exported VK
  (see `circuits/CIRCUITS.md` for hashes and the recovered signal list).
- `fixtures/` — synthetic envelopes for all 7 documented trap types plus
  valid and boundary cases.
- `tests/run-tests.js` — unit, engine, circuit-consistency, Kurier-client
  and signed end-to-end tests. All pass locally with the mock verifier.
- `SPEC-NOTES.md` — what the platform docs pin down vs. what they leave
  open, and the assumptions made for each gap.
- `SETUP-NEEDS.md` — what a human still has to do (Kurier key, hosting,
  dashboard steps) before this can compete.

## Scoring alignment

Correct decision +12 · wrong approve −6 · wrong reject −3 · timeout −2 ·
missing/invalid proof −2 · reliability bonus up to +5. The design spends its
complexity exactly where the points are: never miss the 60 s deadline
(proving takes ~1 s), never approve a trap (seven explicit checks, all
mirrored by the circuit), and attach a valid proof to every provable task
(PROOF_REUSED tasks are excluded from proof submission by the rules).
