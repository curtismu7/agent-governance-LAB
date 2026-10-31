import test from 'node:test';
import assert from 'node:assert/strict';
import { A, A2, C, K, codeOf, newEngine } from './helpers.js';
import { CHECKS, TRUNCATE_AT, scorecard, seedGateways, bypassOpen } from '../src/gateway.js';

const G1 = 'gw-lab-01'; const NAME1 = `${C.castDomain1}-gateway`;
const gw = (e, id = G1) => e.snapshot().gateways.find((g) => g.id === id);
const act = (e, a, who = A, id = G1) => e.gateway(id, { actor: who, ...a });
const code = (e, a, who = A, id = G1) => codeOf(() => act(e, a, who, id));

test('the nine modelAgentCoreAccountMetadata fields are present, as the swagger names them (shapes lab-invented)', () => {
  const m = newEngine().snapshot().agentCore;
  assert.deepEqual(Object.keys(m).sort(), ['BypassDiffJSON', 'GatewayBypassPostureJSON', 'GatewayCallerAccessJSON', 'GatewayDetailJSON', 'GatewayEnginesJSON', 'GatewayScorecardJSON', 'RuntimeCallerAccessJSON', 'TargetCallerAccessJSON', 'Truncated']);
  assert.equal(m.Truncated, false);
  assert.ok(m.GatewayEnginesJSON.some((x) => x.orphaned === true && x.attachments.length === 0), 'an engine attached to no gateway is reported as drift');
  assert.equal(m.GatewayScorecardJSON.length, 2); assert.equal(m.GatewayScorecardJSON[0].total, 12);
});

test('Truncated is computed from the size of the snapshot, not asserted', () => {
  const e = newEngine();
  e.s.gateways[0].sessions = Array.from({ length: 700 }, (_, i) => ({ id: `s-${i}`, principal: 'p'.repeat(20) }));
  e.s.gateways[0].cedar = Array.from({ length: 400 }, (_, i) => ({ principal: `role-${i}-${'x'.repeat(30)}`, target: 'tg-1', tools: ['a', 'b'] }));
  assert.equal(e.snapshot().agentCore.Truncated, true);
  assert.ok(TRUNCATE_AT > 0);
});

test('the scorecard has the twelve checks the swagger description lists, each driven by state: mutate the state and the check flips', () => {
  assert.equal(CHECKS.length, 12);
  const g = seedGateways(C)[0]; const card = () => Object.fromEntries(scorecard(g).checks.map((c) => [c.id, c.green]));
  const base = card(); assert.equal(Object.keys(base).length, 12);
  const flip = (id, mutate, restore) => { mutate(); assert.notEqual(card()[id], base[id], id); restore(); assert.deepEqual(card(), base, `${id} restored`); };
  flip('authorizer', () => { g.authorizer.type = 'IAM'; }, () => { g.authorizer.type = 'JWT'; });
  flip('audience-pinning', () => { g.authorizer.audiences = ['*']; }, () => { g.authorizer.audiences = [`${g.name}-clients`]; });
  flip('audience-pinning', () => { g.authorizer.audiences = []; }, () => { g.authorizer.audiences = [`${g.name}-clients`]; });
  flip('enforcement', () => { g.engine.mode = 'ENFORCE'; }, () => { g.engine.mode = 'LOG_ONLY'; });
  flip('policy-scope', () => { g.engine.policyCount = 0; }, () => { g.engine.policyCount = 4; });
  flip('enforcement-health', () => { g.engine.status = 'FAILED'; }, () => { g.engine.status = 'ACTIVE'; });
  flip('caller-pinning', () => { g.pinnedEndpoint = 'https://a.example'; }, () => { g.pinnedEndpoint = null; });
  flip('throttling', () => { g.rateLimit = 0; }, () => { g.rateLimit = 100; });
  flip('waf', () => { g.wafFailureMode = 'fail-closed'; }, () => { g.wafFailureMode = 'fail-open'; });
  flip('egress-privacy', () => { g.egress = 'public'; }, () => { g.egress = 'private'; });
  flip('content-checks', () => { g.contentChecks = false; }, () => { g.contentChecks = true; });
  flip('bypass-closed', () => { g.runtimes[0].callers.forEach((c) => { c.direct = false; }); g.runtimes[0].resourcePolicy = 'gateway-only'; }, () => { g.runtimes[0].callers.forEach((c) => { c.direct = true; }); g.runtimes[0].resourcePolicy = 'direct-allowed'; });
  flip('network-paths', () => { g.runtimes[0].networkMode = 'VPC'; }, () => { g.runtimes[0].networkMode = 'PUBLIC'; });
  const sc = scorecard(g); assert.equal(sc.greenCount, sc.checks.filter((c) => c.green).length);
  assert.ok(bypassOpen(g.runtimes[0]) && !bypassOpen(g.runtimes[1]));
});

test('LOG_ONLY to ENFORCE needs the gateway name typed: wrong, missing, wrong-typed and near-miss text all refuse and change nothing', () => {
  const e = newEngine(); const before = JSON.stringify(gw(e));
  for (const confirm of [undefined, '', 'wrong', NAME1.toUpperCase(), ` ${NAME1}`, `${NAME1} `, NAME1.slice(0, -1), 5, null, [NAME1], { x: NAME1 }, 'gw-lab-01', true]) assert.equal(code(e, { kind: 'set-enforcement', mode: 'ENFORCE', confirm }), 'confirmation_mismatch', JSON.stringify(confirm));
  assert.equal(JSON.stringify(gw(e)), before, 'nothing changed');
  const r = act(e, { kind: 'set-enforcement', mode: 'ENFORCE', confirm: NAME1 });
  assert.equal(gw(e).engine.mode, 'ENFORCE'); assert.deepEqual([r.scorecard.before, r.scorecard.after], [r.scorecard.before, r.scorecard.before + 1]);
  assert.equal(code(e, { kind: 'set-enforcement', mode: 'ENFORCE', confirm: NAME1 }), 'already_in_state');
  act(e, { kind: 'set-enforcement', mode: 'LOG_ONLY' }); assert.equal(gw(e).engine.mode, 'LOG_ONLY', 'back to log-only needs no confirmation');
});

test('the typed confirmation is the gateway\'s own name: another gateway\'s name does not work', () => {
  const e = newEngine();
  assert.equal(code(e, { kind: 'set-enforcement', mode: 'ENFORCE', confirm: `${C.castDomain2}-gateway` }), 'confirmation_mismatch');
});

test('fail-open to fail-closed needs the typed confirmation too (lab reading); fail-closed to fail-open does not', () => {
  const e = newEngine();
  assert.equal(code(e, { kind: 'set-waf', mode: 'fail-closed' }), 'confirmation_mismatch');
  assert.equal(code(e, { kind: 'set-waf', mode: 'fail-closed', confirm: 'x' }), 'confirmation_mismatch');
  assert.equal(gw(e).wafFailureMode, 'fail-open');
  act(e, { kind: 'set-waf', mode: 'fail-closed', confirm: NAME1 }); assert.equal(gw(e).wafFailureMode, 'fail-closed');
  assert.equal(code(e, { kind: 'set-waf', mode: 'fail-closed', confirm: NAME1 }), 'already_in_state');
  act(e, { kind: 'set-waf', mode: 'fail-open' }); assert.equal(gw(e).wafFailureMode, 'fail-open');
  for (const mode of ['open', undefined, 5, 'FAIL-OPEN']) assert.equal(code(e, { kind: 'set-waf', mode }), 'bad_value');
});

test('enable or disable a tool target: the target lists no callers while disabled; a repeat, an unknown target and a wrong type are refused', () => {
  const e = newEngine();
  assert.ok(e.snapshot().agentCore.TargetCallerAccessJSON[0].targets.find((t) => t.target === 'tg-2').principals.length > 0);
  act(e, { kind: 'set-target', target: 'tg-2', enabled: false });
  assert.equal(gw(e).targets.find((t) => t.id === 'tg-2').enabled, false);
  assert.deepEqual(e.snapshot().agentCore.TargetCallerAccessJSON[0].targets.find((t) => t.target === 'tg-2').principals, []);
  assert.equal(code(e, { kind: 'set-target', target: 'tg-2', enabled: false }), 'already_in_state');
  assert.equal(code(e, { kind: 'set-target', target: 'nope', enabled: false }), 'unknown_target');
  assert.equal(code(e, { kind: 'set-target', target: '__proto__', enabled: false }), 'unknown_target');
  assert.equal(code(e, { kind: 'set-target', target: 5, enabled: false }), 'unknown_target');
  assert.equal(code(e, { kind: 'set-target', target: 'tg-1', enabled: 'false' }), 'bad_value');
  act(e, { kind: 'set-target', target: 'tg-2', enabled: true }); assert.equal(gw(e).targets.find((t) => t.id === 'tg-2').enabled, true);
});

test('CLOSE A BYPASS ROUTE: the before and after diff shows who was reachable only around the gateway and is now locked out', () => {
  const e = newEngine();
  const sc0 = scorecard(gw(e)); assert.equal(sc0.checks.find((c) => c.id === 'bypass-closed').green, false);
  const r = act(e, { kind: 'close-bypass', runtime: 'rt-1' });
  assert.deepEqual(r.bypassDiff.before, { runtime: 'rt-1', gatewayMediated: ['role-lab-agentcore-01'], bypassOnly: ['role-lab-batch-job'] });
  assert.deepEqual(r.bypassDiff.after, { runtime: 'rt-1', gatewayMediated: [], bypassOnly: [] });
  assert.deepEqual(r.lockedOut, ['role-lab-batch-job'], 'the bypass-only caller has no path left');
  assert.equal(gw(e).runtimes[0].resourcePolicy, 'gateway-only'); assert.equal(gw(e).runtimes[0].jwtGatewayPin, true);
  assert.equal(e.snapshot().agentCore.GatewayBypassPostureJSON.find((p) => p.runtime === 'rt-1' && p.gateway === G1).bypassOpen, false);
  assert.equal(scorecard(gw(e)).checks.find((c) => c.id === 'bypass-closed').green, true, 'the check is green now');
  assert.deepEqual(e.snapshot().agentCore.RuntimeCallerAccessJSON.find((x) => x.runtime === 'rt-1' && x.gateway === G1).direct, []);
  assert.ok(e.snapshot().agentCore.GatewayCallerAccessJSON[0].principals.some((p) => p.principal === 'role-lab-agentcore-01'), 'the gateway-mediated path still exists');
  assert.equal(code(e, { kind: 'close-bypass', runtime: 'rt-1' }), 'already_in_state');
  assert.equal(code(e, { kind: 'close-bypass', runtime: 'rt-2' }), 'already_in_state', 'a runtime that was never open');
  assert.equal(code(e, { kind: 'close-bypass', runtime: 'nope' }), 'unknown_runtime');
  assert.equal(code(e, { kind: 'close-bypass', runtime: 5 }), 'unknown_runtime');
  assert.equal(code(e, { kind: 'close-bypass', runtime: 'rt-1', confirm: 'x' }), 'unknown_field');
});

test('pin an endpoint: https on a .example or .invalid host only, no path, port, credentials or query; a repeat is refused', () => {
  const e = newEngine();
  for (const bad of ['http://a.example', 'https://a.example/path', 'https://a.example:8443', 'https://user@a.example', 'https://a.example/?x=1', 'https://a.example/#x', 'https://example.com', 'https://a.example.attacker.com', 'ftp://a.example', 'a.example', '', 5, null, `https://${'a'.repeat(200)}.example`, 'https://127.0.0.1', 'https://localhost', `https://${'deadbeef'.repeat(6)}.example`])
    assert.equal(code(e, { kind: 'pin-endpoint', endpoint: bad }), 'bad_endpoint', String(bad));
  assert.equal(gw(e).pinnedEndpoint, null);
  const r = act(e, { kind: 'pin-endpoint', endpoint: 'https://gw1.fabrikam.example' });
  assert.equal(r.pinnedEndpoint, 'https://gw1.fabrikam.example'); assert.equal(r.scorecard.after, r.scorecard.before + 1);
  assert.equal(code(e, { kind: 'pin-endpoint', endpoint: 'https://gw1.fabrikam.example' }), 'already_in_state');
  act(e, { kind: 'pin-endpoint', endpoint: 'https://other.invalid' }); assert.equal(gw(e).pinnedEndpoint, 'https://other.invalid');
});

test('end a session: it is removed once; a repeat and an unknown id are refused', () => {
  const e = newEngine();
  const r = act(e, { kind: 'end-session', session: 's-0002' });
  assert.deepEqual([r.ended, r.principal], ['s-0002', 'role-lab-batch-job']); assert.deepEqual(gw(e).sessions.map((s) => s.id), ['s-0001', 's-0003']);
  assert.equal(code(e, { kind: 'end-session', session: 's-0002' }), 'unknown_session');
  for (const bad of [5, undefined, '__proto__', null]) assert.equal(code(e, { kind: 'end-session', session: bad }), 'unknown_session');
  assert.equal(gw(e, 'gw-lab-02').sessions.length, 3, 'another gateway is untouched');
});

test('only a tenant administrator changes a gateway (lab reading); a custodian is refused and audited', () => {
  const e = newEngine();
  assert.equal(code(e, { kind: 'set-target', target: 'tg-1', enabled: false }, K), 'admin_only');
  assert.equal(code(e, { kind: 'set-target', target: 'tg-1', enabled: false }, 'nobody'), 'bad_actor');
  assert.equal(gw(e).targets[0].enabled, true);
  assert.ok(e.snapshot().audit.some((a) => a.kind === 'refused:admin_only' && a.actor === K));
  act(e, { kind: 'set-target', target: 'tg-1', enabled: false }, A2);
  const a = e.snapshot().audit.at(-1); assert.deepEqual([a.kind, a.actor, a.gateway], ['gateway:set-target', A2, G1]);
});

test('action shape: an unknown kind, an unknown gateway, wrong types and extra keys are refused', () => {
  const e = newEngine();
  for (const kind of [undefined, 5, 'wipe', '__proto__', ['set-waf']]) assert.equal(code(e, { kind }), 'bad_action');
  assert.equal(codeOf(() => e.gateway('nope', { actor: A, kind: 'set-waf', mode: 'fail-open' })), 'unknown_gateway');
  for (const g of [5, undefined, '__proto__', null]) assert.equal(codeOf(() => e.gateway(g, { actor: A, kind: 'end-session', session: 's-0001' })), 'unknown_gateway');
  assert.equal(codeOf(() => e.gateway(G1, 'x')), 'bad_action');
  assert.equal(codeOf(() => e.gateway(G1, null)), 'bad_action');
  assert.equal(code(e, { kind: 'end-session', session: 's-0001', mode: 'x' }), 'unknown_field');
  assert.equal(code(e, { kind: 'set-target', target: 'tg-1', enabled: false, confirm: 'x' }), 'unknown_field');
});

test('each gateway is independent: a change to one never moves the other', () => {
  const e = newEngine(); const before = JSON.stringify(gw(e, 'gw-lab-02')); const green = scorecard(gw(e, 'gw-lab-02')).greenCount;
  act(e, { kind: 'set-target', target: 'tg-1', enabled: false }); act(e, { kind: 'close-bypass', runtime: 'rt-1' });
  assert.equal(JSON.stringify(gw(e, 'gw-lab-02')), before);
  assert.equal(scorecard(gw(e, 'gw-lab-02')).greenCount, green);
});

test('every gateway change is audited with the actor, the gateway and the scorecard before and after, and shows an illustrative provider hop', () => {
  const e = newEngine(); e.trace = { traceId: 'a'.repeat(32), span: () => 'b'.repeat(16) };
  act(e, { kind: 'pin-endpoint', endpoint: 'https://gw1.fabrikam.example' }, A2);
  const a = e.snapshot().audit.at(-1);
  assert.deepEqual([a.kind, a.actor, a.gateway, a.scorecardAfter - a.scorecardBefore], ['gateway:pin-endpoint', A2, G1, 1]);
  assert.match(e.hops[0].request.url, /\.example\//); assert.match(e.hops[0].label, /never sent/);
});
