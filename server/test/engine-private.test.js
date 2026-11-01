import test from 'node:test';
import assert from 'node:assert/strict';
import { A, K, agentOf, codeOf, newEngine } from './helpers.js';

const conn = (o = {}) => ({ name: 'prod-private', sources: ['bedrock', 'agentcore', 'lex'], scopeIds: ['000000000002'], enabled: true, scannerId: 'scanner-1', scannerRunsIn: { kind: 'aws-account', id: '000000000009' }, ...o });
const add = (e, c = conn()) => e.addConnection({ actor: A, connection: c });

test('a tenant that has not enabled Private network cannot add a connection or poll', () => {
  const e = newEngine();
  assert.equal(e.snapshot().privateNetwork.tenantEnabled, false);
  assert.equal(codeOf(() => add(e)), 'private_network_disabled');
  assert.equal(codeOf(() => e.connectorPoll({ actor: A })), 'private_network_disabled');
  assert.equal(e.snapshot().privateNetwork.connections.length, 0);
  assert.equal(codeOf(() => e.setPrivateTenant({ actor: K, enabled: true })), 'admin_only');
  assert.equal(codeOf(() => e.setPrivateTenant({ actor: A, enabled: 'yes' })), 'bad_value');
  assert.equal(codeOf(() => e.setPrivateTenant({ actor: A, enabled: true, x: 1 })), 'unknown_field');
  e.setPrivateTenant({ actor: A, enabled: true });
  assert.equal(add(e).connectionId, 'conn-001');
});

test('ENABLED IS FIXED once the connection is added; the same value is accepted, a change is refused, everything else may change', () => {
  const e = newEngine(); e.setPrivateTenant({ actor: A, enabled: true });
  const id = add(e, conn({ enabled: false })).connectionId;
  assert.equal(codeOf(() => e.updateConnection({ actor: A, connectionId: id, connection: { enabled: true } })), 'enabled_is_fixed');
  e.updateConnection({ actor: A, connectionId: id, connection: { enabled: false, name: 'renamed' } });
  const id2 = add(e, conn({ scannerId: 'scanner-1' })).connectionId;
  assert.equal(codeOf(() => e.updateConnection({ actor: A, connectionId: id2, connection: { enabled: false } })), 'enabled_is_fixed');
  const c = e.snapshot().privateNetwork.connections;
  assert.deepEqual([c[0].enabled, c[0].name, c[1].enabled], [false, 'renamed', true]);
  assert.equal(codeOf(() => e.updateConnection({ actor: A, connectionId: 'conn-999', connection: { name: 'x' } })), 'unknown_connection');
  for (const bad of [5, undefined, '__proto__', null]) assert.equal(codeOf(() => e.updateConnection({ actor: A, connectionId: bad, connection: { name: 'x' } })), 'unknown_connection');
  assert.equal(codeOf(() => e.updateConnection({ actor: A, connectionId: id, connection: { scannerId: 'other' } })), 'unknown_field', 'the scanner id is fixed too');
  assert.equal(codeOf(() => e.updateConnection({ actor: K, connectionId: id, connection: { name: 'x' } })), 'admin_only');
});

test('every connection one Scanner serves runs in the same place', () => {
  const e = newEngine(); e.setPrivateTenant({ actor: A, enabled: true });
  add(e);
  assert.equal(codeOf(() => add(e, conn({ scannerRunsIn: { kind: 'aws-account', id: '000000000008' } }))), 'scanner_location_mismatch');
  assert.equal(codeOf(() => add(e, conn({ scannerRunsIn: { kind: 'gcp-project', id: 'lab-project-001' } }))), 'scanner_location_mismatch');
  add(e, conn({ name: 'second' })); // the same place is fine
  add(e, conn({ scannerId: 'scanner-2', scannerRunsIn: { kind: 'azure-subscription', id: '00000000-0000-0000-0000-000000000000' } }));
  assert.equal(codeOf(() => e.updateConnection({ actor: A, connectionId: 'conn-001', connection: { scannerRunsIn: { kind: 'aws-account', id: '000000000007' } } })), 'scanner_location_shared');
  e.updateConnection({ actor: A, connectionId: 'conn-003', connection: { scannerRunsIn: { kind: 'azure-subscription', id: '00000000-0000-0000-0000-000000000001' } } });
  assert.equal(e.snapshot().privateNetwork.connections.length, 3);
});

test('connection fields are validated as a whole: types, ranges, formats, unknown keys; a bad one adds nothing', () => {
  const e = newEngine(); e.setPrivateTenant({ actor: A, enabled: true });
  const bad = [
    conn({ name: 5 }), conn({ name: '   ' }), conn({ sources: [] }), conn({ sources: ['vertexai'] }), conn({ sources: ['bedrock', 'bedrock'] }), conn({ sources: 'bedrock' }), conn({ sources: ['bedrock', 'agentcore', 'lex', 'lex'] }),
    conn({ scopeIds: [] }), conn({ scopeIds: ['proj-lab-001'] }), conn({ scopeIds: ['nope'] }), conn({ scopeIds: ['__proto__'] }), conn({ scopeIds: [5] }),
    conn({ enabled: 'true' }), conn({ enabled: undefined }), conn({ scannerId: '' }), conn({ scannerId: 'A B' }), conn({ scannerId: 5 }),
    conn({ scannerRunsIn: { kind: 'aws-account', id: '12345' } }), conn({ scannerRunsIn: { kind: 'aws-account', id: 'abcdefghijkl' } }), conn({ scannerRunsIn: { kind: 'azure-subscription', id: 'nope' } }),
    conn({ scannerRunsIn: { kind: 'gcp-project', id: 'X' } }), conn({ scannerRunsIn: { kind: 'on-prem', id: 'x' } }), conn({ scannerRunsIn: 'aws-account' }), conn({ scannerRunsIn: { kind: 'aws-account', id: '000000000009', extra: 1 } }),
    { ...conn(), extra: 1 }, 'x', null, [1],
  ];
  for (const c of bad) assert.ok(codeOf(() => add(e, c)), JSON.stringify(c));
  assert.equal(e.snapshot().privateNetwork.connections.length, 0);
  assert.equal(codeOf(() => e.addConnection({ actor: K, connection: conn() })), 'admin_only');
  assert.equal(codeOf(() => e.addConnection({ actor: A, connection: conn(), x: 1 })), 'unknown_field');
});

test('connections are capped at ten; the eleventh is refused whole', () => {
  const e = newEngine(); e.setPrivateTenant({ actor: A, enabled: true });
  for (let i = 0; i < 10; i++) add(e, conn({ name: `c${i}` }));
  assert.equal(codeOf(() => add(e)), 'workspace_full');
  assert.equal(e.snapshot().privateNetwork.connections.length, 10);
});

test('private agents are discovered only through an enabled connection that covers their account and source, and carry the scanner location', () => {
  const e = newEngine(); e.sync({});
  assert.equal(agentOf(e, 'ag-agentcore-02'), undefined);
  const r0 = e.sync({}); const part = r0.parts.find((p) => p.scope === '000000000002' && p.source === 'agentcore');
  assert.deepEqual([part.status, part.via], ['not-scanned', 'controller']);
  e.setPrivateTenant({ actor: A, enabled: true });
  add(e, conn({ enabled: false })); // Enabled false: the controller would make the calls, and it cannot reach a private network
  assert.equal(e.sync({}).discovered.length, 0);
  add(e, conn({ sources: ['lex'], scannerId: 'scanner-9' }));
  const r = e.sync({});
  assert.deepEqual(r.discovered, ['ag-lex-02'], 'only the covered source');
  assert.equal(agentOf(e, 'ag-agentcore-02'), undefined);
  assert.deepEqual(agentOf(e, 'ag-lex-02').discoveredVia, { path: 'workload-scanner', connectionId: 'conn-002', scannerRunsIn: { kind: 'aws-account', id: '000000000009' } });
  add(e, conn({ sources: ['agentcore'], scannerId: 'scanner-9' }));
  assert.deepEqual(e.sync({}).discovered, ['ag-agentcore-02']);
  const f = agentOf(e, 'ag-agentcore-02').assessment.findings;
  assert.ok(f.length > 0 && f.every((x) => x.scannerLocation.id === '000000000009'), 'findings carry the scanner location');
  assert.ok(agentOf(e, 'ag-bedrock-01').assessment.findings.every((x) => x.scannerLocation === undefined), 'a controller-found agent has none');
  assert.equal(e.snapshot().privateNetwork.discovered.length, 2);
});

test('switching the tenant setting off stops the scanning: the private agents become unknown, never gone', () => {
  const e = newEngine(); e.setPrivateTenant({ actor: A, enabled: true }); add(e); e.sync({}); e.sync({});
  assert.equal(agentOf(e, 'ag-lex-02').status, 'active');
  e.setPrivateTenant({ actor: A, enabled: false });
  const r = e.sync({});
  assert.deepEqual([r.gone, [...r.unknown].sort()], [[], ['ag-agentcore-02', 'ag-lex-02']]);
  assert.equal(r.outcome, 'not-fully-scanned', 'not scanning is not a failure (nothing is deleted for it), but the run is not complete either');
});

test('the connector only ever dials out: every poll is outbound through the proxy, and the lab makes no network call', async () => {
  const { installNetguard } = await import('../src/netguard.js'); const guard = installNetguard(); const before = guard.attempts.length;
  const e = newEngine(); e.setPrivateTenant({ actor: A, enabled: true });
  assert.equal(codeOf(() => e.connectorPoll({ actor: A })), 'no_enabled_connection');
  add(e); add(e, conn({ name: 'b' })); add(e, conn({ name: 'off', enabled: false }));
  assert.equal(e.connectorPoll({ actor: A }).polled, 2, 'a disabled connection is not polled');
  const pn = e.snapshot().privateNetwork;
  assert.equal(pn.polls.length, 2); assert.ok(pn.polls.every((p) => p.direction === 'outbound' && p.via.endsWith('.example') && p.to.endsWith('.example')));
  assert.deepEqual([pn.connector.outbound, pn.connector.inbound], [2, 0]);
  assert.equal(codeOf(() => e.connectorPoll({ actor: K })), 'admin_only');
  for (let i = 0; i < 40; i++) e.connectorPoll({ actor: A });
  assert.equal(e.snapshot().privateNetwork.polls.length, 50, 'the poll log keeps the newest 50');
  assert.equal(guard.attempts.length, before, 'no outbound attempt was made');
});
