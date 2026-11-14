# Circuit artifacts — Proof Gatekeeper

Downloaded 2026-11-14 from the Agent Games build page (URLs also served by
`GET https://agentgames.zkverify.io/api/circuit-info`).

| file | source URL | bytes | sha256 |
|---|---|---|---|
| gatekeeper.wasm | https://agentgames.zkverify.io/circuits/gatekeeper.wasm | 1,755,820 | be00aefe3c8ba910951a242f50e55937bf82a0375ad4b69c2ef10629ab92764f |
| gatekeeper_final.zkey | https://agentgames.zkverify.io/circuits/gatekeeper_final.zkey | 309,750 | adfe95a439a7063a82a4967ef026d2dd6857a4d02c63b3caf63dac02e01af80d |

- Circuit: Groth16 / BN128, Circom 2.x (template `GatekeeperEvaluation`).
- **vk_hash registered on zkVerify mainnet:**
  `0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0`
- `gatekeeper_vk.json` in this folder is the verification key exported from
  the zkey (`snarkjs zkey export verificationkey`): protocol groth16, curve
  bn128, **nPublic = 13**.
- Input signals (recovered from the WASM signal map, see
  `tools/discover-signals.js`; every one size 1; `getInputSize()` = 13):
  public — `registeredVkHash`, `proofVkHash`, `minimum`, `publicBalance`,
  `expiryBlock`, `currentBlock`, `recipient`, `conditionRecipient`, `amount`,
  `maxTransfer`, `decision`, `taskId`; private — `salt`.
  Public signals are returned as `[output, ...the 12 public inputs]` where
  `output` is a binding hash over the inputs and the private salt.
- `decision`: **1 = APPROVE, 0 = REJECT** (confirmed empirically).
- The circuit asserts `decision == its own computed verdict`: with the real
  artifacts, (valid task, REJECT), (any documented trap, APPROVE) and both
  boundary disagreements fail witness generation, while every correct
  decision proves and verifies locally. Boundary semantics match this repo's
  engine: threshold is `publicBalance >= minimum`, cap is
  `amount <= maxTransfer`, expiry is expired iff `currentBlock >= expiryBlock`.
  Re-run `npm test` (section C) to re-verify all of this after any change.
