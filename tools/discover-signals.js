// Discover the gatekeeper circuit's input signal names by brute-forcing
// candidate names against the WASM's FNV-1a signal map (the same lookup
// circom_runtime's witness calculator performs at prove time).
import fs from 'node:fs';
import { WitnessCalculatorBuilder } from 'circom_runtime';

const wasmPath = new URL('../circuits/gatekeeper.wasm', import.meta.url);
const buffer = fs.readFileSync(wasmPath);

const wc = await WitnessCalculatorBuilder(buffer);
const ex = wc.instance.exports;
console.log('exports:', Object.keys(ex).join(', '));
if (typeof ex.getInputSize === 'function') console.log('getInputSize():', ex.getInputSize());

function fnvHash(str) {
  const MOD = 2n ** 64n;
  let hash = 0xCBF29CE484222325n;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * 0x100000001B3n) % MOD;
  }
  return hash;
}

function signalSize(name) {
  const h = fnvHash(name);
  const msb = Number(h >> 32n);
  const lsb = Number(h & 0xffffffffn);
  try {
    return ex.getInputSignalSize(msb, lsb);
  } catch {
    return -1;
  }
}

// --- candidate dictionary -------------------------------------------------
const words = [
  'vk', 'registeredVk', 'registered_vk', 'proofVk', 'proof_vk', 'vkHash', 'vk_hash',
  'registeredVkHash', 'proofVkHash', 'conditionVk', 'expectedVk',
  'minimum', 'min', 'threshold', 'minThreshold', 'min_threshold', 'requiredMinimum',
  'balance', 'publicBalance', 'public_balance', 'publicbalance',
  'expiry', 'expiryBlock', 'expiry_block', 'currentBlock', 'current_block',
  'block', 'blockHeight', 'currentHeight',
  'recipient', 'conditionRecipient', 'condition_recipient', 'payee', 'to',
  'amount', 'transferAmount', 'maxTransfer', 'max_transfer', 'cap', 'maxAmount',
  'proofTx', 'proof_tx', 'proofRef', 'proofReference', 'txHash', 'proofHash',
  'decision', 'approve', 'approved', 'isApproved', 'decisionCode', 'outcome',
  'reason', 'reasonCode', 'valid', 'isValid', 'checks', 'flags', 'result',
  'taskId', 'task_id', 'taskHash', 'nonce', 'salt',
  'sender', 'from', 'account', 'owner', 'agent', 'condition', 'publicInputs',
  'signal', 'statement', 'claim', 'payment', 'transfer',
];
const prefixes = ['', 'main.'];
const found = [];
for (const p of prefixes) {
  for (const w of words) {
    const name = p + w;
    const size = signalSize(name);
    if (size > 0) found.push({ name, size });
  }
}
console.log('FOUND:', JSON.stringify(found, null, 2));

// Also probe a couple of structural candidates with array notation variants.
for (const base of found.map((f) => f.name)) {
  const s = signalSize(base + '[0]');
  if (s > 0) console.log('array form hit:', base + '[0]', s);
}
