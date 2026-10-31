import test from 'node:test';
import assert from 'node:assert/strict';
import { A, A2, K, agentOf, codeOf, discoverAll, newEngine } from './helpers.js';
import { SOURCES, SCOPES } from '../src/catalog.js';

const statusOf = (e, id) => agentOf(e, id).status;
const last = (e) => e.snapshot().sync.last;

test('the first scan discovers 23 agents across all thirteen sources; private-network and sandbox agents are not seen yet', () => {
  const e = newEngine(); const s = e.snapshot();
  assert.equal(s.agents.length, 23);
  assert.equal(new Set(s.agents.map((a) => a.source)).size, 13);
  assert.equal(s.summary.bySource.length, 13);
  for (const id of ['ag-agentcore-02', 'ag-lex-02', 'ag-bedrockflow-02']) assert.equal(agentOf(e, id), undefined, id);
  assert.equal(s.sync.runs.length, 1); assert.equal(s.sync.last.outcome, 'complete');
});

test('the second scan finds three new agents and enumerates the new AWS account in an onboarded OU', () => {
  const e = newEngine();
  assert.ok(!e.snapshot().org.accounts.some((a) => a.id === '000000000004'), 'the account does not exist yet');
  const r = e.sync({});
  assert.deepEqual([...r.discovered].sort(), ['ag-bedrock-03', 'ag-copilot-03', 'ag-vertexai-03']);
  assert.deepEqual(r.enumerated, ['000000000004']);
  assert.equal(e.snapshot().org.accounts.find((a) => a.id === '000000000004').status, 'onboarded');
  const r2 = e.sync({}); assert.deepEqual([r2.discovered, r2.enumerated, r2.gone, r2.unknown], [[], [], [], []], 'a third scan finds nothing new');
});

test('discovery assigns a custodian from the owner hint, and flags an agent with no hint as orphaned', () => {
  const e = newEngine(); e.sync({});
  assert.equal(agentOf(e, 'ag-vertexai-03').custodian, K === e.cast.castCustodian ? e.cast.castCustodian2 : null);
  assert.equal(agentOf(e, 'ag-vertexai-03').classification.result, 'assigned');
  const o = agentOf(e, 'ag-bedrock-03');
  assert.deepEqual([o.custodian, o.classification.result, o.actionRequired.includes('orphaned')], [null, 'orphan', true]);
});

test('onboarding is scoped by organizational unit: the sandbox account is enumerated only when its OU is onboarded', () => {
  const e = newEngine(); e.sync({});
  assert.equal(agentOf(e, 'ag-bedrockflow-02'), undefined);
  e.setOnboarding({ actor: A, ous: ['ou-lab-prod', 'ou-lab-sandbox'] });
  const r = e.sync({});
  assert.deepEqual(r.discovered, ['ag-bedrockflow-02']); assert.deepEqual(r.enumerated, ['000000000003']);
  // taking the OU away again: its agents are not scanned, so they are unknown, never gone
  e.setOnboarding({ actor: A, ous: ['ou-lab-prod'] });
  const r2 = e.sync({});
  assert.deepEqual(r2.unknown, ['ag-bedrockflow-02']); assert.deepEqual(r2.gone, []);
});

test('onboarding validates its list, needs an administrator, and is audited with the acting user', () => {
  const e = newEngine();
  for (const bad of [undefined, 'ou-lab-prod', ['nope'], ['ou-lab-prod', 'ou-lab-prod'], [1], [{}], ['__proto__']]) assert.equal(codeOf(() => e.setOnboarding({ actor: A, ous: bad })), 'bad_ous');
  assert.equal(codeOf(() => e.setOnboarding({ actor: K, ous: [] })), 'admin_only');
  assert.equal(codeOf(() => e.setOnboarding({ actor: A, ous: [], extra: 1 })), 'unknown_field');
  e.setOnboarding({ actor: A2, ous: [] });
  assert.deepEqual(e.snapshot().org.onboardedOus, []);
  assert.equal(e.snapshot().audit.at(-1).actor, A2);
});

test('PARTIAL FAILURE: nothing is deleted, and every agent not seen is unknown, never gone', () => {
  const e = newEngine(); e.sync({});
  e.providerChange({ agentId: 'ag-lex-01', present: false }); // really gone, in a part that answers
  const before = e.snapshot().agents.length; const presentBefore = e.snapshot().provider.present.length;
  const r = e.sync({ failures: [{ source: 'vertexai', kind: 'timeout' }] });
  assert.equal(r.outcome, 'partial');
  assert.deepEqual(r.gone, [], 'no agent is marked gone in a partial run');
  assert.deepEqual([...r.unknown].sort(), ['ag-lex-01', 'ag-vertexai-01', 'ag-vertexai-02', 'ag-vertexai-03']);
  assert.equal(r.removedFromProvider, 0); assert.equal(r.inventoryRecordsRemoved, 0);
  assert.equal(e.snapshot().agents.length, before); assert.equal(e.snapshot().provider.present.length, presentBefore);
  for (const id of r.unknown) assert.equal(statusOf(e, id), 'unknown', id);
  assert.equal(statusOf(e, 'ag-bedrock-01'), 'active');
  assert.ok(r.parts.filter((p) => p.status === 'failed').every((p) => p.source === 'vertexai'));
});

test('COMPLETE run after a partial one: the really removed agent is gone, the silent ones are recovered', () => {
  const e = newEngine(); e.sync({});
  e.providerChange({ agentId: 'ag-lex-01', present: false });
  e.sync({ failures: [{ source: 'vertexai', kind: 'error' }] });
  const r = e.sync({});
  assert.equal(r.outcome, 'complete');
  assert.deepEqual(r.gone, ['ag-lex-01']);
  assert.deepEqual([...r.recovered].sort(), ['ag-vertexai-01', 'ag-vertexai-02', 'ag-vertexai-03']);
  assert.equal(statusOf(e, 'ag-lex-01'), 'gone');
  assert.equal(e.snapshot().agents.length, 26, 'the record of a gone agent is kept');
  // an agent that comes back is active again
  e.providerChange({ agentId: 'ag-lex-01', present: true });
  const r2 = e.sync({}); assert.deepEqual(r2.recovered, ['ag-lex-01']); assert.equal(statusOf(e, 'ag-lex-01'), 'active');
});

test('a failure scoped to one account marks only that part failed, and the whole run partial', () => {
  const e = newEngine(); e.sync({});
  e.providerChange({ agentId: 'ag-bedrock-01', present: false });
  const r = e.sync({ failures: [{ scope: 'proj-lab-002', kind: 'throttled' }] });
  assert.equal(r.outcome, 'partial');
  assert.deepEqual(r.gone, [], 'an agent removed in a part that DID answer is still not gone while another part failed');
  assert.ok(r.unknown.includes('ag-bedrock-01'));
  assert.ok(r.parts.filter((p) => p.status === 'failed').every((p) => p.scope === 'proj-lab-002'));
  assert.ok(r.parts.filter((p) => p.status === 'failed').length >= 2);
});

test('sync failures are validated as a whole: any bad entry refuses the whole sync and changes nothing', () => {
  const e = newEngine(); const runs = () => e.snapshot().sync.runs.length;
  const bad = [
    'x', {}, [null], [{}], [{ source: 'nope', kind: 'timeout' }], [{ scope: 'nope', kind: 'timeout' }], [{ source: 'lex', scope: '000000000001', kind: 'timeout' }], [{ source: 'lex', kind: 'meltdown' }], [{ source: 'lex' }],
    [{ source: 'lex', kind: 'timeout', extra: 1 }], [{ source: '__proto__', kind: 'timeout' }], [{ source: 5, kind: 'timeout' }], [{ source: 'lex', kind: 'timeout' }, { source: 'nope', kind: 'timeout' }],
  ];
  for (const failures of bad) { assert.ok(['bad_failures', 'bad_failure'].includes(codeOf(() => e.sync({ failures }))), JSON.stringify(failures)); assert.equal(runs(), 1); }
  assert.equal(codeOf(() => e.sync({ failures: Array.from({ length: 21 }, () => ({ source: 'lex', kind: 'timeout' })) })), 'too_many_failures');
  e.sync({ failures: Array.from({ length: 20 }, () => ({ source: 'lex', kind: 'timeout' })) });
  assert.equal(codeOf(() => e.sync({ nope: 1 })), 'unknown_field');
  assert.equal(codeOf(() => e.sync({ actor: 'nobody' })), 'bad_actor');
});

test('a sync records its acting user and the audit log says whether it was partial', () => {
  const e = newEngine(); e.sync({ actor: K, failures: [{ source: 'lex', kind: 'timeout' }] });
  const a = e.snapshot().audit.filter((x) => x.kind === 'sync').at(-1);
  assert.deepEqual([a.actor, a.outcome, a.failedParts], [K, 'partial', 2]);
  assert.equal(e.snapshot().sync.last.by, K);
});

test('the provider change is validated, and a repeat is refused', () => {
  const e = newEngine();
  for (const bad of [{ agentId: 'nope', present: false }, { agentId: 5, present: false }, { agentId: '__proto__', present: false }, { agentId: 'ag-lex-01', present: 'no' }]) assert.ok(codeOf(() => e.providerChange(bad)), JSON.stringify(bad));
  assert.equal(codeOf(() => e.providerChange({ agentId: 'ag-lex-01', present: true })), 'already_in_state');
  e.providerChange({ agentId: 'ag-lex-01', present: false });
  assert.equal(codeOf(() => e.providerChange({ agentId: 'ag-lex-01', present: false })), 'already_in_state');
  assert.equal(codeOf(() => e.providerChange({ agentId: 'ag-lex-01', present: false, extra: 1 })), 'unknown_field');
});

test('runs are kept to 30; each run has one part per source and scope it answers for', () => {
  const e = newEngine();
  for (let i = 0; i < 35; i++) e.sync({});
  const s = e.snapshot(); assert.equal(s.sync.runs.length, 30); assert.equal(s.sync.last.id, 'run-0036');
  const pairs = new Set(s.sync.last.parts.map((p) => `${p.source}|${p.scope}`));
  assert.equal(pairs.size, s.sync.last.parts.length);
});

test('deleted agents are not counted as gone or unknown by later syncs', () => {
  const e = newEngine(); e.sync({});
  const p = e.propose({ actor: A, agentId: 'ag-snowflake-01', kind: 'delete' });
  e.decide({ actor: A2, proposalId: p.proposalId, decision: 'approve' }); e.execute({ actor: A, proposalId: p.proposalId });
  assert.equal(statusOf(e, 'ag-snowflake-01'), 'deleted');
  const r = e.sync({}); assert.deepEqual([r.gone, r.unknown], [[], []]);
  assert.equal(statusOf(e, 'ag-snowflake-01'), 'deleted');
  assert.ok(!e.snapshot().provider.present.includes('ag-snowflake-01'));
});

test('discoverAll finds all 29 agents; the catalog has 13 sources and every scope has a unique id', () => {
  const e = newEngine(); discoverAll(e);
  assert.equal(e.snapshot().agents.length, 29);
  assert.equal(SOURCES.length, 13); assert.equal(new Set(SCOPES.map((s) => s.id)).size, SCOPES.length);
});
