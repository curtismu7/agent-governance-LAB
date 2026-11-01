// The policy numbers, asserted as LITERALS (never derived from the constant, so changing the constant breaks a test), each through its behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIT_MARGIN, LIMITS } from '../src/engine.js';
import { perform } from '../src/actions.js';
import { A, K, K2, codeOf, discoverAll, newEngine, prop } from './helpers.js';

test('every limit is the number the README and the Learning Hub text state', () => {
  assert.deepEqual(LIMITS, { proposals: 200, openPerAgent: 5, audit: 500, refusals: 200, runs: 30, connections: 10, polls: 50, failures: 20, reason: 300, comment: 200, tags: 6, hops: 40, campaigns: 5, name: 60, sources: 3, scopeIds: 5 });
  assert.equal(AUDIT_MARGIN, 40);
});

test('AUDIT 500: new work is refused with 409 once 461 entries are used (fewer than 40 of the 500 are free), and not before', () => {
  const e = newEngine(); let refused = null;
  for (let i = 0; i < 600 && !refused; i++) { const r = perform(e, 'sync', {}); if (!r.ok) refused = r; }
  assert.ok(refused); assert.equal(refused.code, 'workspace_full');
  const s = e.snapshot();
  assert.equal(s.auditInfo.cap, 500); assert.equal(s.auditInfo.used, 461); assert.equal(s.auditInfo.room, 39);
  assert.match(refused.detail, /\(461 of 500 entries\)/);
});

test('TAGS 6: an agent that already carries six tags refuses a seventh key (tag_limit); five is fine', () => {
  // The three tag keys the lab offers can never fill six slots, so the guard is exercised on a state with planted tags.
  for (const [planted, expected] of [[5, null], [6, 'tag_limit']]) {
    const e = newEngine(); e.sync({}); const a = e.s.agents.get('ag-bedrock-01');
    a.tags = Object.fromEntries(Array.from({ length: planted }, (_, i) => [`planted-${i}`, 'x']));
    assert.equal(codeOf(() => prop(e, A, 'ag-bedrock-01', 'retag', { key: 'environment', value: 'qa' })), expected, `${planted} tags planted`);
  }
});

test('HOPS 40: a trace keeps the first 40 hops and flags the rest as truncated', () => {
  const e = newEngine(); e.trace = { traceId: 'a'.repeat(32), span: () => 'b'.repeat(16) };
  discoverAll(e);
  assert.equal(e.hops.length, 40); assert.equal(e.hopsTruncated, true);
  assert.deepEqual(e.hops.map((h) => h.n), Array.from({ length: 40 }, (_, i) => i + 1));
});

test('REASON 300: a proposal reason is cut to exactly 300 characters, and a comment to exactly 200', () => {
  const e = newEngine();
  const p = prop(e, K, 'ag-bedrock-02', 'quarantine', {}, { reason: 'plain words '.repeat(60) });
  assert.equal(e.snapshot().proposals.find((x) => x.id === p.proposalId).reason.length, 300);
  e.decide({ actor: A, proposalId: p.proposalId, decision: 'approve', comment: 'plain words '.repeat(60) });
  assert.equal(e.snapshot().proposals.find((x) => x.id === p.proposalId).comment.length, 200);
});

test('NAME 60: a connection name is cut to exactly 60 characters', () => {
  const e = newEngine(); e.setPrivateTenant({ actor: A, enabled: true });
  e.addConnection({ actor: A, connection: { name: 'plain words '.repeat(20), sources: ['lex'], scopeIds: ['000000000002'], enabled: true, scannerId: 's1', scannerRunsIn: { kind: 'aws-account', id: '000000000009' } } });
  assert.equal(e.snapshot().privateNetwork.connections[0].name.length, 60);
});

test('CONNECTIONS 10 / SOURCES 3 / SCOPES 5 / POLLS 50 / FAILURES 20 / RUNS 30 / CAMPAIGNS 5 / OPEN 5: the boundary is the stated number', () => {
  const conn = (n, extra = {}) => ({ actor: A, connection: { name: `c${n}`, sources: ['lex'], scopeIds: ['000000000002'], enabled: true, scannerId: 's1', scannerRunsIn: { kind: 'aws-account', id: '000000000009' }, ...extra } });
  const e = newEngine(); e.setPrivateTenant({ actor: A, enabled: true });
  for (let i = 0; i < 10; i++) e.addConnection(conn(i));
  assert.equal(codeOf(() => e.addConnection(conn(10))), 'workspace_full');
  assert.equal(codeOf(() => newEngine().addConnection(conn(0))), 'private_network_disabled');
  const e2 = newEngine(); e2.setPrivateTenant({ actor: A, enabled: true });
  assert.equal(codeOf(() => e2.addConnection(conn(0, { sources: ['bedrock', 'agentcore', 'lex', 'lex'] }))), 'bad_sources');
  assert.equal(codeOf(() => e2.addConnection(conn(0, { scopeIds: ['000000000001', '000000000002', '000000000003', '000000000004', '000000000002', '000000000001'] }))), 'bad_scopes');
  assert.equal(codeOf(() => e2.addConnection(conn(0, { scopeIds: ['000000000001', '000000000002', '000000000003', '000000000004'] }))), null, 'four scopes are fine');
  const ee = newEngine(); ee.setPrivateTenant({ actor: A, enabled: true }); ee.addConnection(conn(0));
  for (let i = 0; i < 55; i++) ee.connectorPoll({ actor: A });
  assert.equal(ee.snapshot().privateNetwork.polls.length, 50); assert.equal(ee.snapshot().auditInfo.pollsDropped, 5);
  const e4 = newEngine();
  assert.equal(codeOf(() => e4.sync({ failures: Array.from({ length: 21 }, () => ({ source: 'lex', kind: 'timeout' })) })), 'too_many_failures');
  assert.equal(codeOf(() => e4.sync({ failures: Array.from({ length: 20 }, () => ({ source: 'lex', kind: 'timeout' })) })), null);
  const e5 = newEngine(); for (let i = 0; i < 35; i++) e5.sync({});
  assert.equal(e5.snapshot().sync.runs.length, 30); assert.equal(e5.snapshot().auditInfo.runsDropped, 6);
  const e6 = newEngine();
  for (let i = 0; i < 5; i++) { e6.startCampaign({ actor: A, action: 'start' }); e6.startCampaign({ actor: A, action: 'close' }); }
  assert.equal(codeOf(() => e6.startCampaign({ actor: A, action: 'start' })), 'workspace_full');
});

test('OPEN PER AGENT 5 and PROPOSALS 200', () => {
  const e = newEngine();
  // five different open retags on one agent, the sixth is refused
  const values = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'];
  const r = values.map((v) => codeOf(() => prop(e, K, 'ag-bedrock-02', 'retag', { key: 'environment', value: v })));
  assert.deepEqual(r, [null, null, null, null, null, 'too_many_open']);
  const f = newEngine(); f.s.proposals = Array.from({ length: 200 }, (_, i) => ({ id: `x${i}`, status: 'executed', agentId: 'none', kind: 'k', params: {} }));
  assert.equal(codeOf(() => prop(f, K, 'ag-bedrock-02', 'quarantine')), 'workspace_full');
  f.s.proposals.pop();
  assert.equal(codeOf(() => prop(f, K, 'ag-bedrock-02', 'quarantine')), null, '199 plus one is the 200th');
});

test('REFUSALS 200: the refusal ring keeps the newest 200 and counts what it dropped', () => {
  const e = newEngine();
  for (let i = 0; i < 230; i++) codeOf(() => prop(e, K2, 'ag-bedrock-01', 'quarantine')); // a custodian of another agent: not_allowed
  const s = e.snapshot();
  assert.equal(s.auditInfo.refusalsKept, 200); assert.equal(s.auditInfo.refusalsDropped, 30);
});
