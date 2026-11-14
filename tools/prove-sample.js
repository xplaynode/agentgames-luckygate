// End-to-end proving experiment against the real gatekeeper artifacts.
// Builds circuit inputs from a synthetic VALID task and a VK_SUBSTITUTION
// trap, then checks:
//   1. a proof for (valid, decision=APPROVE) generates + verifies locally;
//   2. a proof for (trap, decision=REJECT) generates + verifies locally;
//   3. whether the circuit refuses (valid witness impossible) for
//      (trap, decision=APPROVE) — i.e. whether the circuit itself enforces
//      the decision rules, as the build guide claims ("the circuit is the
//      referee").
import * as snarkjs from 'snarkjs';
import fs from 'node:fs';
import { taskIdToField } from '../src/field.js';

const WASM = new URL('../circuits/gatekeeper.wasm', import.meta.url).pathname;
const ZKEY = new URL('../circuits/gatekeeper_final.zkey', import.meta.url).pathname;
const VK = JSON.parse(fs.readFileSync(new URL('../circuits/gatekeeper_vk.json', import.meta.url)));

// A full-length stand-in VK hash (the real registered gatekeeper vk hash).
const REGISTERED_VK = '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0';
const OTHER_VK = '0x13aa00000000000000000000000000000000000000000000000000000000aa13';
const RECIPIENT = '0xDe429f0100000000000000000000000000000001';

function baseInputs(overrides = {}) {
  return {
    registeredVkHash: REGISTERED_VK, // field.js converts hex -> field element (mod p)
    proofVkHash: REGISTERED_VK,
    minimum: '1000',
    publicBalance: '1460',
    expiryBlock: 8430000,
    currentBlock: 8420000,
    recipient: RECIPIENT,
    conditionRecipient: RECIPIENT,
    amount: '500',
    maxTransfer: '1000',
    decision: 1,
    taskId: taskIdToField('gk_sample_valid_1'),
    salt: '424242',
    ...overrides,
  };
}

async function tryProve(label, inputs) {
  const t0 = Date.now();
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs, WASM, ZKEY);
    const ok = await snarkjs.groth16.verify(VK, publicSignals, proof);
    console.log(`${label}: PROVED in ${Date.now() - t0}ms, local verify = ${ok}, publicSignals (${publicSignals.length}) = ${JSON.stringify(publicSignals)}`);
    return { proof, publicSignals, ok };
  } catch (e) {
    console.log(`${label}: FAILED in ${Date.now() - t0}ms — ${String(e.message || e).slice(0, 200)}`);
    return null;
  }
}

await tryProve('valid + APPROVE(1)      ', baseInputs());
await tryProve('vk-trap + REJECT(0)     ', baseInputs({ proofVkHash: OTHER_VK, decision: 0, taskId: taskIdToField('gk_sample_trap_1') }));
await tryProve('vk-trap + APPROVE(1)    ', baseInputs({ proofVkHash: OTHER_VK, decision: 1, taskId: taskIdToField('gk_sample_trap_2') }));
await tryProve('valid + REJECT(0)       ', baseInputs({ decision: 0, taskId: taskIdToField('gk_sample_valid_2') }));
process.exit(0);
