// A credential the visitor types must come back in NO response field, hop pane, audit entry, log line or error: tested by typing every
// credential shape into every field, query, path, header and unknown key of every endpoint, and searching every answer, the state afterwards and the process output for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { A, K, get, post, put, withServer } from './helpers.js';
import { SECRETS, NEEDLE } from './secrets.js';

const NEEDLES = Object.fromEntries(Object.entries(SECRETS).map(([k, v]) => [k, { raw: v, probe: NEEDLE[k] }]));
const live = (extra = {}) => ({ mode: 'live', vertical: 'finance', ...extra });
const e = encodeURIComponent;

test('typing every credential shape into every field of every endpoint never echoes it', async () => {
  const out = []; const realOut = process.stdout.write.bind(process.stdout); const realErr = process.stderr.write.bind(process.stderr);
  await withServer(async (url) => {
    // something real to act on: a proposal, a connection, a campaign
    await post(url, '/api/proposals', live({ proposal: { actor: K, agentId: 'ag-bedrock-02', kind: 'quarantine' } }));
    await put(url, '/api/private-network/tenant', live({ tenant: { actor: A, enabled: true } }));
    await post(url, '/api/campaign', live({ campaign: { actor: A, action: 'start' } }));
    const sweep = async (v) => {
      const conn = (x) => ({ actor: x, name: x, sources: [x], scopeIds: [x], enabled: x, scannerId: x, scannerRunsIn: { kind: x, id: x }, [x]: x });
      const bodies = [
        ['POST', '/api/sync', live({ sync: { actor: v, failures: [{ source: v, scope: v, kind: v, [v]: v }], [v]: v } })],
        ['POST', '/api/sync', live({ sync: { failures: [{ source: 'lex', kind: v }] } })],
        ['POST', '/api/sync', live({ sync: { failures: [{ scope: v, kind: 'timeout' }] } })],
        ['POST', '/api/sync', live({ [v]: v })],
        ['POST', '/api/proposals', live({ proposal: { actor: v, agentId: v, kind: v, params: { [v]: v, key: v, value: v, field: v, permissionId: v, flowId: v, credentialId: v, to: v }, reason: v } })],
        ['POST', '/api/proposals', live({ proposal: { actor: K, agentId: 'ag-bedrock-01', kind: 'retag', params: { key: 'cost-center', value: `v ${v}` }, reason: `r ${v}` } })],
        ['POST', '/api/proposals', live({ proposal: { actor: K, agentId: 'ag-bedrock-01', kind: 'strip-role', params: { permissionId: v } } })],
        ['POST', '/api/proposals', live({ proposal: { actor: K, agentId: 'ag-bedrock-01', kind: 'transfer', params: { to: v } } })],
        ['POST', `/api/proposals/${e(v)}/decision`, live({ decision: { actor: v, decision: v, comment: v, [v]: v } })],
        ['POST', '/api/proposals/prop-0001/decision', live({ decision: { actor: A, decision: 'deny', comment: `c ${v}` } })],
        ['POST', '/api/proposals/prop-0001/decision', live({ decision: { actor: v, decision: 'approve', comment: v } })],
        ['POST', `/api/proposals/${e(v)}/execute`, live({ execute: { actor: v, [v]: v } })],
        ['POST', '/api/campaign', live({ campaign: { actor: v, action: v, [v]: v } })],
        ['POST', `/api/campaign/items/${e(v)}/decision`, live({ decision: { actor: v, decision: v, comment: v } })],
        ['POST', '/api/campaign/items/ci-0002/decision', live({ decision: { actor: K, decision: 'certify', comment: `ok ${v}` } })],
        ['POST', '/api/custodians/depart', live({ depart: { actor: v, person: v, successor: v, [v]: v } })],
        ['POST', '/api/provider/change', live({ change: { agentId: v, present: v, [v]: v } })],
        ['PUT', '/api/org/onboarding', live({ onboarding: { actor: v, ous: [v], [v]: v } })],
        ['PUT', '/api/private-network/tenant', live({ tenant: { actor: v, enabled: v, [v]: v } })],
        ['POST', '/api/private-network/connections', live({ connection: conn(v) })],
        ['POST', '/api/private-network/connections', live({ connection: { actor: A, name: `n ${v}`, sources: ['lex'], scopeIds: ['000000000002'], enabled: true, scannerId: 's', scannerRunsIn: { kind: 'aws-account', id: '000000000009' } } })],
        ['PUT', `/api/private-network/connections/${e(v)}`, live({ connection: conn(v) })],
        ['PUT', '/api/private-network/connections/conn-001', live({ connection: { actor: A, name: `renamed ${v}` } })],
        ['POST', '/api/private-network/connector/poll', live({ poll: { actor: v, [v]: v } })],
        ['POST', `/api/gateways/${e(v)}/actions`, live({ action: { actor: v, kind: v, target: v, enabled: v, mode: v, confirm: v, runtime: v, endpoint: v, session: v, [v]: v } })],
        ...['set-target', 'set-waf', 'close-bypass', 'pin-endpoint', 'end-session', 'set-enforcement'].map((kind) => ['POST', '/api/gateways/gw-lab-01/actions', live({ action: { actor: A, kind, target: v, enabled: false, mode: v, confirm: v, runtime: v, endpoint: v, session: v } })]),
        ['POST', '/api/gateways/gw-lab-01/actions', live({ action: { actor: A, kind: 'pin-endpoint', endpoint: `https://${v}.example` } })],
        ['POST', '/api/reset', { [v]: v }],
      ];
      const gets = [`/api/state?mode=${e(v)}`, `/api/state?mode=live&vertical=${e(v)}&scenario=${e(v)}`, `/api/state?mode=mock&scenario=${e(v)}`, `/api/story?vertical=${e(v)}`, `/api/diagram?name=${e(v)}&vertical=${e(v)}`, `/api/${e(v)}`, `/api/health?x=${e(v)}`];
      const texts = [];
      for (const [m, p, b] of bodies) { const r = await (m === 'PUT' ? put : post)(url, p, b); texts.push(`${m} ${r.status} ${await r.text()} ${[...r.headers.values()].join(' ')}`); }
      for (const g of gets) { const r = await get(url, g); texts.push(`GET ${r.status} ${await r.text()} ${[...r.headers.values()].join(' ')}`); }
      for (const hv of [v, `a ${v}`]) { const r = await get(url, '/api/state?mode=live', { 'x-workspace': hv.slice(0, 40).replace(/[^\x20-\x7e]/g, '?') }); texts.push(`H ${r.status} ${await r.text()}`); }
      for (const hv of [v]) { const r = await post(url, '/api/sync', live({}), { traceparent: hv.replace(/[^\x20-\x7e]/g, '?') }); texts.push(`T ${r.status} ${await r.text()} ${[...r.headers.values()].join(' ')}`); }
      return texts.join('\n');
    };
    process.stdout.write = (c, ...a) => { out.push(String(c)); return realOut(c, ...a); }; process.stderr.write = (c, ...a) => { out.push(String(c)); return realErr(c, ...a); };
    try {
      for (const [name, n] of Object.entries(NEEDLES)) {
        const text = await sweep(n.raw);
        assert.ok(!text.includes(n.probe), `${name}: the raw value is absent from every answer: ${text.split('\n').filter((l) => l.includes(n.probe)).map((l) => l.slice(0, 160)).join(' | ')}`);
        const state = JSON.stringify(await (await get(url, '/api/state?mode=live')).json());
        assert.ok(!state.includes(n.probe), `${name}: absent from the state afterwards`);
      }
    } finally { process.stdout.write = realOut; process.stderr.write = realErr; }
  });
  for (const n of Object.values(NEEDLES)) assert.ok(!out.join('').includes(n.probe), 'nothing was logged');
});

test('a credential in a real, accepted action is masked in the response, the hops, the proposals and the audit trail', async () => {
  await withServer(async (url) => {
    for (const [name, n] of Object.entries(NEEDLES)) {
      const ws = `echo-${name.toLowerCase()}`.slice(0, 30).replace(/[^a-z0-9-]/g, '-'); const W = { 'x-workspace': ws };
      const r = await post(url, '/api/proposals', live({ proposal: { actor: K, agentId: 'ag-bedrock-02', kind: 'retag', params: { key: 'data-class', value: `v ${n.raw}` }, reason: `please ${n.raw} thanks` } }), W);
      const body = await r.text();
      assert.equal(r.status, 200, name); assert.ok(!body.includes(n.probe), `${name}: not in the answer`); assert.match(body, /\[masked:/);
      const id = JSON.parse(body).result.proposalId;
      const d = await post(url, `/api/proposals/${id}/decision`, live({ decision: { actor: A, decision: 'approve', comment: `ok ${n.raw}` } }), W); const db = await d.text();
      assert.equal(d.status, 200); assert.ok(!db.includes(n.probe), `${name}: not in the decision answer`);
      assert.ok(db.includes('"audit"') && db.includes('"proposals"') && db.includes('"hops"'));
      const x = await post(url, `/api/proposals/${id}/execute`, live({ execute: { actor: A } }), W); assert.ok(!(await x.text()).includes(n.probe));
      const c = await post(url, '/api/private-network/connections', live({ connection: { actor: A, name: `n ${n.raw}`, sources: ['lex'], scopeIds: ['000000000002'], enabled: true, scannerId: 's', scannerRunsIn: { kind: 'aws-account', id: '000000000009' } } }), W);
      assert.ok(!(await c.text()).includes(n.probe), `${name}: not in a connection answer`);
    }
  });
});

test('field names are not echoed either: an unknown key that is itself a credential never comes back', async () => {
  await withServer(async (url) => {
    for (const n of Object.values(NEEDLES)) {
      for (const [m, p, b] of [['POST', '/api/proposals', { proposal: { actor: A, agentId: 'ag-bedrock-01', kind: 'quarantine', [n.raw]: 1 } }], ['POST', '/api/sync', { sync: { [n.raw]: 1 } }], ['POST', '/api/gateways/gw-lab-01/actions', { action: { actor: A, kind: 'end-session', session: 's-0001', [n.raw]: 1 } }], ['PUT', '/api/org/onboarding', { onboarding: { actor: A, ous: [], [n.raw]: 1 } }]]) {
        const r = await (m === 'PUT' ? put : post)(url, p, live(b)); const t = await r.text();
        assert.equal(r.status, 400, p); assert.ok(!t.includes(n.probe));
      }
    }
  });
});
