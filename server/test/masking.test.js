import test from 'node:test';
import assert from 'node:assert/strict';
import { DETECTORS, MAX_FREE, PERCENT_ROUNDS, cleanFree, findCredentials, maskText } from '../src/credentials.js';
import { maskDeep } from '../src/mask.js';
import { createWorkspaces } from '../src/workspaces.js';
import { C, K, A, newEngine, withServer, get, json, W } from './helpers.js';
import { SECRETS, NEEDLE, PLAIN } from './secrets.js';

test('every credential and personal-data shape is masked by cleanFree (the intake): its needle never survives', () => {
  for (const [name, v] of Object.entries(SECRETS)) {
    const out = cleanFree(`please use ${v} for this`);
    assert.ok(!out.includes(NEEDLE[name]), `${name}: "${NEEDLE[name]}" survived in "${out}"`);
    assert.match(out, /\[masked:/, name);
    assert.ok(out.startsWith('please use'), name);
  }
  for (const name of Object.keys(SECRETS)) assert.ok(Object.hasOwn(NEEDLE, name), `${name} has a needle`);
  assert.ok(DETECTORS.length >= 20);
});

test('the shapes the review found raw are each masked by their own detector family', () => {
  const direct = (name) => findCredentials(SECRETS[name]).map((s) => s.id);
  assert.ok(direct('plainIs').includes('password-is'));
  assert.ok(direct('passcode').includes('password-is'));
  assert.ok(direct('userinfo').includes('url-userinfo'));
  assert.ok(direct('authToken').includes('authorization'));
  assert.ok(direct('pwEq').includes('assignment'));
  assert.ok(direct('skShort').includes('api-key'));
  assert.ok(direct('pin').includes('pin'));
  assert.ok(direct('ssn').includes('ssn'));
  assert.ok(direct('email').includes('email'));
  assert.ok(direct('card').includes('card'));
  assert.ok(direct('cardDashes').includes('card'));
  assert.ok(direct('phone').includes('phone') || direct('phone').includes('phone-intl'));
  assert.ok(direct('phoneUs').includes('phone'));
  assert.match(cleanFree(`x ${SECRETS.zeroWidth}`), /\[masked:/);
});

test('ordinary prose, ids, dates, account ids and a card number that fails the check digit are NOT masked (no false positives)', () => {
  for (const text of PLAIN) assert.equal(cleanFree(text), text);
  for (const idv of ['ag-bedrock-02', 'prop-0001', '000000000001', 'proj-lab-001', 'role-lab-admin-ops', 'maya.chen', 'gw-lab-01', '2026-11-02T10:00:00.000Z', 'ledger-reconciler']) assert.equal(cleanFree(idv), idv, idv);
});

test('card numbers are Luhn checked: a valid one is masked, a one-digit change is not', () => {
  assert.match(cleanFree('card 4111 1111 1111 1111'), /\[masked:card\]/);
  assert.equal(cleanFree('card 4111 1111 1111 1112'), 'card 4111 1111 1111 1112');
});

test('zero-width, soft-hyphen, word-joiner, BOM and bidi characters are DELETED before masking, and fullwidth look-alikes are normalised', () => {
  const v = SECRETS.github;
  for (const z of ['​', '‍', '⁠', '﻿', '­', '‮']) {
    const out = cleanFree(`use ${[...v].join(z)} now`);
    assert.ok(!out.includes(v.slice(4, 14)), JSON.stringify(z));
    assert.match(out, /\[masked:/, JSON.stringify(z));
  }
  const full = [...SECRETS.skShort].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join('').replace(/　/g, ' ');
  assert.match(cleanFree(`use ${full}`), /\[masked:api-key\]/, 'a fullwidth look-alike is normalised to ASCII and then masked');
  assert.equal(cleanFree('a\u0000b\u202ec  d'), 'a bc d', 'a control character becomes a space, a bidi character is deleted');
});

test('cleanFree: masks, collapses space, caps, and never throws', () => {
  const v = SECRETS.github;
  assert.ok(!cleanFree(`token ${v}`).includes(v));
  assert.equal(cleanFree('x'.repeat(5000)).length <= MAX_FREE, true);
  assert.equal(cleanFree(undefined), ''); assert.equal(cleanFree(null), ''); assert.equal(cleanFree({}), '[object Object]');
  assert.equal(cleanFree('I need read access to review the change for the release'), 'I need read access to review the change for the release');
});

test('masking happens BEFORE the cut to length: a token that straddles the limit is masked, not half shown', () => {
  const v = SECRETS.github;
  for (let into = 1; into <= 8; into++) {
    const filler = 'x '.repeat(200).slice(0, 400 - into);
    const out = cleanFree(`${filler}${v}`, 400);
    assert.ok(out.length <= 400, `into ${into}`);
    for (let k = 2; k <= into; k++) assert.ok(!out.endsWith(v.slice(0, k)), `into ${into}: fragment ${v.slice(0, k)}`);
    assert.ok(!out.includes('ghp_'), `into ${into}`);
  }
  assert.ok(!cleanFree(`${'a'.repeat(19990)} ${v}`, 400).includes('ghp_'));
});

test('detectors are linear: hostile inputs of tens of thousands of characters finish (a catastrophic pattern would not)', () => {
  const t0 = Date.now();
  for (const bad of ['a'.repeat(20000), 'password' + ' '.repeat(20000), '-----BEGIN PRIVATE KEY-----' + 'x'.repeat(20000), 'sk-' + '-'.repeat(20000), 'Bearer ' + 'a'.repeat(20000), 'eyJ' + 'a.'.repeat(10000), 'a='.repeat(10000), 'a@'.repeat(10000), '1 '.repeat(10000), '+1'.repeat(10000), 'https://' + 'a:'.repeat(10000), 'authorization:' + ' a'.repeat(10000)]) maskText(bad);
  assert.ok(Date.now() - t0 < 60000, `${Date.now() - t0} ms (a generous bound: only a catastrophic pattern could exceed it)`);
});

test('maskDeep masks nested values, keeps ids, hashes and trace ids, does not mutate, and survives a deep structure', () => {
  const v = SECRETS.github;
  const input = { a: [{ b: `x ${v}` }], hash: 'f'.repeat(64), traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`, id: 'req-0001', n: 5, nil: null };
  const out = maskDeep(input);
  assert.ok(!JSON.stringify(out).includes(v));
  assert.equal(out.hash, input.hash); assert.equal(out.traceparent, input.traceparent); assert.equal(out.id, 'req-0001'); assert.equal(out.n, 5);
  assert.ok(input.a[0].b.includes(v), 'the input is not mutated');
  let deep = { v: `y ${v}` }; for (let i = 0; i < 50000; i++) deep = { d: deep };
  assert.doesNotThrow(() => maskDeep(deep));
  for (const name of ['plainIs', 'userinfo', 'authToken', 'ssn', 'email', 'card', 'pin']) assert.ok(!JSON.stringify(maskDeep({ x: `a ${SECRETS[name]} b` })).includes(NEEDLE[name]), `the response mask covers ${name}`);
});

test('the RESPONSE-time mask works on its own: a credential that reached the engine state with intake masking bypassed is still masked in every answer', async () => {
  const workspaces = createWorkspaces();
  const e = workspaces.engine('bypass', 'finance', C);
  const names = ['github', 'plainIs', 'userinfo', 'authToken', 'ssn', 'email', 'card'];
  const agent = e.s.agents.get('ag-bedrock-01');
  names.forEach((n, i) => { agent.tags[`t${i}`] = `see ${SECRETS[n]}`; });
  e.s.audit.push({ n: 999, at: 'x', kind: 'planted', actor: `by ${SECRETS.plainIs}` });
  await withServer(async (url) => {
    const t = await (await get(url, '/api/state?mode=live', W('bypass'))).text();
    for (const n of names) assert.ok(!t.includes(NEEDLE[n]), `${n} is masked by the response mask`);
    assert.match(t, /\[masked:/);
    const w = await json(await get(url, '/api/state?mode=live', W('bypass')));
    assert.ok(w.state.agents.find((a) => a.id === 'ag-bedrock-01').tags.t0.includes('[masked:'));
  }, { workspaces });
});

test('a credential typed into a proposal reason, a comment or a retag value is masked everywhere the engine keeps or shows it', () => {
  const e = newEngine(); e.trace = { traceId: 'a'.repeat(32), span: () => 'b'.repeat(16) };
  let n = 0;
  for (const [name, v] of Object.entries(SECRETS)) {
    n += 1;
    const p = e.propose({ actor: K, agentId: 'ag-bedrock-01', kind: 'retag', params: { key: 'cost-center', value: `n${n}: ${v}` }, reason: `because ${v} works` });
    e.decide({ actor: A, proposalId: p.proposalId, decision: 'approve', comment: `ok ${v}` });
    e.execute({ actor: A, proposalId: p.proposalId });
    const all = JSON.stringify([e.snapshot(), e.hops, e.s.audit, [...e.s.agents.values()]]);
    assert.ok(!all.includes(NEEDLE[name]), `${name} is nowhere in the state, the hops or the audit log`);
  }
  assert.ok(n > 30);
  assert.match(e.snapshot().proposals.at(-1).reason, /\[masked:/);
});

// ---- second review F1: percent-encoded values, "api key" with a space, a dash as the separator ----
const PCT = ['pctSpace', 'pctTwice', 'pctThrice', 'pctMixed', 'apiKeySpace', 'pwdDash'];

test('F1: percent-encoded values (1, 2 and 3 rounds), "api key: x" with a space and "pwd - x" are masked by cleanFree and by the response mask', () => {
  for (const n of PCT) {
    const out = cleanFree(`please ${SECRETS[n]} thanks`);
    assert.ok(!out.includes(NEEDLE[n]), `${n}: "${NEEDLE[n]}" survived in "${out}"`); assert.match(out, /\[masked:/, n);
    assert.ok(!JSON.stringify(maskDeep({ x: `a ${SECRETS[n]} b` })).includes(NEEDLE[n]), `${n}: the response mask covers it too`);
  }
  // the three layers, spelled out
  assert.match(cleanFree('my%20pass' + 'word%20is%20Kiwi-Fruit-91'), /\[masked:password-is\]/);
  assert.match(cleanFree('pass' + 'word%253DTr0ub4dorXyz'), /\[masked:assignment\]/);
  assert.match(cleanFree('pass' + 'word%25253DTr0ub4dorXyz'), /\[masked:assignment\]/);
  assert.match(cleanFree('api key: Rr88ttYYuu'), /\[masked:assignment\]/);
  assert.match(cleanFree('pwd - Kk99Jj88Hh'), /\[masked:password-dash\]/);
  assert.match(cleanFree('API  KEY = Rr88ttYYuu'), /\[masked:assignment\]/);
});

test('F1: a malformed percent escape never throws, and a half-decoded or lone % is left as text', () => {
  for (const bad of ['%', '%%', '%zz', '%E0%A4%A', '%C0%AF', '%ED%A0%80', '100%', 'a%2', '%ff%fe%fd', `${'%41'.repeat(5000)}`, `${'%25'.repeat(2000)}41`]) assert.doesNotThrow(() => cleanFree(bad), bad.slice(0, 20));
  assert.equal(cleanFree('100% sure, 50%25 done'), '100% sure, 50%25 done', 'a plain percent sign and a valid escape are not credentials, and the text is kept as typed');
  assert.doesNotThrow(() => maskDeep({ a: '%E0%A4%A', b: ['%zz', '%'] }));
  // an invalid UTF-8 run next to a credential: the credential is still found
  const out = cleanFree('%E0%A4%A then pass' + 'word%20is%20Kiwi-Fruit-91'); assert.ok(!out.includes('Kiwi-Fruit-91'));
});

test('F1: ordinary text with percent escapes or a dash is not masked (no false positives)', () => {
  for (const t of ['the handbook says 100%25 of reviews need two approvers', 'see 50%2B coverage', 'password - see the handbook', 'pw - none', 'a%20b%20c plain words', 'rate limit 100%25']) assert.ok(!/\[masked:/.test(cleanFree(t)), t);
});

test('F1 (stated limit): a password with no keyword before it, such as "login with hunter2hunter2 please", is not recognisable and is not masked', () => {
  assert.equal(cleanFree('login with hunter2hunter2 please'), 'login with hunter2hunter2 please');
});

test('F1: the decoding is bounded to three rounds and keeps mask-before-truncate', () => {
  assert.equal(PERCENT_ROUNDS, 3);
  const pad = 'x '.repeat(190);
  const out = cleanFree(`${pad}my%20pass` + 'word%20is%20Kiwi-Fruit-91', 400);
  assert.ok(!out.includes('Kiwi') && out.length <= 400);
});
