// The masking sweep (classes A to F) and the fixes that came with it, asserted with LITERAL numbers and literal payloads.
// A: control characters inside a keyword. B: keyword + plain space. C: URL userinfo without a scheme. D: JSON-quoted assignment.
// E: static files and wrong methods. F: workspace ids. Plus: every hop pane shows MASKED input, and lengths are refused whole.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanFree, findCredentials, flatten, looksLikeCredential, maskResponseText } from '../src/credentials.js';
import { maskDeep } from '../src/mask.js';
import { scrub } from '../src/service.js';
import { validWorkspaceId } from '../src/workspaces.js';
import { A, K, get, newEngine, post, put, rawHttp, withServer } from './helpers.js';
import { SECRETS, NEEDLE } from './secrets.js';

const live = (extra = {}) => ({ mode: 'live', vertical: 'finance', ...extra });
const CLASS = {
  A: ['ctrlSoh', 'ctrlNul', 'ctrlNel', 'ctrlDel', 'ctrlIs', 'ctrlToken', 'ctrlBearer', 'ctrlSk', 'ctrlTab', 'ctrlTabIs'],
  B: ['spPassword', 'spPw', 'spToken', 'spSecret', 'spApiKey', 'spKeyIs', 'spPlus'],
  C: ['uiNoScheme', 'uiSlashes', 'uiScheme', 'uiAt'],
  D: ['jsonPassword', 'jsonSpaced', 'jsonSingle', 'jsonGlued'],
};
const ALL = Object.values(CLASS).flat();

test('the sweep payloads are all in the shared table, with their needles (a typo here would make every other test vacuous)', () => {
  assert.equal(ALL.length, 25);
  for (const n of ALL) { assert.ok(Object.hasOwn(SECRETS, n), n); assert.ok(Object.hasOwn(NEEDLE, n), n); assert.ok(SECRETS[n].length > 10, n); }
  assert.ok(SECRETS.ctrlSoh.includes('\x01') && SECRETS.ctrlNul.includes('\x00') && SECRETS.ctrlNel.includes('\x85') && SECRETS.ctrlDel.includes('\x7f'));
});

// ---- A: control characters are DELETED before matching ----
test('A: C0 and C1 controls interleaved in a keyword are deleted, so the keyword is whole and the value is masked (intake, response mask, object key)', () => {
  for (const n of CLASS.A) {
    const v = SECRETS[n];
    const out = cleanFree(`please use ${v} now`);
    assert.ok(!out.includes(NEEDLE[n]), `${n}: ${JSON.stringify(out)}`); assert.match(out, /\[masked:/, n);
    assert.ok(out.startsWith('please use') && out.endsWith('now'), `${n}: the words around it are kept: ${out}`);
    assert.ok(!JSON.stringify(maskDeep({ x: `a ${v} b` })).includes(NEEDLE[n]), `${n}: response mask`);
    assert.ok(!JSON.stringify(maskDeep({ [`a ${v} b`]: 1 })).includes(NEEDLE[n]), `${n}: as an object key`);
    assert.ok(!JSON.stringify(scrub({ [v]: v })).includes(NEEDLE[n]), `${n}: request pane`);
    assert.ok(looksLikeCredential(v), n);
  }
  // literal repros
  assert.equal(flatten('pass\x00word'), 'password'); assert.equal(flatten('pass\x85word'), 'password'); assert.equal(flatten('pass\x7fword'), 'password');
  assert.equal(flatten('p\x01a\x01s\x01s'), 'pass'); assert.equal(flatten('a\tb\nc\rd'), 'a b c d', 'tab, newline and CR are separators, not deleted');
  for (let c = 0; c <= 0x9f; c++) {
    if (c === 9 || c === 10 || c === 13 || (c > 0x1f && c < 0x7f)) continue;
    assert.equal(flatten(`a${String.fromCharCode(c)}b`), 'ab', `U+${c.toString(16)} is deleted`);
  }
});

test('A: a tab, newline or CR inside a keyword is a separator but still found (the second look), while a plain multi-line text stays readable', () => {
  assert.ok(!cleanFree(SECRETS.ctrlTab).includes('hunter2xyz'));
  assert.ok(!cleanFree(['pass\n', 'word=hunter2xyz'].join('')).includes('hunter2xyz'));
  assert.ok(!cleanFree(['pass\r\n', 'word=hunter2xyz'].join('')).includes('hunter2xyz'));
  assert.match(cleanFree(SECRETS.ctrlTabIs), /\[masked:/, 'found only by the second look: "pass word is x" is not a password statement, "password is x" is');
  assert.ok(!maskResponseText(SECRETS.ctrlTabIs).includes('hunter2xyz'));
  assert.equal(cleanFree('line one\nline two\n\nline three'), 'line one line two line three');
  assert.equal(cleanFree('tab\tseparated\tvalues'), 'tab separated values');
});

// ---- B: keyword + plain space ----
test('B: a credential word, a plain space and a value of 6 or more characters with a digit is masked; the boundary is 6, and it needs a digit', () => {
  for (const n of CLASS.B) {
    const out = cleanFree(`note: ${SECRETS[n]} thanks`);
    assert.ok(!out.includes('hunter2xyz'), `${n}: ${out}`); assert.match(out, /\[masked:/, n);
  }
  assert.equal(cleanFree(['pass', 'word abcde1'].join('')), '[masked:keyword-space]', '6 characters with a digit: masked');
  assert.equal(cleanFree(['pass', 'word abcd1'].join('')), ['pass', 'word abcd1'].join(''), '5 characters: NOT masked (a stated limit)');
  assert.equal(cleanFree(['pass', 'word abcdef'].join('')), ['pass', 'word abcdef'].join(''), '6 letters and no digit: NOT masked (a stated limit)');
  assert.equal(cleanFree(['pass', 'word password hunter2xyz'].join('')), ['pass', 'word [masked:keyword-space]'].join(''), 'a skipped word does not eat the match after it');
  assert.match(cleanFree('the key is hunter2xyz'), /\[masked:secret-is\]/);
  assert.ok(!cleanFree(['pass', 'word is-hunter2xyz'].join('')).includes('hunter2xyz'), 'the word "is" right before a value does not switch the plain-space rule off');
});

test('B: ordinary sentences that name a credential word stay readable; the one price is a digit-bearing word right after the keyword', () => {
  for (const t of ['password reset', 'the password policy', 'token requirements', 'pw reset requested', 'secret rotation is quarterly', 'api key rotation', 'passwords expire', 'the key is under the mat', 'a credential review', 'secret santa party', 'token expires soon']) assert.equal(cleanFree(t), t, t);
  // the documented false positive: a date or a version right after the word looks like a value
  assert.match(cleanFree('token 2026-11-02 expired'), /\[masked:keyword-space\]/);
  assert.match(cleanFree('secret v1.2.3-rc1 rotated'), /\[masked:keyword-space\]/);
});

// ---- C: userinfo ----
test('C: user:password@host is masked with a scheme, with // and with neither, including a password that holds : or @', () => {
  const lit = [['bob:' + 'hunter2xyz@host.example', 'hunter2xyz'], ['//bob:' + 'hunter2xyz@host.example', 'hunter2xyz'], ['https://bob:' + 'hunter2xyz@host.example', 'hunter2xyz'], ['wss://bob:' + 'hunter2xyz@host.example:8443/x', 'hunter2xyz'], ['https://bob:' + 'p@ssw0rd2@host.example', 'ssw0rd2'], ['bob:' + 'hun:ter2xyz@host.example', 'ter2xyz'], ['sftp://bob:' + 'hunter2xyz@h', 'hunter2xyz']];
  for (const [t, needle] of lit) {
    const out = cleanFree(`see ${t} for it`); assert.ok(!out.includes(needle), `${t} -> ${out}`); assert.ok(!maskResponseText(`see ${t} for it`).includes(needle), `response mask: ${t}`);
    // the userinfo detector itself must cover everything up to the LAST @ (the email detector alone would leave "bob:" or "p@" behind)
    const sp = findCredentials(t).filter((s) => (t.includes('://') ? s.id === 'url-userinfo' : s.id === 'userinfo-noscheme')); // each detector on its own
    assert.ok(sp.some((s) => s.start <= t.indexOf('bob') && s.end >= t.lastIndexOf('@') + 1), `${t}: userinfo spans ${JSON.stringify(sp)}`);
    assert.ok(!out.includes('bob:'), `${t} -> ${out}`);
  }
  for (const t of ['see https://host.example:8443/path?x=1 and https://github.example/a/b', 'meeting at 10:30 in room 4', 'maya.chen@example.com is the custodian']) assert.ok(!/userinfo/.test(findCredentials(t).map((s) => s.id).join()), t);
});

// ---- D: JSON text ----
test('D: JSON-quoted assignments are masked whole, whatever the quote style or spacing, and the surrounding JSON survives', () => {
  for (const n of CLASS.D) { const out = cleanFree(SECRETS[n]); assert.ok(!out.includes('hunter2xyz'), `${n}: ${out}`); assert.match(out, /\[masked:/); }
  assert.equal(cleanFree(['{"pass', 'word":"hunter 2 xyz","user":"bob"}'].join('')), '{[masked:json-assignment],"user":"bob"}', 'a quoted value with spaces is masked to its closing quote');
  assert.equal(cleanFree('{"user":"bob","note":"hello"}'), '{"user":"bob","note":"hello"}');
  assert.ok(!cleanFree(['{\\"pass', 'word\\":\\"hunter2xyz\\"}'].join('')).includes('hunter2xyz'), 'the escaped form too');
  assert.ok(!maskResponseText(['{"to', 'ken":"hunter2xyz"}'].join('')).includes('hunter2xyz'));
  assert.ok(!cleanFree(['my_pass', 'word=hunter2xyz'].join('')).includes('hunter2xyz'), 'a keyword glued to a prefix by an underscore');
  assert.ok(!cleanFree(['see pass', 'word":"hunter2xyz"'].join('')).includes('hunter2xyz'), 'a fragment with no opening quote and no brace (the assignment detector takes a closing quote before the colon)');
  assert.ok(!cleanFree(["x tok", "en': 'hunter2xyz'"].join('')).includes('hunter2xyz'));
  for (const j of ['{"bypass":"on"}', '{"compass":"north"}', '{"surpass":"2"}']) assert.equal(cleanFree(j), j, 'a key that merely ends in pass is not a credential key');
  assert.equal(cleanFree('{"passenger":"Maya Chen"}'), '{"passenger":"Maya Chen"}', 'a word that merely starts with pass is left alone');
});

// ---- the response mask and the request pane ----
test('every class survives percent-encoding (1, 2, 3 rounds) and is masked in the response mask too', () => {
  for (const n of ALL) {
    const v = SECRETS[n]; if (/[\x00-\x1f\x7f-\x9f]/.test(v)) continue;
    let enc = v; for (let round = 1; round <= 3; round++) { enc = encodeURIComponent(enc); assert.ok(!cleanFree(`x ${enc} y`).includes(NEEDLE[n]), `${n} round ${round}`); assert.ok(!maskResponseText(`x ${enc} y`).includes(NEEDLE[n]), `${n} round ${round} response`); }
  }
});

test('text over 200,000 characters is not scanned and not kept, in the response mask as well', () => {
  assert.equal(maskResponseText('a '.repeat(100001)), '[masked:too-long]');
  assert.equal(maskResponseText('plain words'), 'plain words');
});

test('scrub (the request pane) masks strings and KEYS, never cuts, and says what it does not show', () => {
  const v = SECRETS.spPassword; const k = SECRETS.jsonPassword;
  const out = scrub({ a: v, [k]: 1, nested: { [v]: [v, 2, true, null] } });
  assert.ok(!JSON.stringify(out).includes('hunter2xyz'));
  assert.equal(Object.keys(out).length, 3);
  assert.equal(scrub('plain words '.repeat(100)).length, 1199, 'a long string is shown whole');
  assert.deepEqual(scrub(Array.from({ length: 10 }, (_, i) => i)), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], '10 items: all shown');
  assert.deepEqual(scrub(Array.from({ length: 12 }, (_, i) => i)).slice(10), ['[2 more not shown]'], '12 items: the marker says 2 more');
  const twenty = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
  assert.equal(Object.keys(scrub(twenty)).length, 20); assert.equal(Object.keys(scrub({ ...twenty, k20: 20, k21: 21 })).length, 21);
  assert.equal(scrub({ ...twenty, k20: 20, k21: 21 })['[more keys]'], '2 more not shown');
  assert.equal(scrub({ a: { b: { c: { d: { e: 1 } } } } }).a.b.c.d, '[nested too deep to show]');
  // two keys that mask to the same text are both kept
  const two = scrub({ [['pass', 'word hunter2xyz'].join('')]: 1, [['pass', 'word hunter3xyz'].join('')]: 2 });
  assert.equal(Object.keys(two).length, 2);
  let deep = {}; const head = deep; for (let i = 0; i < 100000; i++) { deep.x = {}; deep = deep.x; }
  assert.doesNotThrow(() => scrub(head));
});

test('maskDeep masks object KEYS, keeps a __proto__ key as an own key, and never loses a key to a collision', () => {
  const o = JSON.parse(`{"__proto__":{"a":"b"},"${['pass', 'word hunter2xyz'].join('')}":1,"${['pass', 'word hunter3xyz'].join('')}":2}`);
  const out = maskDeep(o);
  assert.equal(Object.keys(out).length, 3); assert.ok(Object.hasOwn(out, '__proto__')); assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.ok(!JSON.stringify(out).includes('hunter'));
});

// ---- hops, state, audit and process output: every payload in every slot ----
test('every hop pane, error, state and process output shows MASKED input: each class typed into every slot of every write', async () => {
  const out = []; const realOut = process.stdout.write.bind(process.stdout); const realErr = process.stderr.write.bind(process.stderr);
  let withHops = 0; let calls = 0;
  await withServer(async (url) => {
    await post(url, '/api/proposals', live({ proposal: { actor: K, agentId: 'ag-bedrock-02', kind: 'quarantine' } }));
    await put(url, '/api/private-network/tenant', live({ tenant: { actor: A, enabled: true } }));
    await post(url, '/api/campaign', live({ campaign: { actor: A, action: 'start' } }));
    process.stdout.write = (c, ...a) => { out.push(String(c)); return realOut(c, ...a); }; process.stderr.write = (c, ...a) => { out.push(String(c)); return realErr(c, ...a); };
    try {
      for (const name of ALL) {
        const v = SECRETS[name]; const probe = NEEDLE[name]; const e = encodeURIComponent(v);
        const conn = { actor: v, name: v, sources: [v], scopeIds: [v], enabled: v, scannerId: v, scannerRunsIn: { kind: v, id: v }, [v]: v };
        const bodies = [
          ['POST', '/api/sync', live({ sync: { actor: v, failures: [{ source: v, scope: v, kind: v, [v]: v }], [v]: v } })],
          ['POST', '/api/proposals', live({ proposal: { actor: v, agentId: v, kind: v, params: { [v]: v, key: v, value: v }, reason: v, [v]: v } })],
          ['POST', '/api/proposals', live({ proposal: { actor: K, agentId: 'ag-bedrock-01', kind: 'retag', params: { key: 'cost-center', value: v.length <= 40 ? v : 'plain' }, reason: v } })],
          ['POST', '/api/proposals', live({ proposal: { actor: 'password hunter2xyz', agentId: v, kind: 'quarantine' } })],
          ['POST', `/api/proposals/${e}/decision`, live({ decision: { actor: v, decision: v, comment: v, [v]: v } })],
          ['POST', '/api/proposals/prop-0001/decision', live({ decision: { actor: A, decision: 'deny', comment: v } })],
          ['POST', `/api/proposals/${e}/execute`, live({ execute: { actor: v, [v]: v } })],
          ['POST', '/api/campaign', live({ campaign: { actor: v, action: v, [v]: v } })],
          ['POST', `/api/campaign/items/${e}/decision`, live({ decision: { actor: v, decision: v, comment: v } })],
          ['POST', '/api/campaign/items/ci-0002/decision', live({ decision: { actor: K, decision: 'certify', comment: v } })],
          ['POST', '/api/custodians/depart', live({ depart: { actor: v, person: v, successor: v, [v]: v } })],
          ['POST', '/api/provider/change', live({ change: { agentId: v, present: v, [v]: v } })],
          ['PUT', '/api/org/onboarding', live({ onboarding: { actor: v, ous: [v], [v]: v } })],
          ['PUT', '/api/private-network/tenant', live({ tenant: { actor: v, enabled: v, [v]: v } })],
          ['POST', '/api/private-network/connections', live({ connection: conn })],
          ['POST', '/api/private-network/connections', live({ connection: { actor: A, name: v, sources: ['lex'], scopeIds: ['000000000002'], enabled: true, scannerId: 's', scannerRunsIn: { kind: 'aws-account', id: '000000000009' } } })],
          ['PUT', `/api/private-network/connections/${e}`, live({ connection: conn })],
          ['POST', '/api/private-network/connector/poll', live({ poll: { actor: v, [v]: v } })],
          ['POST', `/api/gateways/${e}/actions`, live({ action: { actor: v, kind: v, target: v, enabled: v, mode: v, confirm: v, runtime: v, endpoint: v, session: v, [v]: v } })],
          ['POST', '/api/gateways/gw-lab-01/actions', live({ action: { actor: A, kind: 'pin-endpoint', endpoint: v } })],
          ['POST', '/api/gateways/gw-lab-01/actions', live({ action: { actor: A, kind: 'set-enforcement', mode: v, confirm: v } })],
        ];
        const texts = [];
        for (const [m, p, b] of bodies) {
          const r = await (m === 'PUT' ? put : post)(url, p, b); const t = await r.text(); calls += 1;
          texts.push(`${m} #${calls} ${r.status} ${t} ${[...r.headers.values()].join(' ')}`);
          let j = null; try { j = JSON.parse(t); } catch { /* not JSON */ }
          if (j?.hops?.length) { withHops += 1; assert.ok(!JSON.stringify(j.hops).includes(probe), `${name} ${m} call #${calls}: the hop pane shows the raw input`); }
        }
        for (const g of [`/api/state?mode=live&vertical=${e}&scenario=${e}`, `/api/story?vertical=${e}`, `/api/diagram?name=${e}`, `/api/${e}`, `/${e}`]) { const r = await get(url, g); texts.push(`GET ${r.status} ${await r.text()}`); }
        const all = texts.join('\n');
        assert.ok(!all.includes(probe), `${name}: the raw value is absent from every answer: ${all.split('\n').filter((l) => l.includes(probe)).map((l) => l.slice(0, 150)).join(' | ')}`);
        assert.ok(!JSON.stringify(await (await get(url, '/api/state?mode=live')).json()).includes(probe), `${name}: absent from the state afterwards`);
      }
    } finally { process.stdout.write = realOut; process.stderr.write = realErr; }
  }, { webDist: '/nonexistent/dist' });
  for (const n of ALL) assert.ok(!out.join('').includes(NEEDLE[n]), `${n}: nothing was logged`);
  assert.ok(withHops >= 300, `${withHops} of ${calls} answers carried a hop pane (the check is not vacuous)`);
});

test('the sweep\'s exact repros (mode live): D105 leaked these four', async () => {
  await withServer(async (url) => {
    const ws = { 'x-workspace': 'repro-1' };
    const r1 = await post(url, '/api/proposals', live({ proposal: { actor: 'priya.nair', agentId: 'ag-bedrock-01', kind: 'delete', params: {}, reason: ['pass\x00', 'word=hunter2xyz'].join('') } }), ws);
    const b1 = await r1.json(); assert.ok(!JSON.stringify(b1).includes('hunter2xyz'), 'reason with a NUL in the keyword');
    assert.ok(b1.hops.length > 0 && b1.hops[0].request.body.reason.includes('[masked:'));
    const r2 = await post(url, '/api/proposals', live({ proposal: { actor: 'priya.nair', agentId: 'ag-bedrock-01', kind: 'delete', params: {}, reason: ['pass', 'word hunter2xyz'].join('') } }), { 'x-workspace': 'repro-2' });
    assert.ok(!JSON.stringify(await r2.json()).includes('hunter2xyz'), 'keyword + space');
    const r3 = await post(url, '/api/proposals', live({ proposal: { actor: 'priya.nair', agentId: 'ag-bedrock-01', kind: 'delete', params: {}, reason: ['{"pass', 'word":"hunter2xyz"}'].join('') } }), { 'x-workspace': 'repro-3' });
    assert.ok(!JSON.stringify(await r3.json()).includes('hunter2xyz'), 'JSON text');
    const r4 = await post(url, '/api/campaign', live({ campaign: { actor: ['pass', 'word hunter2xyz'].join(''), action: 'start' } }), { 'x-workspace': 'repro-4' });
    const b4 = await r4.json(); assert.ok(!JSON.stringify(b4).includes('hunter2xyz'), 'actor in hops[0].request.body.actor'); assert.ok(b4.hops[0].request.body.actor.includes('[masked:'));
    const id = encodeURIComponent(['{"pass', 'word":"hunter2xyz"}'].join(''));
    const r5 = await post(url, `/api/proposals/${id}/decision`, live({ decision: { actor: A, decision: 'approve' } }), { 'x-workspace': 'repro-5' });
    const b5 = await r5.json(); assert.ok(!JSON.stringify(b5).includes('hunter2xyz'), 'proposalId in the path'); assert.ok(b5.hops[0].request.body.proposalId.includes('[masked:'));
    // retag value and campaign item comment
    const r6 = await post(url, '/api/proposals', live({ proposal: { actor: K, agentId: 'ag-bedrock-02', kind: 'retag', params: { key: 'environment', value: ['pass', 'word hunter2xyz'].join('') } } }), { 'x-workspace': 'repro-6' });
    const b6 = await r6.json(); assert.equal(r6.status, 200); assert.ok(!JSON.stringify(b6).includes('hunter2xyz')); assert.ok(!JSON.stringify(b6.state.agents.map((a) => a.tags)).includes('hunter2xyz')); assert.ok(!JSON.stringify(b6.state.proposals.map((p) => p.params)).includes('hunter2xyz'));
    await post(url, '/api/campaign', live({ campaign: { actor: A, action: 'start' } }), { 'x-workspace': 'repro-7' });
    const item = (await (await get(url, '/api/state?mode=live', { 'x-workspace': 'repro-7' })).json()).state.campaign.items.find((i) => i.custodian === K);
    const r7 = await post(url, `/api/campaign/items/${item.id}/decision`, live({ decision: { actor: K, decision: 'certify', comment: ['pass\x7f', 'word=hunter2xyz'].join('') } }), { 'x-workspace': 'repro-7' });
    const b7 = await r7.json(); assert.equal(r7.status, 200); assert.ok(!JSON.stringify(b7).includes('hunter2xyz'));
    assert.ok(!JSON.stringify(b7.state.campaign.items).includes('hunter2xyz'));
  });
});

// ---- lengths: refused whole, over HTTP; masked before anything is compared ----
test('lengths over HTTP: the number typed is accepted, one more is refused whole with a fixed message; text after 19,990 filler characters is refused, never cut', async () => {
  const chars = (n) => 'plain words '.repeat(60).slice(0, n - 1) + 'z';
  await withServer(async (url) => {
    const W = (id) => ({ 'x-workspace': id });
    const prop = (ws, reason, kind = 'quarantine', agentId = 'ag-bedrock-02') => post(url, '/api/proposals', live({ proposal: { actor: K, agentId, kind, params: {}, reason } }), W(ws));
    assert.equal((await prop('len-1', chars(300))).status, 200);
    const over = await prop('len-2', chars(301)); assert.equal(over.status, 400); const ob = await over.json();
    assert.equal(ob.error, 'reason_too_long'); assert.equal(ob.detail, 'reason is at most 300 characters; nothing was changed'); assert.equal(ob.state.proposals.length, 0, 'nothing was created');
    const far = await prop('len-3', `${'x '.repeat(9995)}${['pass', 'word hunter2xyz'].join('')}`); assert.equal(far.status, 400);
    const fb = JSON.stringify(await far.json()); assert.ok(!fb.includes('hunter2xyz'), 'the value after 19,990 filler characters is masked in the refusal'); assert.ok(fb.includes('[masked:'), 'and the pane shows it masked, whole');
    // comment 200 / 201 and value 40 / 41 and name 60 / 61 through their endpoints
    const p = await (await prop('len-4', 'ok')).json(); const id = p.result.proposalId;
    const dec = (c) => post(url, `/api/proposals/${id}/decision`, live({ decision: { actor: A, decision: 'approve', comment: c } }), W('len-4'));
    assert.equal((await dec(chars(201))).status, 400);
    assert.equal((await dec(chars(200))).status, 200);
    const tag = (v, ws) => post(url, '/api/proposals', live({ proposal: { actor: K, agentId: 'ag-bedrock-02', kind: 'retag', params: { key: 'data-class', value: v } } }), W(ws));
    assert.equal((await tag(chars(41), 'len-5')).status, 400); assert.equal((await tag(chars(40), 'len-6')).status, 200);
    await put(url, '/api/private-network/tenant', live({ tenant: { actor: A, enabled: true } }), W('len-7'));
    const conn = (name, ws) => post(url, '/api/private-network/connections', live({ connection: { actor: A, name, sources: ['lex'], scopeIds: ['000000000002'], enabled: true, scannerId: 's1', scannerRunsIn: { kind: 'aws-account', id: '000000000009' } } }), W(ws));
    assert.equal((await conn(chars(61), 'len-7')).status, 400); assert.equal((await conn(chars(60), 'len-7')).status, 200);
  });
});

// ---- E: static files, methods, fallbacks ----
test('E: a missing file is a fixed JSON 404 (never the page), a wrong method is 405 with Allow, nothing answers with Express\'s own HTML', async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'agl-sweep-')); fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>page</title>'); fs.writeFileSync(path.join(dist, 'app.js'), 'console.log(1)'); fs.writeFileSync(path.join(dist, '.secret'), 'x'); fs.mkdirSync(path.join(dist, 'assets'));
  try {
    await withServer(async (url) => {
      const host = new URL(url).host; const raw = (p, method = 'GET', headers = {}) => rawHttp(`${url}${p}`, { method, headers: { host, origin: url, ...headers } });
      for (const p of ['/assets/missing.js', '/favicon.ico', '/robots.txt', '/foo.map', '/foo.svg', '/sitemap.xml', '/.env', '/.git/config', '/.secret', '/a/.hidden', '/x.y/z', '/index.htm', '/api', '/api/', '/API/x', '/api/nope']) {
        const r = await raw(p); assert.equal(r.status, 404, p); assert.match(r.headers['content-type'], /application\/json/, p); assert.deepEqual(JSON.parse(r.text), { error: 'not_found' }, p);
      }
      for (const p of ['/', '/inventory', '/some/route', '/assets', '/assets/']) { // /assets is a real directory here: no redirect, the page
         const r = await raw(p); assert.equal(r.status, 200, p); assert.match(r.headers['content-type'], /text\/html/, p); assert.match(r.text, /<title>page<\/title>/); }
      assert.equal((await raw('/app.js')).status, 200, 'a file that exists is served');
      for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) { const r = await raw('/', m); assert.equal(r.status, 405, m); assert.equal(r.headers.allow, 'GET, HEAD'); assert.deepEqual(JSON.parse(r.text), { error: 'method_not_allowed' }); }
      for (const [m, p, allow] of [['POST', '/api/state', 'GET'], ['DELETE', '/api/story', 'GET'], ['PUT', '/api/health', 'GET'], ['POST', '/api/info', 'GET'], ['GET', '/api/sync', 'POST'], ['GET', '/api/reset', 'POST'], ['POST', '/api/org/onboarding', 'PUT'], ['GET', '/api/proposals/prop-0001/decision', 'POST']]) {
        const r = await raw(p, m); assert.equal(r.status, 405, `${m} ${p}`); assert.equal(r.headers.allow, allow, `${m} ${p}`); assert.deepEqual(JSON.parse(r.text), { error: 'method_not_allowed' });
      }
      for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) for (const p of ['/nowhere', '/a/b/c', '/x.js']) { const r = await raw(p, m); assert.equal(r.status, 404, `${m} ${p}`); assert.deepEqual(JSON.parse(r.text), { error: 'not_found' }); }
      for (const p of ['/%', '/%E0%A4%A', '/a%zz', '/api/%']) { const r = await raw(p); assert.ok(r.status === 400 || r.status === 404 || r.status === 200, `${p} ${r.status}`); assert.ok(!/<pre>|Cannot|URIError|node_modules/.test(r.text), `${p}: ${r.text.slice(0, 80)}`); }
      const bad = await rawHttp(`${url}/api/sync`, { method: 'POST', headers: { host, origin: url, 'content-type': 'application/json' }, body: '{' }); assert.equal(bad.status, 400); assert.deepEqual(JSON.parse(bad.text), { error: 'bad_request' });
      const big = await rawHttp(`${url}/api/sync`, { method: 'POST', headers: { host, origin: url, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'live', pad: 'x'.repeat(40000) }) }); assert.equal(big.status, 413); assert.deepEqual(JSON.parse(big.text), { error: 'payload_too_large' });
      const broken = await rawHttp(`${url}/api/sync`, { method: 'POST', headers: { host, origin: url, 'content-type': 'application/json' }, body: '{"mode": "live", "x": ' + ['pass', 'word hunter2xyz'].join('') }); assert.equal(broken.status, 400); assert.ok(!broken.text.includes('hunter2xyz')); assert.deepEqual(JSON.parse(broken.text), { error: 'bad_request' });
    }, { webDist: dist });
  } finally { fs.rmSync(dist, { recursive: true, force: true }); }
});

// ---- F: workspace ids ----
test('F: credential-looking workspace ids are refused with a fixed 400 bad_workspace and never echoed; the ids the page makes are accepted; 40 characters is the limit', async () => {
  const hex = (n) => 'a3f9c2e17b4d58a6f0c1e9d27b3a45c8e6f1d097'.slice(0, n);
  const BAD = ['pw-hunter2xyz', 'sk-abcdefghijklmnop1234', hex(24), hex(40), `w-${hex(24)}`, 'abcdef'.repeat(4), 'ghp-abcdefghijkl', 'glpat-abcdef', 'xoxb-1234-abcd', 'password-1', 'a-token-b', 'secret-1', 'bearer-abc', 'pwd-1', 'pass-1', 'akia-abc', 'eyjhbgcioijiuzi1nij9', 'eyjx', 'ab-'.repeat(13) + 'ab', '4111111111111111', 'w-4111111111111111', 'Upper', 'a b', 'a_b', '', 'a.b'];
  const GOOD = ['default', 'w-0123456789abcdef', 'ws-a', 'parity-0', 'ab-'.repeat(13) + 'a', 'abcdef'.repeat(4).slice(0, 23), 'my-tokens', 'tokens-1', 'passwords', 'a'];
  for (const id of BAD) assert.equal(validWorkspaceId(id), false, JSON.stringify(id));
  for (const id of GOOD) assert.equal(validWorkspaceId(id), true, id);
  assert.equal(BAD.length, 26); assert.equal(GOOD.length, 10);
  await withServer(async (url) => {
    for (const id of BAD) {
      if (id === '' || /[^\x20-\x7e]/.test(id)) continue;
      for (const [path, send] of [['/api/state?mode=live', (h) => get(url, '/api/state?mode=live', h)], ['/api/sync', (h) => post(url, '/api/sync', live(), h)], ['/api/reset', (h) => post(url, '/api/reset', {}, h)]]) {
        const r = await send({ 'x-workspace': id }); const t = await r.text();
        assert.equal(r.status, 400, `${id} ${path}`); assert.deepEqual(JSON.parse(t), { error: 'bad_workspace' }, `${id} ${path}`);
      }
    }
    for (const id of GOOD) { const r = await post(url, '/api/sync', live(), { 'x-workspace': id }); assert.equal(r.status, 200, id); assert.equal((await r.json()).workspace, id); }
  });
});

test('a value that masks LONGER than it was typed still executes: the 40-character limit is checked on what was typed, once', () => {
  const typed = Array.from({ length: 4 }, () => 'pw a1b2c3').join(' '); // 39 characters
  assert.equal(typed.length, 39);
  const e = newEngine();
  const p = e.propose({ actor: K, agentId: 'ag-bedrock-02', kind: 'retag', params: { key: 'data-class', value: typed } });
  const shown = e.snapshot().proposals[0].params.value;
  assert.ok(shown.length > 40 && !shown.includes('a1b2c3'), `masked is longer than 40: ${shown.length}`);
  e.decide({ actor: A, proposalId: p.proposalId, decision: 'approve' });
  const x = e.execute({ actor: A, proposalId: p.proposalId });
  assert.equal(x.status, 'executed', 'not stale: the execute-time re-check does not clean or length-check the stored value again');
  assert.equal(e.snapshot().agents.find((a) => a.id === 'ag-bedrock-02').tags['data-class'], shown);
});
