// Local test harness for the Gatekeeper agent. Run: npm test
//   A. check-module unit tests
//   B. decision-engine tests over the trap fixtures (mock verifier)
//   C. circuit consistency: the real circuit must prove the engine's
//      decision and (for the empirically established cases) refuse the
//      opposite one; proofs verified locally against the exported VK.
//   D. Kurier client unit tests (fake fetch — no network)
//   E. end-to-end: real HTTP server, signed fixtures in, signed responses
//      out; idempotent retry; bad-signature rejection.
// Exits non-zero if any hard assertion fails. Lines marked REPORT are
// platform-behaviour observations, not assertions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as snarkjs from 'snarkjs';
import { checkVkMatch } from '../src/checks/vkMatch.js';
import { checkThreshold } from '../src/checks/threshold.js';
import { checkAmountCap } from '../src/checks/amountCap.js';
import { checkExpiry } from '../src/checks/expiry.js';
import { checkRecipient } from '../src/checks/recipient.js';
import { evaluateTask } from '../src/engine.js';
import { StateStore } from '../src/seenStore.js';
import { MockVerifier } from '../src/proof/verifier.js';
import { GatekeeperProver, WitnessError } from '../src/proof/prover.js';
import { KurierClient } from '../src/proof/kurier.js';
import { buildServer } from '../src/server.js';
import { signBody, verifyBody } from '../src/hmac.js';

const FIXTURES = new URL('../fixtures/', import.meta.url).pathname;
const VK_JSON = JSON.parse(fs.readFileSync(new URL('../circuits/gatekeeper_vk.json', import.meta.url)));
const TEST_SECRET = 'test-hmac-secret-not-for-production';

let passed = 0, failed = 0;
function assert(section, name, cond, detail = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${detail}`); }
}
function report(msg) { console.log(`  REPORT ${msg}`); }

function loadFixture(name) {
  const raw = fs.readFileSync(path.join(FIXTURES, name), 'utf8')
    .replaceAll('__ISSUED_AT__', new Date(Date.now() - 5_000).toISOString())
    .replaceAll('__DEADLINE_AT__', new Date(Date.now() + 55_000).toISOString());
  return JSON.parse(raw);
}
const tmpState = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ag-state-')), 'state.json');

// ---------------------------------------------------------------- A. units
console.log('A. check modules');
{
  const vk = '0xAB12', vkLower = '0xab12';
  assert('A', 'vkMatch is case-insensitive', checkVkMatch({ registered_vk: vk, proof_vk: vkLower }).pass);
  assert('A', 'vkMatch rejects substitution', !checkVkMatch({ registered_vk: vk, proof_vk: '0xab13' }).pass);
  assert('A', 'threshold passes at equality', checkThreshold({ public_balance: '1000', minimum: '1000' }).pass);
  assert('A', 'threshold fails one below', !checkThreshold({ public_balance: '999', minimum: '1000' }).pass);
  assert('A', 'amount passes at cap', checkAmountCap({ amount: '1000', max_transfer: '1000' }).pass);
  assert('A', 'amount fails one over cap', !checkAmountCap({ amount: '1001', max_transfer: '1000' }).pass);
  assert('A', 'expiry passes one block before', checkExpiry({ current_block: 10, expiry_block: 11 }).pass);
  assert('A', 'expiry fails AT expiry block (exclusive bound, documented)', !checkExpiry({ current_block: 11, expiry_block: 11 }).pass);
  assert('A', 'recipient is case-insensitive', checkRecipient({ recipient: '0xAB', condition_recipient: '0xab' }).pass);
  assert('A', 'recipient mismatch fails', !checkRecipient({ recipient: '0xAB', condition_recipient: '0xAC' }).pass);
}

// ---------------------------------------------------------------- B. engine
console.log('B. decision engine over fixtures (fresh store, ordered)');
{
  const store = new StateStore(tmpState());
  const verifier = new MockVerifier();
  const plan = [
    ['valid.json', 'APPROVE', 'VALID_CONDITION'],
    ['valid-boundary.json', 'APPROVE', 'VALID_CONDITION'],
    ['vk-substitution.json', 'REJECT', 'VK_SUBSTITUTION'],
    ['threshold-mismatch.json', 'REJECT', 'THRESHOLD_MISMATCH'],
    ['recipient-mismatch.json', 'REJECT', 'RECIPIENT_MISMATCH'],
    ['expired-condition.json', 'REJECT', 'EXPIRED_CONDITION'],
    ['expiry-boundary.json', 'REJECT', 'EXPIRED_CONDITION'],
    ['amount-overflow.json', 'REJECT', 'AMOUNT_OVERFLOW'],
    ['proof-reused.json', 'REJECT', 'PROOF_REUSED'], // reuses valid.json's proof_tx
  ];
  for (const [file, decision, reason] of plan) {
    const v = await evaluateTask(loadFixture(file), { store, verifier });
    assert('B', `${file} -> ${decision}/${reason}`, v.decision === decision && v.reason_code === reason,
      `got ${v.decision}/${v.reason_code}`);
  }
  // The reused envelope in a FRESH store is a first sighting -> valid.
  const fresh = await evaluateTask(loadFixture('proof-reused.json'), { store: new StateStore(tmpState()), verifier });
  assert('B', 'proof-reused.json in a fresh store -> APPROVE', fresh.decision === 'APPROVE', `got ${fresh.decision}/${fresh.reason_code}`);
  // Unfinalized incoming proof -> fail closed.
  const env = loadFixture('valid.json');
  env.task_id = 'gk_fix_unfinalized';
  env.input = { ...env.input, proof_tx: '0x' + 'f'.repeat(64) };
  verifier.setIncoming(env.input.proof_tx, { found: true, finalized: false, source: 'mock' });
  const unfin = await evaluateTask(env, { store: new StateStore(tmpState()), verifier });
  assert('B', 'unfinalized incoming proof -> REJECT/PROOF_NOT_FINALIZED',
    unfin.decision === 'REJECT' && unfin.reason_code === 'PROOF_NOT_FINALIZED', `got ${unfin.decision}/${unfin.reason_code}`);
}

// ---------------------------------------------------------------- C. circuit
console.log('C. circuit consistency (real artifacts, local verification)');
{
  const prover = new GatekeeperProver({ saltSecret: 'circuit-test-salt', proveTimeoutMs: 60_000 });
  const cases = [
    // [fixture, engine decision, opposite-must-fail?]
    ['valid.json', 'APPROVE', true],
    ['vk-substitution.json', 'REJECT', true],
    ['threshold-mismatch.json', 'REJECT', null],
    ['recipient-mismatch.json', 'REJECT', null],
    ['expired-condition.json', 'REJECT', null],
    ['amount-overflow.json', 'REJECT', null],
    ['expiry-boundary.json', 'REJECT', null],
    ['valid-boundary.json', 'APPROVE', null],
  ];
  for (const [file, decision, oppositeMustFail] of cases) {
    const env = loadFixture(file);
    try {
      const { proof, publicSignals } = await prover.prove(env, decision);
      const ok = await snarkjs.groth16.verify(VK_JSON, publicSignals, proof);
      assert('C', `${file}: engine decision ${decision} proves + verifies`, ok === true && publicSignals.length === 13);
    } catch (e) {
      assert('C', `${file}: engine decision ${decision} proves + verifies`, false, e.message);
      continue;
    }
    const opposite = decision === 'APPROVE' ? 'REJECT' : 'APPROVE';
    let oppositeFailed = false;
    try { await prover.prove(env, opposite); } catch (e) { oppositeFailed = e instanceof WitnessError; }
    if (oppositeMustFail === true) {
      assert('C', `${file}: opposite decision ${opposite} is unprovable`, oppositeFailed);
    } else {
      report(`${file}: opposite decision ${opposite} provable = ${!oppositeFailed} (circuit verdict enforcement on this dimension)`);
    }
  }
}

// ---------------------------------------------------------------- D. kurier
console.log('D. Kurier client (fake fetch)');
{
  const calls = [];
  const fakeFetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('/submit-proof/')) return { ok: true, text: async () => JSON.stringify({ jobId: 'job_123' }) };
    if (url.includes('/job-status/')) {
      const n = calls.filter((c) => c.url.includes('/job-status/')).length;
      const status = ['Queued', 'Submitted', 'IncludedInBlock', 'Finalized'][Math.min(n - 1, 3)];
      return { ok: true, text: async () => JSON.stringify({ status }) };
    }
    throw new Error('unexpected url ' + url);
  };
  const client = new KurierClient({ apiKey: 'KEY123', fetchImpl: fakeFetch });
  const job = await client.submitProof({ proof: { pi_a: [] }, publicSignals: ['1'], vkHash: '0xVK' });
  const submitBody = JSON.parse(calls[0].opts.body);
  assert('D', 'submit-proof returns jobId', job.jobId === 'job_123');
  assert('D', 'submit-proof body matches the build-guide shape',
    submitBody.proofType === 'groth16' && submitBody.vkRegistered === true &&
    submitBody.proofOptions.library === 'snarkjs' && submitBody.proofOptions.curve === 'bn128' &&
    submitBody.proofData.vk === '0xVK');
  assert('D', 'api key travels in the URL path', calls[0].url === 'https://api.kurier.xyz/api/v1/submit-proof/KEY123', calls[0].url);
  const final = await client.waitForFinalized('job_123', { pollMs: 1, timeoutMs: 10_000 });
  assert('D', 'waitForFinalized polls through to Finalized', final.status === 'Finalized');
}

// ---------------------------------------------------------------- E. e2e http
console.log('E. end-to-end HTTP (signed in, signed out)');
{
  const config = {
    port: 0, agentPath: '/agent', hmacSecret: TEST_SECRET, usingPlaceholderSecret: false,
    kurierApiKey: '', kurierBaseUrl: 'https://api.kurier.xyz/api/v1', verifierMode: 'mock',
    kurierSubmit: 'async', stateFile: tmpState(), saltSecret: 'e2e-salt',
    responseBudgetMs: 50_000, proveTimeoutMs: 30_000,
  };
  const { server, verifier } = buildServer(config);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (obj, { secret = TEST_SECRET, path = '/agent' } = {}) => {
    const body = JSON.stringify(obj);
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-games-signature': signBody(body, secret) },
      body,
    });
    const text = await res.text();
    return { status: res.status, text, json: JSON.parse(text), sig: res.headers.get('x-agent-games-signature') };
  };
  try {
    const health = await fetch(base + '/health');
    assert('E', 'GET /health -> 200 ok', health.status === 200 && (await health.json()).ok === true);

    const pre = await post(loadFixture('preflight.json'));
    assert('E', 'preflight -> {ok:true, protocolVersion:"v1"}', pre.status === 200 && pre.json.ok === true && pre.json.protocolVersion === 'v1');
    assert('E', 'preflight response signature verifies', verifyBody(pre.text, pre.sig, TEST_SECRET));

    const valid = await post(loadFixture('valid.json'));
    assert('E', 'valid task -> APPROVE/VALID_CONDITION', valid.json.decision === 'APPROVE' && valid.json.reason_code === 'VALID_CONDITION',
      JSON.stringify(valid.json));
    assert('E', 'valid task response carries proof + 13 public signals',
      !!valid.json.proof && Array.isArray(valid.json.public_signals) && valid.json.public_signals.length === 13);
    assert('E', 'valid task response signature verifies', verifyBody(valid.text, valid.sig, TEST_SECRET));
    const proofOk = await snarkjs.groth16.verify(VK_JSON, valid.json.public_signals, valid.json.proof);
    assert('E', 'e2e response proof verifies against the registered VK', proofOk === true);

    const retry = await post(loadFixture('valid.json'));
    assert('E', 'retried task_id -> byte-identical response (idempotency)', retry.text === valid.text);
    assert('E', 'audit proof was submitted to the verifier (mock)', verifier.submitted.length >= 1);

    const trap = await post(loadFixture('vk-substitution.json'));
    assert('E', 'vk trap -> REJECT/VK_SUBSTITUTION with proof',
      trap.json.decision === 'REJECT' && trap.json.reason_code === 'VK_SUBSTITUTION' && !!trap.json.proof);

    const reused = await post(loadFixture('proof-reused.json'));
    assert('E', 'reused proof -> REJECT/PROOF_REUSED without proof fields',
      reused.json.decision === 'REJECT' && reused.json.reason_code === 'PROOF_REUSED' && reused.json.proof === undefined);

    const bad = await post(loadFixture('valid.json'), { secret: 'wrong-secret' });
    assert('E', 'bad HMAC -> 401', bad.status === 401, `got ${bad.status}`);

    const unknown = await post({ type: 'agent-games.something-else.v1' });
    assert('E', 'unknown type -> 400', unknown.status === 400, `got ${unknown.status}`);
  } finally {
    server.close();
  }
}

console.log(`\n== ${passed} passed, ${failed} failed ==`);
process.exit(failed === 0 ? 0 : 1);
