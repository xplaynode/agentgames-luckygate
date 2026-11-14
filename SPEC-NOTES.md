# SPEC-NOTES — what the platform docs pin down, and what they don't

Sources read in full on 2026-11-14: `agentgames.zkverify.io/build`,
`/events/proof-gatekeeper`, `/guide`, `/rules`, `/api/circuit-info`.
Everything in the "pinned" list is implemented verbatim. Each "open" item
states the assumption this codebase makes and how to confirm it.

## Pinned by the docs (implemented as written)

- Envelope: `POST` to the registered path; fields `type`
  (`agent-games.proof-gatekeeper.v1`), `task_id`, `mode`, `issued_at`,
  `deadline_at`, `input{ registered_vk, proof_vk, minimum, public_balance,
  expiry_block, current_block, recipient, condition_recipient, amount,
  max_transfer, proof_tx }`.
- Response: `{ decision, reason_code, proof_tx }`, plus `proof` +
  `public_signals` on every provable task (starter prompt's response shape);
  `proof_tx` echoes the task's incoming proof reference (both published
  samples do this). PROOF_REUSED responses carry no proof (event page:
  reused tasks "have no proof to submit and are excluded").
- Reason codes: `VALID_CONDITION`, `VK_SUBSTITUTION`, `THRESHOLD_MISMATCH`,
  `PROOF_REUSED`, `EXPIRED_CONDITION`, `RECIPIENT_MISMATCH`,
  `AMOUNT_OVERFLOW` — the trap encyclopedia's exact strings.
- Preflight: request type `agent-games.preflight.v1`; respond exactly
  `{ ok: true, protocolVersion: "v1" }`, signed.
- HMAC: verify `x-agent-games-signature` over the RAW body BEFORE parsing;
  sign every response over the raw response body. Secret is platform-issued
  (32-byte random, shown once at registration / on Rotate Secret), env var
  `AGENT_GAMES_HMAC_SECRET`.
- Rules: public HTTPS endpoint, no localhost/private IPs/**no custom ports**
  (the public URL must be on 443); task IDs are idempotency keys (retries
  must get the same response); offline at delivery = forfeit; practice
  capped at 10 dispatches/agent/hour; 60 s hard deadline; fail closed.
- Circuit: Groth16/BN128, Circom 2.x; gatekeeper vk_hash
  `0x6b79c6…77b0` registered on zkVerify mainnet (also in CIRCUITS.md).
- Kurier: base `https://api.kurier.xyz/api/v1`; `submit-proof/{apiKey}`
  body exactly as in the build guide; poll `job-status/{apiKey}/{jobId}`
  through Submitted → IncludedInBlock → Finalized.

## Established empirically against the real artifacts (npm test, section C)

- The circuit's 13 inputs and the `decision` encoding (1/0) — recovered and
  proven; see `circuits/CIRCUITS.md`. The circuit enforces its verdict on
  every documented dimension, including boundaries: threshold inclusive
  (`>=`), amount cap inclusive (`<=`), **expiry exclusive**
  (`current_block >= expiry_block` is expired). The last one was an
  assumption in `checks/expiry.js` until the circuit confirmed it.

## Open items — assumptions to confirm in practice mode

1. **Signature header encoding.** Docs never state whether
   `x-agent-games-signature` is bare hex or `sha256=`-prefixed. We accept
   bare hex (any case), a `sha256=` prefix, and base64 on the way in, and we
   emit bare lowercase hex. If preflight fails with a signature error, this
   is the first suspect — flip the emit format in `src/hmac.js`.
2. **taskId field encoding.** The circuit takes a `taskId` field element;
   task ids are strings like `gk_8d31_...`. We encode
   `keccak256(utf8(task_id)) mod p` (`src/field.js#taskIdToField`). If the
   platform derives it differently, our proofs still verify locally but the
   platform's expected public signals won't match — practice-mode feedback
   (proof marked invalid) would expose it immediately. Alternatives to try,
   in order: sha256 instead of keccak; the numeric suffix only; Poseidon.
3. **VK-hash → field conversion.** `registered_vk`/`proof_vk` arrive as
   32-byte hashes (> BN128 prime). We pass the integer through and let the
   witness calculator reduce mod p — the same reduction snarkjs applies
   everywhere, and the only self-consistent choice. Same practice-mode
   confirmation path as (2). The docs' samples show these fields TRUNCATED
   (`"0x7d...91"`); real tasks must carry full values for the circuit inputs
   to be computable at all — if a live task arrives truncated, field (2)/(3)
   handling needs the platform's actual derivation, which only the platform
   can supply.
4. **The private `salt`.** Nothing in the envelope carries a salt, and it
   never appears in public signals, so any field element is a valid witness.
   We derive it deterministically from the HMAC secret + task_id, which also
   makes retried tasks produce identical proofs. If the platform expects a
   specific salt (e.g. derived from the task), only its re-verification of
   the public `output` signal could reveal that — the output is a hash over
   inputs+salt, and the platform cannot recompute it without knowing the
   salt, so it almost certainly treats the output as opaque.
5. **Incoming-proof finality lookup.** The checklist says verification must
   reach Finalized before approval, but Kurier's documented REST surface has
   no lookup by an arbitrary `proof_tx` (job-status needs our own jobId),
   and no trap in the catalogue is "unfinalized proof" — every trap's proof
   "verifies on-chain". `KurierVerifier.lookupIncomingProof` therefore
   reports *unknown*, which the engine treats as pass (structural checks
   decide). A verifier that CAN observe the chain (zkVerifyJS) can return
   `finalized: false` and the engine will fail closed with the internal
   reason code `PROOF_NOT_FINALIZED` (the docs name no code for this case).
6. **Internal reason codes** that exist only so fail-closed branches have
   deterministic labels, for situations the documented task generator never
   produces: `INVALID_ENVELOPE`, `STALE_TASK`, `PROOF_NOT_FINALIZED`,
   `CIRCUIT_DISAGREEMENT`, `INTERNAL_TIMEOUT`. If one ever appears in a live
   response, treat it as a bug report against our assumptions, not a score
   play.
7. **Health-check shape.** Entry requirements mention "a passing health
   check" without specifying path or payload. We answer 200 JSON
   `{ ok: true, ... }` on `/`, `/health`, `/healthz`, and the agent path
   itself (GET). If the platform's checker wants something else, preflight
   debugging will show it.
8. **Kurier submission of our response proof** is implemented as a
   best-effort, non-blocking audit trail: the response already carries the
   proof the platform re-verifies, and zkVerify finalization latency is not
   ours to spend inside a 60 s deadline. Job ids are persisted
   (`data/state.json`) for disputes, per the build guide's readiness list.
