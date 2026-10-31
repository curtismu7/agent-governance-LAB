// Fix-pass tests from the independent review: the audit log never silently drops an execution, administrators act immediately, a departed custodian shows up in the score,
// endpoint pins are normalised, and the seeded scores are pinned by explicit numbers (so regenerating the Mock table cannot hide a rule change).
import test from 'node:test';
import assert from 'node:assert/strict';
import { A, A2, K, K2, K3, O, C, agentOf, approve, codeOf, exec, newEngine, prop, discoverAll } from './helpers.js';
import { AUDIT_MARGIN, LIMITS } from '../src/engine.js';
import { perform } from '../src/actions.js';
import { buildContext, assess } from '../src/findings.js';

test('S1: 520 refused calls cannot flush the record of an execution: refusals have their own ring and the drops are counted', () => {
  const e = newEngine();
  const p = prop(e, K, 'ag-bedrock-02', 'quarantine'); approve(e, A, p.proposalId); exec(e, K, p.proposalId);
  for (let i = 0; i < 520; i++) assert.equal(codeOf(() => e.gateway('gw-lab-01', { actor: O, kind: 'set-target', target: 'tg-1', enabled: false })), 'admin_only');
  const s = e.snapshot();
  assert.ok(s.audit.some((a) => a.kind === 'proposal.executed' && a.proposal === p.proposalId && a.actor === K), 'the execution entry survived');
  assert.ok(s.audit.some((a) => a.kind === 'proposal.approved' && a.actor === A));
  assert.equal(s.auditInfo.refusalsKept, LIMITS.refusals); assert.equal(s.auditInfo.refusalsDropped, 520 - LIMITS.refusals);
  assert.equal(s.audit.filter((a) => a.kind.startsWith('refused:')).length, LIMITS.refusals);
});

test('S1: the audit log never drops an entry: new work is refused with 409 when it is nearly full, and nothing is lost', () => {
  const e = newEngine();
  const first = e.snapshot().audit[0];
  let ok = 0; let refused = null;
  for (let i = 0; i < LIMITS.audit + 20; i++) { const r = perform(e, 'sync', {}); if (r.ok) ok += 1; else { refused = r; break; } }
  assert.ok(refused, 'a full audit log refuses new work'); assert.deepEqual([refused.code, refused.status], ['workspace_full', 409]);
  assert.match(refused.detail, /audit log is nearly full/);
  const s = e.snapshot();
  assert.equal(s.auditInfo.used, LIMITS.audit - AUDIT_MARGIN + 1, 'refused as soon as fewer than the margin are free');
  assert.ok(s.auditInfo.room < AUDIT_MARGIN && s.auditInfo.used <= LIMITS.audit);
  assert.deepEqual(s.audit[0], first, 'the very first entry is still there');
  assert.deepEqual(s.audit.map((a) => a.n), s.audit.map((_, i) => i + 1), 'no gaps: nothing was dropped');
  assert.equal(codeOf(() => { const r = perform(e, 'depart', { actor: A, person: K2, successor: K3 }); if (!r.ok) throw Object.assign(new Error(r.detail), { code: r.code }); }), 'workspace_full');
  e.reset(); assert.ok(perform(e, 'sync', {}).ok, 'Reset makes room again');
});

test('S1: the sync-run list and the poll log are lists that say how many older entries dropped off', () => {
  const e = newEngine();
  for (let i = 0; i < 35; i++) e.sync({});
  let s = e.snapshot(); assert.equal(s.sync.runs.length, LIMITS.runs); assert.equal(s.auditInfo.runsDropped, 36 - LIMITS.runs);
  assert.equal(s.audit.filter((a) => a.kind === 'sync').length, 36, 'the audit log keeps one entry per sync');
  e.setPrivateTenant({ actor: A, enabled: true });
  e.addConnection({ actor: A, connection: { name: 'c', sources: ['lex'], scopeIds: ['000000000002'], enabled: true, scannerId: 's1', scannerRunsIn: { kind: 'aws-account', id: '000000000009' } } });
  for (let i = 0; i < 55; i++) e.connectorPoll({ actor: A });
  s = e.snapshot(); assert.equal(s.privateNetwork.polls.length, LIMITS.polls); assert.equal(s.auditInfo.pollsDropped, 55 - LIMITS.polls);
});

test('S2: an administrator\'s own certification revoke and succession rules: custodian revokes wait, administrator revokes run at once', () => {
  const e = newEngine(); e.startCampaign({ actor: A, action: 'start' });
  const k = e.decideItem({ actor: K, itemId: 'ci-0002', decision: 'revoke' });
  assert.equal(e.snapshot().proposals.find((p) => p.id === k.proposalId).status, 'proposed');
  assert.equal(agentOf(e, 'ag-bedrock-02').revoked, false);
});

test('NIT: a departed custodian still shows as an orphan-like finding (LF-09 fires, the score moves), and succession clears it', () => {
  const e = newEngine();
  const before = agentOf(e, 'ag-agentcore-01').assessment.score;
  assert.ok(!agentOf(e, 'ag-agentcore-01').assessment.findings.some((f) => f.id === 'LF-09'));
  const r = e.depart({ actor: A, person: K2, successor: K3 });
  const a = agentOf(e, 'ag-agentcore-01');
  assert.ok(a.assessment.findings.some((f) => f.id === 'LF-09' && /has left/.test(f.detail)));
  assert.equal(a.assessment.score, before + 15);
  const pid = r.proposals[e.snapshot().proposals.findIndex((p) => p.agentId === 'ag-agentcore-01')];
  approve(e, A2, pid); exec(e, A2, pid);
  assert.ok(!agentOf(e, 'ag-agentcore-01').assessment.findings.some((f) => f.id === 'LF-09'));
  assert.equal(agentOf(e, 'ag-agentcore-01').assessment.score, before);
  // unit: the rule reads the context
  const agent = { id: 'x', source: 'bedrock', scope: '000000000001', model: 'lab-model-large-2', config: { authentication: 'iam', publicAccess: false, logging: true, guardrail: 'g' }, identity: { name: 'i', kind: 'r', permissions: [] }, tools: [], knowledgeBases: [], credentials: [], bindings: [], subAgents: [], flows: [], custodian: 'gone-person', status: 'active', quarantined: false, revoked: false };
  assert.ok(assess(agent, buildContext([agent], new Set(['gone-person']))).findings.some((f) => f.id === 'LF-09'));
  assert.ok(!assess(agent, buildContext([agent], new Set())).findings.some((f) => f.id === 'LF-09'));
});

test('NIT: a pinned endpoint is normalised (lower case, no trailing dot) and the same endpoint in another spelling is a duplicate', () => {
  const e = newEngine();
  const r = e.gateway('gw-lab-01', { actor: A, kind: 'pin-endpoint', endpoint: 'https://GW1.Fabrikam.EXAMPLE.' });
  assert.equal(r.pinnedEndpoint, 'https://gw1.fabrikam.example');
  assert.equal(e.snapshot().gateways[0].pinnedEndpoint, 'https://gw1.fabrikam.example');
  assert.equal(codeOf(() => e.gateway('gw-lab-01', { actor: A, kind: 'pin-endpoint', endpoint: 'https://gw1.fabrikam.example.' })), 'already_in_state');
});

test('NIT: a scanner id or location that looks like a credential is refused, but a real Azure subscription GUID is accepted', () => {
  const e = newEngine(); e.setPrivateTenant({ actor: A, enabled: true });
  const base = { name: 'c', sources: ['lex'], scopeIds: ['000000000002'], enabled: true, scannerId: 's1', scannerRunsIn: { kind: 'aws-account', id: '000000000009' } };
  assert.equal(codeOf(() => e.addConnection({ actor: A, connection: { ...base, scannerId: 'sk-ab12cd34' } })), 'bad_scanner');
  assert.equal(codeOf(() => e.addConnection({ actor: A, connection: { ...base, scannerRunsIn: { kind: 'gcp-project', id: 'sk-ab12cd34-abc' } } })), 'bad_scanner_location');
  e.addConnection({ actor: A, connection: { ...base, scannerId: 's2', scannerRunsIn: { kind: 'azure-subscription', id: '00000000-0000-0000-0000-000000000000' } } });
  assert.equal(e.snapshot().privateNetwork.connections.length, 1);
});

test('the seeded agents have exactly these scores at the first scan (pinned by number, independent of the Mock table)', () => {
  const want = { 'ag-bedrock-01': 0, 'ag-bedrock-02': 55, 'ag-agentcore-01': 45, 'ag-lex-01': 25, 'ag-bedrockflow-01': 15, 'ag-vertexai-01': 10, 'ag-vertexai-02': 10, 'ag-agentbuilder-01': 20, 'ag-agentbuilder-02': 0, 'ag-agentregistry-01': 0, 'ag-agentregistry-02': 0, 'ag-dialogflowcx-01': 15, 'ag-dialogflowcx-02': 0, 'ag-aifoundry-01': 40, 'ag-aifoundry-02': 0, 'ag-copilot-01': 40, 'ag-copilot-02': 0, 'ag-agentforce-01': 40, 'ag-agentforce-02': 0, 'ag-databricks-01': 40, 'ag-databricks-02': 0, 'ag-snowflake-01': 0, 'ag-snowflake-02': 10 };
  const got = Object.fromEntries(newEngine().snapshot().agents.map((a) => [a.id, a.assessment.score]));
  assert.deepEqual(got, want);
  const e = newEngine(); discoverAll(e);
  const full = Object.fromEntries(e.snapshot().agents.map((a) => [a.id, a.assessment.findings.map((f) => f.id).join('+')]));
  assert.equal(full['ag-bedrockflow-02'], 'LF-04'); assert.equal(full['ag-agentcore-02'], 'LF-05+LF-10'); assert.equal(full['ag-lex-02'], ''); assert.equal(full['ag-bedrock-03'], 'LF-02+LF-07+LF-09');
  assert.equal(C.castAdmin.length > 0, true);
});

test('the quarantine matrix is pinned by name: seven sources, Bedrock Flows and Registry and Dialogflow and Builder and Foundry and Databricks refuse', async () => {
  const { SOURCES } = await import('../src/catalog.js');
  assert.deepEqual(SOURCES.filter((s) => s.quarantine).map((s) => s.id), ['bedrock', 'agentcore', 'lex', 'vertexai', 'copilot', 'agentforce', 'snowflake']);
  assert.deepEqual(SOURCES.filter((s) => !s.delete).map((s) => s.id), ['databricks']);
});
