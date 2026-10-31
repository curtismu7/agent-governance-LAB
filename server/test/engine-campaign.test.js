import test from 'node:test';
import assert from 'node:assert/strict';
import { A, A2, K, K2, K3, O, agentOf, approve, codeOf, deny, exec, newEngine, prop } from './helpers.js';

const camp = (e) => e.snapshot().campaign;
const item = (e, agentId) => camp(e).items.find((i) => i.agentId === agentId);

test('a campaign has one item per live agent; an orphan starts escalated; only an administrator starts or closes it; one open at a time', () => {
  const e = newEngine();
  assert.equal(camp(e), null);
  assert.equal(codeOf(() => e.startCampaign({ actor: K, action: 'start' })), 'admin_only');
  assert.equal(codeOf(() => e.startCampaign({ actor: A, action: 'close' })), 'no_open_campaign');
  assert.equal(codeOf(() => e.startCampaign({ actor: A, action: 'nope' })), 'bad_action');
  assert.equal(codeOf(() => e.startCampaign({ actor: A, action: 'start', x: 1 })), 'unknown_field');
  e.startCampaign({ actor: A, action: 'start' });
  assert.equal(camp(e).items.length, 23);
  assert.equal(item(e, 'ag-lex-01').status, 'escalated', 'an orphan escalates at once');
  assert.equal(item(e, 'ag-bedrock-01').status, 'pending');
  assert.equal(codeOf(() => e.startCampaign({ actor: A2, action: 'start' })), 'campaign_open');
});

test('a custodian certifies their own agent; nobody else decides a pending item; a decision is final', () => {
  const e = newEngine(); e.startCampaign({ actor: A, action: 'start' });
  const id = item(e, 'ag-bedrock-01').id;
  assert.equal(codeOf(() => e.decideItem({ actor: K2, itemId: id, decision: 'certify' })), 'not_the_custodian');
  assert.equal(codeOf(() => e.decideItem({ actor: A, itemId: id, decision: 'certify' })), 'not_the_custodian', 'an administrator does not override a pending item');
  assert.equal(codeOf(() => e.decideItem({ actor: O, itemId: id, decision: 'certify' })), 'not_the_custodian');
  assert.ok(e.snapshot().audit.some((a) => a.kind === 'refused:not_the_custodian' && a.actor === K2));
  e.decideItem({ actor: K, itemId: id, decision: 'certify', comment: 'reviewed' });
  assert.equal(item(e, 'ag-bedrock-01').status, 'certified');
  assert.equal(codeOf(() => e.decideItem({ actor: K, itemId: id, decision: 'revoke' })), 'item_not_open', 'certify then revoke');
  assert.equal(codeOf(() => e.decideItem({ actor: K, itemId: id, decision: 'certify' })), 'item_not_open', 'duplicate');
});

test('a revoke is a proposal: it needs an administrator and only then revokes; denying it returns the item to pending', () => {
  const e = newEngine(); e.startCampaign({ actor: A, action: 'start' });
  const id = item(e, 'ag-bedrock-02').id;
  const r = e.decideItem({ actor: K, itemId: id, decision: 'revoke' });
  assert.equal(item(e, 'ag-bedrock-02').status, 'revoke-proposed'); assert.equal(agentOf(e, 'ag-bedrock-02').revoked, false, 'nothing is revoked before approval');
  assert.equal(codeOf(() => approve(e, K, r.proposalId)), 'admin_only');
  deny(e, A, r.proposalId);
  assert.equal(item(e, 'ag-bedrock-02').status, 'pending'); assert.equal(item(e, 'ag-bedrock-02').proposalId, null);
  const r2 = e.decideItem({ actor: K, itemId: id, decision: 'revoke' });
  approve(e, A, r2.proposalId); exec(e, K, r2.proposalId);
  assert.equal(item(e, 'ag-bedrock-02').status, 'revoked'); assert.equal(agentOf(e, 'ag-bedrock-02').revoked, true);
  assert.equal(codeOf(() => e.decideItem({ actor: K, itemId: id, decision: 'certify' })), 'item_not_open', 'revoke then certify');
});

test('a stale revoke goes back to the custodian\'s queue; closing escalates every item nobody reviewed, and then only an administrator decides', () => {
  const e = newEngine(); e.startCampaign({ actor: A, action: 'start' });
  const id = item(e, 'ag-bedrock-02').id; const r = e.decideItem({ actor: K, itemId: id, decision: 'revoke' });
  prop(e, A, 'ag-bedrock-02', 'retag', { key: 'cost-center', value: 'z' }); // not executed: the agent is unchanged
  e.startCampaign({ actor: A2, action: 'close' });
  assert.equal(item(e, 'ag-bedrock-02').status, 'revoke-proposed', 'an item with a revoke in flight is not escalated');
  assert.equal(camp(e).status, 'closed');
  const pending = camp(e).items.filter((i) => i.status === 'escalated');
  assert.ok(pending.length > 10, 'unreviewed items escalated');
  const ex = item(e, 'ag-bedrock-01');
  assert.equal(ex.status, 'escalated');
  assert.equal(codeOf(() => e.decideItem({ actor: K, itemId: ex.id, decision: 'certify' })), 'admin_only', 'the custodian\'s window is closed');
  e.decideItem({ actor: A2, itemId: ex.id, decision: 'certify' });
  assert.equal(item(e, 'ag-bedrock-01').status, 'certified');
  assert.ok(r.proposalId);
  // a new campaign may start after the first closed
  e.startCampaign({ actor: A, action: 'start' });
  assert.equal(camp(e).id, 'camp-0002');
});

test('campaign arguments are validated: unknown item, bad decision, wrong types, extra keys; a closed campaign cannot be closed twice', () => {
  const e = newEngine(); e.startCampaign({ actor: A, action: 'start' });
  const id = item(e, 'ag-bedrock-01').id;
  for (const bad of ['ci-9999', 5, undefined, '__proto__', null]) assert.equal(codeOf(() => e.decideItem({ actor: K, itemId: bad, decision: 'certify' })), 'unknown_item');
  for (const d of ['maybe', undefined, 5, {}]) assert.equal(codeOf(() => e.decideItem({ actor: K, itemId: id, decision: d })), 'bad_decision');
  assert.equal(codeOf(() => e.decideItem({ actor: K, itemId: id, decision: 'certify', comment: 5 })), 'bad_comment');
  assert.equal(codeOf(() => e.decideItem({ actor: K, itemId: id, decision: 'certify', extra: 1 })), 'unknown_field');
  assert.equal(codeOf(() => e.decideItem({ actor: 'nobody', itemId: id, decision: 'certify' })), 'bad_actor');
  e.startCampaign({ actor: A, action: 'close' });
  assert.equal(codeOf(() => e.startCampaign({ actor: A, action: 'close' })), 'no_open_campaign');
});

test('an agent whose custodian left starts escalated, and an administrator can revoke it', () => {
  const e = newEngine(); e.depart({ actor: A, person: K2, successor: K3 });
  e.startCampaign({ actor: A2, action: 'start' });
  const it = item(e, 'ag-agentcore-01'); assert.equal(it.status, 'escalated'); assert.equal(it.custodian, null);
  const r = e.decideItem({ actor: A2, itemId: it.id, decision: 'revoke' });
  approve(e, A, r.proposalId); exec(e, A2, r.proposalId);
  assert.equal(agentOf(e, 'ag-agentcore-01').revoked, true);
});

test('campaigns are capped at five per workspace; the sixth is refused whole', () => {
  const e = newEngine();
  for (let i = 0; i < 5; i++) { e.startCampaign({ actor: A, action: 'start' }); e.startCampaign({ actor: A, action: 'close' }); }
  assert.equal(codeOf(() => e.startCampaign({ actor: A, action: 'start' })), 'workspace_full');
  assert.equal(e.snapshot().campaigns, 5);
});
