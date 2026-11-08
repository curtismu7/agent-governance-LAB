import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { A, A2, C, K, K2, api, get, json, post, put, rawHttp, withServer, W } from './helpers.js';
import { installNetguard } from '../src/netguard.js';
import { mockState } from '../src/service.js';
import { MOCK_TABLE } from '../src/mockTable.js';

const guard = installNetguard();

test('health, info and story answer; the story fills every token for every vertical and carries the deck\'s numbers as the deck\'s', async () => {
  await withServer(async (url) => {
    const h = await json(await get(url, '/api/health'));
    assert.equal(h.schema, 'demo-health/1'); assert.equal(h.demo.id, 'agent-governance-lab');
    const info = await json(await get(url, '/api/info'));
    assert.deepEqual([info.simulated, info.unverified, info.release], [true, true, '2026-11-02']);
    for (const v of ['finance', 'health', 'retail']) {
      const s = await json(await get(url, `/api/story?vertical=${v}`));
      assert.ok(!/\{\{/.test(JSON.stringify(s)), v);
      assert.equal(s.sources.length, 13); assert.equal(s.vertical, v); assert.equal(s.findings.length, 13);
      assert.deepEqual([s.deckNumbers.sources, s.deckNumbers.findings, s.deckNumbers.levels], [13, 46, 5]);
    }
    assert.equal((await json(await get(url, '/api/story?vertical=__proto__'))).vertical, 'finance', 'an unknown vertical falls back, never errors');
  });
});

test('rule 19: POST /api/mode takes exactly {source: mock|real}, holds the mode server-side, and /api/info reports it', async () => {
  await withServer(async (url) => {
    let info = await json(await get(url, '/api/info'));
    assert.equal(info.source, 'mock'); assert.equal(info.mode, 'mock'); assert.equal(info.realAvailable, true);
    let r = await post(url, '/api/mode', { source: 'real' });
    assert.equal(r.status, 200);
    let body = await r.json();
    assert.equal(body.source, 'real'); assert.equal(body.mode, 'live');
    info = await json(await get(url, '/api/info'));
    assert.equal(info.source, 'real'); assert.equal(info.mode, 'live');
    // real→mock switches back
    r = await post(url, '/api/mode', { source: 'mock' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).source, 'mock');
    info = await json(await get(url, '/api/info'));
    assert.equal(info.source, 'mock');
    // the body must be exactly {source}: anything else is 400
    for (const b of [{ source: 'live' }, { mode: 'live' }, {}, { source: 'real', extra: 1 }]) {
      const rr = await post(url, '/api/mode', b);
      assert.ok(rr.status === 400 || rr.status === 404, JSON.stringify(b));
    }
  });
});

test('the state: Mock gives a generated scenario, Live gives the workspace engine, both the same shape', async () => {
  await withServer(async (url) => {
    const m = await json(await get(url, '/api/state?mode=mock&vertical=finance&scenario=partial-failure'));
    const l = await json(await get(url, '/api/state?mode=live&vertical=finance'));
    assert.equal(m.scenario.id, 'partial-failure'); assert.equal(m.scenarios.length, 8);
    assert.deepEqual(Object.keys(m.state).sort(), Object.keys(l.state).sort(), 'one shape for both');
    assert.equal(l.state.agents.length, 23);
    assert.equal((await json(await get(url, '/api/state?mode=mock&scenario=nope'))).scenario.id, 'first-scan', 'an unknown scenario falls back');
    assert.equal((await get(url, '/api/state?mode=prod')).status, 400);
    assert.equal((await get(url, '/api/state')).status, 400);
    assert.equal((await get(url, '/api/state?mode=live', W('Bad Id'))).status, 400);
    assert.equal(mockState(MOCK_TABLE, 'finance', 'discover').scenario.id, 'discover');
  });
});

const WRITES = [
  ['post', '/api/sync', {}], ['post', '/api/proposals', { proposal: {} }], ['post', '/api/proposals/prop-0001/decision', { decision: {} }], ['post', '/api/proposals/prop-0001/execute', { execute: {} }],
  ['post', '/api/campaign', { campaign: {} }], ['post', '/api/campaign/items/ci-0001/decision', { decision: {} }], ['post', '/api/custodians/depart', { depart: {} }], ['post', '/api/provider/change', { change: {} }],
  ['put', '/api/org/onboarding', { onboarding: {} }], ['put', '/api/private-network/tenant', { tenant: {} }], ['post', '/api/private-network/connections', { connection: {} }],
  ['put', '/api/private-network/connections/conn-001', { connection: {} }], ['post', '/api/private-network/connector/poll', { poll: {} }], ['post', '/api/gateways/gw-lab-01/actions', { action: {} }],
];

test('Mock is read-only: every write is refused with 409 and changes nothing', async () => {
  await withServer(async (url) => {
    const calls = WRITES.map(([m, p, b]) => (m === 'put' ? put : post)(url, p, { mode: 'mock', vertical: 'finance', ...b }));
    for (const r of await Promise.all(calls)) { assert.equal(r.status, 409); assert.equal((await r.json()).error, 'mock_is_read_only'); }
    const l = await json(await get(url, '/api/state?mode=live'));
    assert.deepEqual([l.state.proposals.length, l.state.audit.length, l.state.sync.runs.length], [0, 1, 1]);
  });
});

test('writes need a mode of mock or live, an object body, and only known top-level keys; the refusal never names the field', async () => {
  await withServer(async (url) => {
    assert.equal((await post(url, '/api/sync', { vertical: 'finance' })).status, 400);
    assert.equal((await post(url, '/api/sync', { mode: 'prod' })).status, 400);
    assert.equal((await post(url, '/api/sync', [1])).status, 400);
    const secret = ['gh', 'p_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('');
    const r = await post(url, '/api/sync', { mode: 'live', [secret]: 1 }); const t = await r.text();
    assert.equal(r.status, 400); assert.ok(!t.includes(secret)); assert.match(t, /unknown_field/);
    const r2 = await api(url, 'POST', '/api/sync', { sync: { [secret]: 1 } }); assert.equal(r2.status, 400); assert.equal(r2.body.error, 'unknown_field');
    for (const bad of ['x', 5, [1], null]) { const r3 = await api(url, 'POST', '/api/proposals', { proposal: bad }); assert.equal(r3.status, 400, JSON.stringify(bad)); assert.equal(r3.body.error, 'unknown_field'); }
  });
});

test('Live: a partial sync, a proposal, a refused self-approval, an approval and the execute, each with hops and the whole state back', async () => {
  await withServer(async (url) => {
    const s = await api(url, 'POST', '/api/sync', { sync: { failures: [{ source: 'vertexai', kind: 'timeout' }] } });
    assert.equal(s.status, 200); assert.equal(s.body.result.outcome, 'partial'); assert.equal(s.body.result.removedFromProvider, 0);
    assert.equal(s.body.state.sync.last.outcome, 'partial'); assert.ok(s.body.hops.length > 5 && s.body.hops[0].label === 'browser to the lab API');
    const p = await api(url, 'POST', '/api/proposals', { proposal: { actor: K, agentId: 'ag-bedrock-02', kind: 'quarantine', reason: 'admin grant' } });
    assert.equal(p.status, 200); const id = p.body.result.proposalId;
    const self = await api(url, 'POST', `/api/proposals/${id}/decision`, { decision: { actor: K, decision: 'approve' } });
    assert.equal(self.status, 403); assert.deepEqual([self.body.ok, self.body.error], [false, 'self_approval']); assert.ok(self.body.state.audit.some((a) => a.kind === 'refused:self_approval'));
    const early = await api(url, 'POST', `/api/proposals/${id}/execute`, { execute: { actor: K } });
    assert.equal(early.status, 409); assert.equal(early.body.error, 'not_approved');
    assert.equal((await api(url, 'POST', `/api/proposals/${id}/decision`, { decision: { actor: A, decision: 'approve' } })).status, 200);
    const run = await api(url, 'POST', `/api/proposals/${id}/execute`, { execute: { actor: K } });
    assert.equal(run.status, 200); assert.equal(run.body.state.agents.find((a) => a.id === 'ag-bedrock-02').quarantined, true);
    assert.ok(run.body.hops.some((h) => /never sent/.test(h.label)));
    const k2 = await api(url, 'POST', '/api/proposals', { proposal: { actor: K, agentId: 'ag-bedrock-01', kind: 'quarantine' } });
    const selfK = await api(url, 'POST', `/api/proposals/${k2.body.result.proposalId}/decision`, { decision: { actor: K, decision: 'approve' } });
    assert.equal(selfK.status, 403); assert.equal(selfK.body.error, 'self_approval');
    const adm = await api(url, 'POST', '/api/proposals', { proposal: { actor: A, agentId: 'ag-vertexai-02', kind: 'quarantine' } });
    assert.equal(adm.status, 200); assert.deepEqual([adm.body.result.status, adm.body.result.immediate], ['executed', true]); assert.equal(adm.body.state.agents.find((x) => x.id === 'ag-vertexai-02').quarantined, true);
    const unknown = await api(url, 'POST', '/api/proposals/prop-9999/decision', { decision: { actor: A, decision: 'approve' } });
    assert.equal(unknown.status, 404);
  });
});

test('every refusal keeps its honest HTTP status (no flag turns a refusal into a 200)', async () => {
  await withServer(async (url) => {
    const r = await api(url, 'POST', '/api/proposals', { proposal: { actor: 'nobody', agentId: 'ag-bedrock-01', kind: 'quarantine' }, refusalsAs200: true });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'unknown_field', 'the old flag is just an unknown key now');
    const r2 = await api(url, 'POST', '/api/proposals', { proposal: { actor: 'nobody', agentId: 'ag-bedrock-01', kind: 'quarantine' } });
    assert.equal(r2.status, 400); assert.equal(r2.body.error, 'bad_actor');
    const codes = [
      [await api(url, 'POST', '/api/proposals', { proposal: { actor: K2, agentId: 'ag-bedrock-01', kind: 'quarantine' } }), 403],
      [await api(url, 'POST', '/api/proposals', { proposal: { actor: A, agentId: 'ag-databricks-01', kind: 'delete' } }), 409],
      [await api(url, 'POST', '/api/proposals', { proposal: { actor: A, agentId: 'nope', kind: 'delete' } }), 404],
      [await api(url, 'POST', '/api/gateways/gw-lab-01/actions', { action: { actor: A, kind: 'set-enforcement', mode: 'ENFORCE', confirm: 'wrong' } }), 403],
      [await api(url, 'POST', '/api/gateways/nope/actions', { action: { actor: A, kind: 'set-waf', mode: 'fail-open' } }), 404],
      [await api(url, 'PUT', '/api/private-network/tenant', { tenant: { actor: K, enabled: true } }), 403],
    ];
    for (const [r3, status] of codes) { assert.equal(r3.status, status, r3.body.error); assert.equal(r3.body.ok, false); assert.ok(r3.body.state, 'the state still comes back'); }
  });
});

test('private network over HTTP: tenant disabled refuses, Enabled is fixed, the scan discovers the private agents with the scanner location', async () => {
  await withServer(async (url) => {
    const conn = { actor: A, name: 'prod', sources: ['bedrock', 'agentcore', 'lex'], scopeIds: ['000000000002'], enabled: true, scannerId: 's1', scannerRunsIn: { kind: 'aws-account', id: '000000000009' } };
    assert.equal((await api(url, 'POST', '/api/private-network/connections', { connection: conn })).body.error, 'private_network_disabled');
    assert.equal((await api(url, 'PUT', '/api/private-network/tenant', { tenant: { actor: A, enabled: true } })).status, 200);
    const add = await api(url, 'POST', '/api/private-network/connections', { connection: conn }); assert.equal(add.status, 200);
    const fixed = await api(url, 'PUT', `/api/private-network/connections/${add.body.result.connectionId}`, { connection: { actor: A, enabled: false } });
    assert.deepEqual([fixed.status, fixed.body.error], [409, 'enabled_is_fixed']);
    assert.equal((await api(url, 'POST', '/api/private-network/connector/poll', { poll: { actor: A } })).body.state.privateNetwork.connector.inbound, 0);
    const sync = await api(url, 'POST', '/api/sync', {}); assert.equal(sync.body.result.discovered, 5, 'three new agents of the second scan and the two private ones');
    assert.equal(sync.body.state.privateNetwork.discovered.length, 2);
    assert.ok(sync.body.state.privateNetwork.discovered.every((d) => d.scannerRunsIn.id === '000000000009'));
  });
});

test('workspaces are isolated: one visitor\'s proposal, sync and Reset never touch another\'s', async () => {
  await withServer(async (url) => {
    await api(url, 'POST', '/api/proposals', { proposal: { actor: A, agentId: 'ag-bedrock-01', kind: 'quarantine' } }, 'one');
    await api(url, 'POST', '/api/sync', {}, 'two');
    const s1 = await json(await get(url, '/api/state?mode=live', W('one'))); const s2 = await json(await get(url, '/api/state?mode=live', W('two')));
    assert.deepEqual([s1.state.proposals.length, s1.state.sync.runs.length, s2.state.proposals.length, s2.state.sync.runs.length], [1, 1, 0, 2]);
    const r = await post(url, '/api/reset', {}, W('one')); assert.deepEqual(await r.json(), { reset: 'ok', workspace: 'one' });
    assert.equal((await json(await get(url, '/api/state?mode=live', W('one')))).state.proposals.length, 0);
    assert.equal((await json(await get(url, '/api/state?mode=live', W('two')))).state.sync.runs.length, 2, 'the other workspace is untouched');
    assert.equal((await post(url, '/api/reset', {}, W('Bad Id'))).status, 400);
  });
});

test('each vertical has its own engine inside a workspace; Reset clears all of them', async () => {
  await withServer(async (url) => {
    await post(url, '/api/sync', { mode: 'live', vertical: 'health' }, W('v'));
    const f = await json(await get(url, '/api/state?mode=live&vertical=finance', W('v'))); const h = await json(await get(url, '/api/state?mode=live&vertical=health', W('v')));
    assert.deepEqual([f.state.sync.runs.length, h.state.sync.runs.length], [1, 2]);
    await post(url, '/api/reset', {}, W('v'));
    assert.equal((await json(await get(url, '/api/state?mode=live&vertical=health', W('v')))).state.sync.runs.length, 1);
  });
});

test('CONCURRENCY: parallel identical proposals give exactly one, parallel approvals exactly one, parallel executes exactly one', async () => {
  await withServer(async (url) => {
    const make = () => api(url, 'POST', '/api/proposals', { proposal: { actor: K, agentId: 'ag-bedrock-02', kind: 'quarantine' } }, 'race');
    const made = await Promise.all(Array.from({ length: 12 }, make));
    assert.equal(made.filter((r) => r.status === 200).length, 1); assert.ok(made.filter((r) => r.status !== 200).every((r) => r.body.error === 'duplicate_proposal'));
    const id = made.find((r) => r.status === 200).body.result.proposalId;
    const dec = await Promise.all([A, A2, A, A2, A, A2].map((who) => api(url, 'POST', `/api/proposals/${id}/decision`, { decision: { actor: who, decision: 'approve' } }, 'race')));
    assert.equal(dec.filter((r) => r.status === 200).length, 1); assert.ok(dec.filter((r) => r.status !== 200).every((r) => r.body.error === 'already_decided'));
    const ex = await Promise.all(Array.from({ length: 6 }, () => api(url, 'POST', `/api/proposals/${id}/execute`, { execute: { actor: K } }, 'race')));
    assert.equal(ex.filter((r) => r.status === 200).length, 1); assert.ok(ex.filter((r) => r.status !== 200).every((r) => r.body.error === 'already_executed'));
    const st = (await json(await get(url, '/api/state?mode=live', W('race')))).state;
    assert.equal(st.proposals.length, 1); assert.equal(st.audit.filter((a) => a.kind === 'proposal.executed').length, 1);
    // an approval and a deny racing: exactly one wins, and the loser is refused
    const p2 = (await api(url, 'POST', '/api/proposals', { proposal: { actor: K, agentId: 'ag-bedrock-01', kind: 'quarantine' } }, 'race')).body.result.proposalId;
    const mix = await Promise.all([api(url, 'POST', `/api/proposals/${p2}/decision`, { decision: { actor: A, decision: 'approve' } }, 'race'), api(url, 'POST', `/api/proposals/${p2}/decision`, { decision: { actor: A2, decision: 'deny' } }, 'race')]);
    assert.equal(mix.filter((r) => r.status === 200).length, 1);
    // parallel syncs and a proposal never corrupt the audit numbering
    await Promise.all([...Array.from({ length: 5 }, () => api(url, 'POST', '/api/sync', {}, 'race')), api(url, 'POST', '/api/gateways/gw-lab-01/actions', { action: { actor: A, kind: 'end-session', session: 's-0001' } }, 'race')]);
    const a2 = (await json(await get(url, '/api/state?mode=live', W('race')))).state.audit;
    assert.deepEqual(a2.map((a) => a.n), a2.map((_, i) => a2[0].n + i));
  });
});

test('parallel duplicate gateway changes and parallel onboarding changes stay consistent', async () => {
  await withServer(async (url) => {
    const r = await Promise.all(Array.from({ length: 8 }, () => api(url, 'POST', '/api/gateways/gw-lab-01/actions', { action: { actor: A, kind: 'set-target', target: 'tg-1', enabled: false } }, 'g')));
    assert.equal(r.filter((x) => x.status === 200).length, 1); assert.ok(r.filter((x) => x.status !== 200).every((x) => x.body.error === 'already_in_state'));
  });
});

test('a traceparent from the caller continues its trace; a bad one starts a new trace', async () => {
  await withServer(async (url) => {
    const tid = 'a'.repeat(32);
    const r = await api(url, 'POST', '/api/sync', {}, 'default', { traceparent: `00-${tid}-${'b'.repeat(16)}-01` });
    assert.equal(r.body.traceId, tid);
    assert.ok(r.body.hops.every((h) => h.request.headers.traceparent.startsWith(`00-${tid}-`)), 'every hop carries the trace');
    assert.equal(new Set(r.body.hops.map((h) => h.request.headers.traceparent.split('-')[2])).size, r.body.hops.length, 'a new span for every hop');
    const r2 = await api(url, 'POST', '/api/sync', {}, 'default', { traceparent: 'garbage' });
    assert.notEqual(r2.body.traceId, tid); assert.match(r2.body.traceId, /^[0-9a-f]{32}$/);
    assert.equal(r2.body.hops[0].request.headers['x-workspace'], 'default');
  });
});

test('the Host check, same-origin writes, body size, JSON errors and 404 behave; no stack trace ever leaves', async () => {
  await withServer(async (url) => {
    assert.equal((await rawHttp(`${url}/api/health`, { headers: { host: 'evil.example.invalid' } })).status, 403);
    assert.equal((await post(url, '/api/reset', {}, { origin: 'http://evil.example.invalid' })).status, 403);
    assert.equal((await post(url, '/api/reset', {}, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post(url, '/api/proposals', { mode: 'live', proposal: { reason: 'x'.repeat(40000) } })).status, 413);
    const bad = await rawHttp(`${url}/api/sync`, { method: 'POST', headers: { host: new URL(url).host, 'content-type': 'application/json', origin: url }, body: '{"mode":' });
    assert.equal(bad.status, 400); assert.doesNotMatch(bad.text, /node_modules|\bat \S+ \(file:/);
    const nf = await get(url, '/api/nope'); assert.equal(nf.status, 404); assert.deepEqual(await nf.json(), { error: 'not_found' });
    const wrong = await get(url, '/api/proposals/prop-0001/decision');
    assert.equal(wrong.status, 405, 'a known route with the wrong method is 405, not 404'); assert.equal(wrong.headers.get('allow'), 'POST'); assert.deepEqual(await wrong.json(), { error: 'method_not_allowed' });
    assert.equal((await get(url, '/api/health')).headers.get('x-content-type-options'), 'nosniff');
  });
});

test('hostile ids in the path never crash or echo: odd proposal, item, connection and gateway ids', async () => {
  await withServer(async (url) => {
    for (const odd of ['__proto__', 'constructor', '%00', '%ff', 'a'.repeat(300), '../x']) {
      for (const [p, b] of [[`/api/proposals/${odd}/decision`, { decision: { actor: A, decision: 'approve' } }], [`/api/proposals/${odd}/execute`, { execute: { actor: A } }], [`/api/campaign/items/${odd}/decision`, { decision: { actor: A, decision: 'certify' } }], [`/api/gateways/${odd}/actions`, { action: { actor: A, kind: 'end-session', session: 's-1' } }]]) {
        const r = await post(url, p, { mode: 'live', vertical: 'finance', ...b });
        assert.ok([400, 404].includes(r.status), `${odd} ${p} ${r.status}`); assert.doesNotMatch(await r.text(), /node_modules|\bat \S+ \(file:/);
      }
      const c = await put(url, `/api/private-network/connections/${odd}`, { mode: 'live', connection: { actor: A, name: 'x' } }); assert.ok([400, 404].includes(c.status));
    }
  });
});

test('zero outbound network attempts across the whole API in both modes', async () => {
  await withServer(async (url) => {
    for (const mode of ['mock', 'live']) {
      await get(url, `/api/state?mode=${mode}`); await post(url, '/api/sync', { mode, vertical: 'finance' });
    }
    await api(url, 'POST', '/api/sync', { sync: { failures: [{ source: 'lex', kind: 'error' }] } });
    await api(url, 'PUT', '/api/private-network/tenant', { tenant: { actor: A, enabled: true } });
    await api(url, 'POST', '/api/gateways/gw-lab-01/actions', { action: { actor: A, kind: 'pin-endpoint', endpoint: 'https://gw1.fabrikam.example' } });
    await api(url, 'POST', '/api/custodians/depart', { depart: { actor: A, person: K2, successor: C.castCustodian3 } });
  });
  assert.deepEqual(guard.attempts, []);
});

test('F5: a known route with the wrong method answers 405 with an Allow header; an unknown route is still the fixed 404', async () => {
  await withServer(async (url) => {
    for (const [method, path, allow] of [['GET', '/api/sync', 'POST'], ['PUT', '/api/sync', 'POST'], ['DELETE', '/api/state', 'GET'], ['POST', '/api/state', 'GET'], ['POST', '/api/story', 'GET'], ['GET', '/api/reset', 'POST'], ['POST', '/api/org/onboarding', 'PUT'], ['GET', '/api/org/onboarding', 'PUT'], ['PUT', '/api/proposals', 'POST'], ['GET', '/api/private-network/connections', 'POST'], ['POST', '/api/private-network/connections/conn-001', 'PUT'], ['GET', '/api/gateways/gw-lab-01/actions', 'POST']]) {
      const r = await fetch(`${url}${path}`, { method, headers: { origin: url, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      assert.equal(r.status, 405, `${method} ${path}`); assert.equal(r.headers.get('allow'), allow, `${method} ${path}`); assert.deepEqual(await r.json(), { error: 'method_not_allowed' });
    }
    const ok = await post(url, '/api/sync', { mode: 'live' }); assert.equal(ok.status, 200, 'the right method still works');
    const none = await get(url, '/api/nothing-here'); assert.equal(none.status, 404); assert.deepEqual(await none.json(), { error: 'not_found' });
  });
});

test('F5: the page is served for routes only; a missing file (/assets/nope.js, /favicon.ico) is a fixed JSON 404, not the HTML page', async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'agl-dist-')); fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>page</title>'); fs.mkdirSync(path.join(dist, 'assets')); fs.writeFileSync(path.join(dist, 'assets', 'real.js'), 'export {}');
  try {
    await withServer(async (url) => {
      for (const p of ['/', '/inventory', '/some/deep/route', '/#sync']) { const r = await get(url, p); assert.equal(r.status, 200, p); assert.match(r.headers.get('content-type'), /text\/html/); assert.match(await r.text(), /<title>page<\/title>/); }
      for (const p of ['/assets/nope.js', '/favicon.ico', '/robots.txt', '/a/b/c.css', '/assets/real.js.map']) { const r = await get(url, p); assert.equal(r.status, 404, p); assert.match(r.headers.get('content-type'), /json/); assert.deepEqual(await r.json(), { error: 'not_found' }, p); }
      const real = await get(url, '/assets/real.js'); assert.equal(real.status, 200); assert.equal(await real.text(), 'export {}');
    }, { webDist: dist });
  } finally { fs.rmSync(dist, { recursive: true, force: true }); }
});

test('GET /api/shelf answers the shelf URL (null when unconfigured)', async () => {
  await withServer(async (url) => {
    const res = await get(url, '/api/shelf');
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.deepEqual(Object.keys(body), ['shelfUrl']);
    assert.equal(body.shelfUrl, null);
  }, { env: {} });
});

test('GET /api/shelf is reachable with no web build, reads SHELF_URL (trailing slash trimmed), and POST is refused', async () => {
  await withServer(async (url) => {
    const res = await get(url, '/api/shelf');
    assert.equal(res.status, 200);
    assert.deepEqual(await json(res), { shelfUrl: 'https://shelf.example:8443' });
    assert.notEqual((await post(url, '/api/shelf', {})).status, 200);
  }, { env: { SHELF_URL: 'https://shelf.example:8443/' }, webDist: path.join(os.tmpdir(), 'agl-no-such-dist') });
});
