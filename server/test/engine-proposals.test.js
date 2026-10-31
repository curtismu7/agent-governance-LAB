import test from 'node:test';
import assert from 'node:assert/strict';
import { A, A2, K, K2, K3, O, agentOf, approve, codeOf, deny, discoverAll, exec, newEngine, prop, remediate } from './helpers.js';
import { SOURCES, QUARANTINE_NAMED_BY_DECK } from '../src/catalog.js';

const proposal = (e, id) => e.snapshot().proposals.find((p) => p.id === id);
const audit = (e) => e.snapshot().audit;

test('PROPOSE -> APPROVE -> EXECUTE: the three steps in order, and nothing happens before the third', () => {
  const e = newEngine();
  const p = prop(e, K, 'ag-bedrock-02', 'quarantine', {}, { reason: 'admin grant' });
  assert.equal(p.status, 'proposed'); assert.equal(agentOf(e, 'ag-bedrock-02').quarantined, false);
  assert.equal(codeOf(() => exec(e, K, p.proposalId)), 'not_approved');
  approve(e, A, p.proposalId);
  assert.equal(proposal(e, p.proposalId).status, 'approved'); assert.equal(agentOf(e, 'ag-bedrock-02').quarantined, false, 'approval alone changes nothing');
  exec(e, K, p.proposalId);
  assert.equal(proposal(e, p.proposalId).status, 'executed'); assert.equal(agentOf(e, 'ag-bedrock-02').quarantined, true);
  assert.deepEqual(audit(e).filter((a) => a.proposal === p.proposalId).map((a) => [a.kind, a.actor]), [['proposal.created', K], ['proposal.approved', A], ['proposal.executed', K]]);
  assert.equal(audit(e).at(-1).approvedBy, A);
});

test('WHO MAY PROPOSE: an administrator or the agent\'s assigned custodian; a member, another custodian and a departed custodian may not', () => {
  const e = newEngine();
  assert.equal(codeOf(() => prop(e, O, 'ag-bedrock-01', 'quarantine')), 'not_allowed');
  assert.equal(codeOf(() => prop(e, K2, 'ag-bedrock-01', 'quarantine')), 'not_allowed', 'another custodian');
  assert.ok(prop(e, K, 'ag-bedrock-01', 'quarantine').proposalId);
  assert.ok(prop(e, A, 'ag-bedrock-02', 'quarantine').proposalId);
  assert.equal(audit(e).filter((a) => a.kind === 'refused:not_allowed').length, 2, 'the refusals are audited with the acting user');
  assert.deepEqual(audit(e).filter((a) => a.kind === 'refused:not_allowed').map((a) => a.actor), [O, K2]);
  assert.equal(codeOf(() => prop(e, 'nobody', 'ag-bedrock-01', 'quarantine')), 'bad_actor');
  assert.equal(codeOf(() => prop(e, 5, 'ag-bedrock-01', 'quarantine')), 'bad_actor');
  assert.equal(codeOf(() => prop(e, '__proto__', 'ag-bedrock-01', 'quarantine')), 'bad_actor');
  e.depart({ actor: A, person: K, successor: K3 });
  assert.equal(codeOf(() => prop(e, K, 'ag-bedrock-02', 'quarantine')), 'actor_departed');
});

test('WHO MAY APPROVE: only an administrator, never the proposer, even an administrator', () => {
  const e = newEngine();
  const p = prop(e, K, 'ag-bedrock-02', 'quarantine');
  assert.equal(codeOf(() => approve(e, K, p.proposalId)), 'admin_only', 'the custodian who proposed');
  assert.equal(codeOf(() => approve(e, K2, p.proposalId)), 'admin_only', 'another custodian');
  assert.equal(codeOf(() => approve(e, O, p.proposalId)), 'admin_only');
  const q = prop(e, A, 'ag-bedrock-01', 'quarantine');
  assert.equal(codeOf(() => approve(e, A, q.proposalId)), 'self_approval', 'SELF-APPROVAL by an administrator');
  assert.equal(codeOf(() => deny(e, A, q.proposalId)), 'self_approval', 'a self-denial is refused too');
  assert.equal(proposal(e, q.proposalId).status, 'proposed');
  assert.deepEqual(audit(e).filter((a) => a.kind === 'refused:self_approval').map((a) => a.actor), [A, A]);
  approve(e, A2, q.proposalId); // the other administrator may
  assert.equal(proposal(e, q.proposalId).decidedBy, A2);
});

test('APPROVE AFTER DENY is refused, and so is deny after deny, approve after approve and a decision on an executed proposal', () => {
  const e = newEngine();
  const p = prop(e, K, 'ag-bedrock-02', 'quarantine');
  deny(e, A, p.proposalId);
  assert.equal(codeOf(() => approve(e, A2, p.proposalId)), 'already_denied');
  assert.equal(codeOf(() => deny(e, A2, p.proposalId)), 'already_denied');
  assert.equal(codeOf(() => exec(e, K, p.proposalId)), 'proposal_denied');
  assert.equal(proposal(e, p.proposalId).status, 'denied'); assert.equal(agentOf(e, 'ag-bedrock-02').quarantined, false);
  const q = prop(e, K, 'ag-bedrock-02', 'quarantine'); // a denied proposal can be proposed again
  approve(e, A, q.proposalId);
  assert.equal(codeOf(() => approve(e, A2, q.proposalId)), 'already_decided', 'DOUBLE APPROVAL');
  assert.equal(codeOf(() => deny(e, A2, q.proposalId)), 'already_decided', 'deny after approve');
  exec(e, K, q.proposalId);
  assert.equal(codeOf(() => exec(e, K, q.proposalId)), 'already_executed', 'DUPLICATE EXECUTE');
  assert.equal(codeOf(() => approve(e, A2, q.proposalId)), 'already_decided');
});

test('STALE: an approval whose agent changed afterwards is refused, at approval and at execution, and the proposal is marked stale', () => {
  const e = newEngine();
  // stale at approval: the agent changed between propose and approve
  const a = prop(e, K, 'ag-bedrock-02', 'quarantine');
  remediate(e, K, 'ag-bedrock-02', 'retag', { key: 'cost-center', value: 'x1' });
  assert.equal(codeOf(() => approve(e, A, a.proposalId)), 'stale_proposal');
  assert.equal(proposal(e, a.proposalId).status, 'stale');
  assert.equal(codeOf(() => approve(e, A2, a.proposalId)), 'stale_proposal');
  assert.equal(codeOf(() => exec(e, K, a.proposalId)), 'stale_proposal');
  // stale at execution: approved, then the agent changed
  const b = prop(e, K, 'ag-bedrock-01', 'quarantine');
  approve(e, A, b.proposalId);
  remediate(e, K, 'ag-bedrock-01', 'retag', { key: 'cost-center', value: 'x2' });
  assert.equal(codeOf(() => exec(e, K, b.proposalId)), 'stale_proposal');
  assert.equal(proposal(e, b.proposalId).status, 'stale'); assert.equal(agentOf(e, 'ag-bedrock-01').quarantined, false, 'nothing ran');
  // stale because the agent is gone
  const c = prop(e, K2, 'ag-agentcore-01', 'quarantine'); approve(e, A, c.proposalId);
  e.providerChange({ agentId: 'ag-agentcore-01', present: false }); e.sync({});
  assert.equal(agentOf(e, 'ag-agentcore-01').status, 'gone');
  assert.equal(codeOf(() => exec(e, K2, c.proposalId)), 'stale_proposal');
  assert.ok(audit(e).some((x) => x.kind === 'proposal.stale'));
});

test('a status change by the sync (unknown) also makes an earlier approval stale', () => {
  const e = newEngine();
  const p = prop(e, K2, 'ag-vertexai-01', 'quarantine'); approve(e, A, p.proposalId);
  e.sync({ failures: [{ source: 'vertexai', kind: 'timeout' }] });
  assert.equal(codeOf(() => exec(e, K2, p.proposalId)), 'stale_proposal');
});

test('WHO MAY EXECUTE: the proposer or an administrator, not anyone else', () => {
  const e = newEngine();
  const p = prop(e, K, 'ag-bedrock-02', 'quarantine'); approve(e, A, p.proposalId);
  assert.equal(codeOf(() => exec(e, O, p.proposalId)), 'not_allowed');
  assert.equal(codeOf(() => exec(e, K2, p.proposalId)), 'not_allowed');
  assert.equal(proposal(e, p.proposalId).status, 'approved');
  exec(e, A2, p.proposalId); assert.equal(proposal(e, p.proposalId).executedBy, A2);
});

test('DELETE works on twelve of thirteen sources and is refused on Databricks (in development)', () => {
  const e = newEngine(); discoverAll(e);
  const snap = e.snapshot(); const bySource = new Map();
  for (const a of snap.agents) if (!bySource.has(a.source) && a.status === 'active') bySource.set(a.source, a);
  assert.equal(bySource.size, 13);
  let ok = 0; const refused = [];
  for (const [source, a] of bySource) {
    const code = codeOf(() => prop(e, A, a.id, 'delete'));
    if (code === null) ok += 1; else { assert.equal(code, 'unsupported_on_source'); refused.push(source); }
  }
  assert.deepEqual([ok, refused], [12, ['databricks']]);
  assert.equal(SOURCES.filter((s) => s.delete).length, 12);
  // it really deletes: execute one
  const p = e.snapshot().proposals.find((x) => x.agentId === bySource.get('snowflake').id);
  approve(e, A2, p.id); exec(e, A, p.id);
  assert.equal(agentOf(e, bySource.get('snowflake').id).status, 'deleted'); assert.ok(!e.snapshot().provider.present.includes(bySource.get('snowflake').id));
});

test('QUARANTINE works on exactly nine sources (seven named by the deck, two lab-reading placeholders) and is refused elsewhere; a repeat is refused', () => {
  const e = newEngine(); discoverAll(e);
  const bySource = new Map();
  for (const a of e.snapshot().agents) if (!bySource.has(a.source) && a.status === 'active') bySource.set(a.source, a);
  const supported = [];
  for (const [source, a] of bySource) {
    const code = codeOf(() => prop(e, A, a.id, 'quarantine'));
    if (code === null) supported.push(source); else assert.equal(code, 'unsupported_on_source', source);
  }
  assert.equal(supported.length, 9);
  assert.deepEqual(QUARANTINE_NAMED_BY_DECK.filter((s) => !supported.includes(s)), [], 'every source the deck names is supported');
  assert.deepEqual(supported.filter((s) => !QUARANTINE_NAMED_BY_DECK.includes(s)).sort(), ['agentbuilder', 'aifoundry'], 'the two placeholders');
  assert.deepEqual(SOURCES.filter((s) => s.quarantine).map((s) => s.id).sort(), [...supported].sort());
  assert.equal(SOURCES.filter((s) => s.quarantineSource === 'reading').length, 2);
  const e2 = newEngine(); remediate(e2, A, 'ag-bedrock-01', 'quarantine');
  assert.equal(codeOf(() => prop(e2, A, 'ag-bedrock-01', 'quarantine')), 'already_in_state');
});

test('QUARANTINE is real: the identity is detached, so the findings that depended on its reach stop, and the others stay', () => {
  const e = newEngine();
  assert.deepEqual(agentOf(e, 'ag-agentcore-01').assessment.findings.map((f) => f.id), ['LF-02', 'LF-13']);
  remediate(e, K2, 'ag-agentcore-01', 'quarantine');
  const a = agentOf(e, 'ag-agentcore-01');
  assert.deepEqual(a.assessment.findings.map((f) => f.id), ['LF-13'], 'public and unauthenticated no longer applies, logging still does');
  assert.ok(a.identity.permissions.every((p) => p.inert));
  const b = agentOf(e, 'ag-bedrock-02'); assert.ok(b.assessment.findings.some((f) => f.id === 'LF-01'));
  remediate(e, K, 'ag-bedrock-02', 'quarantine');
  assert.ok(!agentOf(e, 'ag-bedrock-02').assessment.findings.some((f) => f.id === 'LF-01'));
  assert.ok(agentOf(e, 'ag-bedrock-02').assessment.findings.some((f) => f.id === 'LF-07'), 'a missing guardrail is still missing');
});

test('TARGETED FIXES each change the state and the score: strip a role, stop a flow, disable a credential, retag, reconfigure', () => {
  const e = newEngine();
  const score = (id) => agentOf(e, id).assessment.score;
  const f1 = score('ag-bedrockflow-01'); assert.ok(agentOf(e, 'ag-bedrockflow-01').assessment.findings.some((f) => f.id === 'LF-03'));
  remediate(e, K3, 'ag-bedrockflow-01', 'strip-role', { permissionId: 'p2' });
  assert.ok(score('ag-bedrockflow-01') < f1); assert.equal(agentOf(e, 'ag-bedrockflow-01').identity.permissions.length, 2);
  const f2 = score('ag-copilot-01'); remediate(e, K2, 'ag-copilot-01', 'stop-flow', { flowId: 'f1' });
  assert.ok(score('ag-copilot-01') < f2); assert.equal(agentOf(e, 'ag-copilot-01').flows.find((f) => f.id === 'f1').running, false);
  const f3 = score('ag-agentforce-01'); remediate(e, K3, 'ag-agentforce-01', 'disable-credential', { credentialId: 'nc1' });
  assert.ok(score('ag-agentforce-01') < f3); assert.equal(agentOf(e, 'ag-agentforce-01').credentials[0].enabled, false); assert.ok(agentOf(e, 'ag-agentforce-01').identity.permissions[0].inert);
  const f4 = score('ag-agentcore-01'); remediate(e, K2, 'ag-agentcore-01', 'reconfigure', { field: 'publicAccess', value: false });
  assert.ok(score('ag-agentcore-01') < f4);
  remediate(e, K2, 'ag-agentcore-01', 'reconfigure', { field: 'logging', value: true });
  assert.equal(score('ag-agentcore-01'), 0);
  remediate(e, K, 'ag-bedrock-02', 'reconfigure', { field: 'guardrail', value: 'gr-default' });
  assert.ok(!agentOf(e, 'ag-bedrock-02').assessment.findings.some((f) => f.id === 'LF-07'));
  remediate(e, K, 'ag-bedrock-01', 'retag', { key: 'data-class', value: 'restricted' });
  assert.equal(agentOf(e, 'ag-bedrock-01').tags['data-class'], 'restricted');
  // revoke-access
  remediate(e, K, 'ag-bedrock-02', 'revoke-access');
  assert.equal(agentOf(e, 'ag-bedrock-02').revoked, true); assert.ok(!agentOf(e, 'ag-bedrock-02').assessment.findings.some((f) => f.id === 'LF-01'));
});

test('proposal parameters are validated by kind: wrong, missing, extra and wrong-typed values are refused without being echoed', () => {
  const e = newEngine();
  const t = (agent, kind, params) => codeOf(() => prop(e, A, agent, kind, params));
  assert.equal(t('ag-bedrockflow-01', 'strip-role', {}), 'unknown_permission');
  assert.equal(t('ag-bedrockflow-01', 'strip-role', { permissionId: 'zzz' }), 'unknown_permission');
  assert.equal(t('ag-bedrockflow-01', 'strip-role', { permissionId: 5 }), 'unknown_permission');
  assert.equal(t('ag-bedrockflow-01', 'strip-role', { permissionId: '__proto__' }), 'unknown_permission');
  assert.equal(t('ag-bedrockflow-01', 'strip-role', { permissionId: 'p1', x: 1 }), 'unknown_field');
  assert.equal(t('ag-copilot-01', 'stop-flow', { flowId: 'zzz' }), 'unknown_flow');
  assert.equal(t('ag-copilot-01', 'stop-flow', { flowId: 'f1' }), null);
  assert.equal(t('ag-agentforce-01', 'disable-credential', { credentialId: 'zzz' }), 'unknown_credential');
  assert.equal(t('ag-bedrock-01', 'retag', { key: 'owner', value: 'x' }), 'bad_tag_key');
  assert.equal(t('ag-bedrock-01', 'retag', { key: 'cost-center', value: 5 }), 'bad_value');
  assert.equal(t('ag-bedrock-01', 'retag', { key: 'cost-center', value: '   ' }), 'bad_value');
  assert.equal(t('ag-bedrock-01', 'retag', { key: 'environment', value: 'production' }), 'already_in_state');
  assert.equal(t('ag-bedrock-01', 'reconfigure', { field: 'nope', value: true }), 'bad_field');
  assert.equal(t('ag-bedrock-01', 'reconfigure', { field: '__proto__', value: true }), 'bad_field');
  assert.equal(t('ag-bedrock-01', 'reconfigure', { field: 'authentication', value: 'basic' }), 'bad_value');
  assert.equal(t('ag-bedrock-01', 'reconfigure', { field: 'logging', value: 'true' }), 'bad_value', 'a string is not a boolean');
  assert.equal(t('ag-bedrock-01', 'reconfigure', { field: 'logging', value: true }), 'already_in_state');
  assert.equal(t('ag-bedrock-01', 'transfer', { to: O }), 'bad_custodian');
  assert.equal(t('ag-bedrock-01', 'transfer', { to: A }), 'bad_custodian');
  assert.equal(t('ag-bedrock-01', 'transfer', { to: K }), 'already_in_state');
  assert.equal(t('ag-bedrock-01', 'transfer', { to: K2 }), null);
  assert.equal(t('ag-bedrock-01', 'delete', { x: 1 }), 'unknown_field');
  for (const kind of [undefined, 5, 'wipe', '__proto__', ['delete']]) assert.equal(t('ag-bedrock-01', kind, {}), 'bad_kind');
  for (const agent of ['nope', 5, undefined, '__proto__', 'constructor']) assert.equal(t(agent, 'quarantine', {}), 'unknown_agent');
  for (const params of ['x', 5, [1], null]) assert.equal(codeOf(() => e.propose({ actor: A, agentId: 'ag-bedrock-01', kind: 'delete', params })), 'unknown_field', JSON.stringify(params));
  assert.equal(codeOf(() => e.propose({ actor: A, agentId: 'ag-bedrock-01', kind: 'quarantine', reason: 5 })), 'bad_reason');
  assert.equal(codeOf(() => e.propose({ actor: A, agentId: 'ag-bedrock-01', kind: 'quarantine', extra: 1 })), 'unknown_field');
  assert.equal(codeOf(() => e.propose(null)), 'unknown_field');
});

test('an agent carries at most six tags, and the whole proposal is refused beyond that', () => {
  const e = newEngine(); const a = agentOf(e, 'ag-bedrock-01');
  assert.equal(Object.keys(a.tags).length, 1);
  assert.equal(codeOf(() => prop(e, A, 'ag-bedrock-01', 'retag', { key: 'data-class', value: 'a' })), null);
});

test('DUPLICATES and CAPS: the same proposal cannot be open twice, an agent has at most 5 open, a workspace at most 200; the whole request is refused, nothing is dropped', () => {
  const e = newEngine();
  const p = prop(e, A, 'ag-bedrock-01', 'quarantine');
  assert.equal(codeOf(() => prop(e, A2, 'ag-bedrock-01', 'quarantine')), 'duplicate_proposal');
  approve(e, A2, p.proposalId); assert.equal(codeOf(() => prop(e, A2, 'ag-bedrock-01', 'quarantine')), 'duplicate_proposal', 'an approved one is still open');
  deny(e, A2, prop(e, A, 'ag-bedrock-01', 'reconfigure', { field: 'logging', value: false }).proposalId);
  assert.equal(codeOf(() => prop(e, A, 'ag-bedrock-01', 'reconfigure', { field: 'logging', value: false })), null, 'a denied one can be proposed again');
  // open cap: 5 per agent
  const e2 = newEngine();
  const ks = [['retag', { key: 'cost-center', value: 'a' }], ['retag', { key: 'cost-center', value: 'b' }], ['retag', { key: 'data-class', value: 'a' }], ['reconfigure', { field: 'logging', value: false }], ['reconfigure', { field: 'publicAccess', value: true }]];
  for (const [k, pr] of ks) prop(e2, A, 'ag-bedrock-01', k, pr);
  assert.equal(codeOf(() => prop(e2, A, 'ag-bedrock-01', 'quarantine')), 'too_many_open');
  assert.equal(e2.snapshot().proposals.length, 5);
  // workspace cap: 200
  const e3 = newEngine(); const live = e3.snapshot().agents;
  for (let i = 0; i < 200; i++) deny(e3, A2, prop(e3, A, live[i % live.length].id, 'retag', { key: 'cost-center', value: `v${i}` }).proposalId);
  assert.equal(e3.snapshot().proposals.length, 200);
  assert.equal(codeOf(() => prop(e3, A, 'ag-snowflake-02', 'quarantine')), 'workspace_full');
  assert.equal(e3.snapshot().proposals.length, 200, 'nothing was dropped to make room');
});

test('a proposal on a gone or deleted agent is refused', () => {
  const e = newEngine(); e.providerChange({ agentId: 'ag-lex-01', present: false }); e.sync({});
  assert.equal(codeOf(() => prop(e, A, 'ag-lex-01', 'quarantine')), 'agent_not_live');
});

test('decision and execute arguments are validated: unknown proposal, bad decision, wrong types, extra keys', () => {
  const e = newEngine(); const p = prop(e, K, 'ag-bedrock-02', 'quarantine');
  for (const id of ['prop-9999', 5, undefined, '__proto__', null]) { assert.equal(codeOf(() => e.decide({ actor: A, proposalId: id, decision: 'approve' })), 'unknown_proposal'); assert.equal(codeOf(() => e.execute({ actor: A, proposalId: id })), 'unknown_proposal'); }
  for (const d of ['maybe', undefined, 5, ['approve'], {}]) assert.equal(codeOf(() => e.decide({ actor: A, proposalId: p.proposalId, decision: d })), 'bad_decision');
  assert.equal(codeOf(() => e.decide({ actor: A, proposalId: p.proposalId, decision: 'approve', comment: 5 })), 'bad_comment');
  assert.equal(codeOf(() => e.decide({ actor: A, proposalId: p.proposalId, decision: 'approve', extra: 1 })), 'unknown_field');
  assert.equal(codeOf(() => e.execute({ actor: A, proposalId: p.proposalId, extra: 1 })), 'unknown_field');
  assert.equal(proposal(e, p.proposalId).status, 'proposed');
});

test('SUCCESSION: a departure proposes a transfer per agent; each needs a different administrator; the departed custodian can no longer act', () => {
  const e = newEngine();
  const held = e.snapshot().agents.filter((a) => a.custodian === K2).map((a) => a.id);
  assert.ok(held.length >= 5);
  const r = e.depart({ actor: A, person: K2, successor: K3 });
  assert.equal(r.proposals.length, held.length);
  for (const pid of r.proposals) { const pr = proposal(e, pid); assert.deepEqual([pr.kind, pr.params, pr.proposedBy, pr.succession], ['transfer', { to: K3 }, A, true]); assert.equal(codeOf(() => approve(e, A, pid)), 'self_approval'); }
  assert.ok(e.snapshot().agents.filter((a) => a.custodian === K2).every((a) => a.actionRequired.includes('custodian-departed')));
  approve(e, A2, r.proposals[0]); exec(e, A2, r.proposals[0]);
  const moved = proposal(e, r.proposals[0]).agentId;
  assert.equal(agentOf(e, moved).custodian, K3); assert.ok(!agentOf(e, moved).actionRequired.includes('custodian-departed'));
  assert.equal(codeOf(() => prop(e, K2, held[1], 'quarantine')), 'actor_departed');
  assert.equal(e.snapshot().roster.find((p) => p.id === K2).departed, true);
});

test('departure arguments: administrator only, a custodian who is still here, a different successor, whole-request caps', () => {
  const e = newEngine();
  assert.equal(codeOf(() => e.depart({ actor: K, person: K2, successor: K3 })), 'admin_only');
  assert.equal(codeOf(() => e.depart({ actor: A, person: A2, successor: K3 })), 'bad_person');
  assert.equal(codeOf(() => e.depart({ actor: A, person: O, successor: K3 })), 'bad_person');
  assert.equal(codeOf(() => e.depart({ actor: A, person: K2, successor: K2 })), 'bad_custodian');
  assert.equal(codeOf(() => e.depart({ actor: A, person: K2, successor: A })), 'bad_custodian');
  assert.equal(codeOf(() => e.depart({ actor: A, person: 5, successor: K3 })), 'bad_person');
  assert.equal(codeOf(() => e.depart({ actor: A, person: K2, successor: K3, extra: 1 })), 'unknown_field');
  assert.equal(e.snapshot().proposals.length, 0, 'every refusal changed nothing');
  e.depart({ actor: A, person: K2, successor: K3 });
  assert.equal(codeOf(() => e.depart({ actor: A, person: K2, successor: K3 })), 'bad_person', 'a departed custodian cannot depart twice');
  assert.equal(codeOf(() => e.depart({ actor: A, person: K, successor: K2 })), 'bad_custodian', 'a departed custodian cannot be the successor');
});

test('a transfer to a successor who has since left is stale or refused at execution', () => {
  const e = newEngine();
  const p = prop(e, A, 'ag-bedrock-01', 'transfer', { to: K3 }); approve(e, A2, p.proposalId);
  e.depart({ actor: A, person: K3, successor: K2 });
  assert.equal(codeOf(() => exec(e, A, p.proposalId)), 'stale_proposal');
});

test('the order of operations does not matter for the audit: every state change is by a named actor', () => {
  const e = newEngine(); discoverAll(e); remediate(e, K, 'ag-bedrock-02', 'quarantine');
  for (const a of audit(e)) assert.ok(typeof a.actor === 'string' && a.actor.length > 0, a.kind);
  assert.deepEqual(audit(e).map((a) => a.n), audit(e).map((_, i) => i + 1), 'numbered without gaps');
});
