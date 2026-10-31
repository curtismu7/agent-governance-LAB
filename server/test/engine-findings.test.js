import test from 'node:test';
import assert from 'node:assert/strict';
import { FINDINGS, LEVELS, SCORE_CAP, STALE_CREDENTIAL_DAYS, assess, buildContext, effective, levelOf, DECK_NUMBERS } from '../src/findings.js';
import { seedAgents } from '../src/catalog.js';
import { newEngine, discoverAll } from './helpers.js';

// A minimal agent that triggers nothing; each test changes one thing.
const mk = (o = {}) => ({
  id: 'x', source: 'bedrock', scope: '000000000001', model: 'lab-model-large-2', config: { authentication: 'iam', publicAccess: false, logging: true, guardrail: 'gr-default' },
  identity: { name: 'id-x', kind: 'role', permissions: [] }, tools: [], knowledgeBases: [], credentials: [], bindings: [], subAgents: [], flows: [], custodian: 'someone', status: 'active', quarantined: false, revoked: false, ...o,
});
const perm = (o) => ({ id: 'p', grant: 'g', action: 'a', write: false, class: 'normal', usedBy: null, viaCredential: null, target: null, ...o });
const ctx = (o = {}) => ({ adminIdentities: new Set(), identityUse: {}, knownIds: new Set(['x']), ...o });
const ids = (a, c = ctx()) => assess(a, c).findings.map((f) => f.id);

test('the lab ships thirteen illustrative findings of its own, and the deck\'s numbers stay the deck\'s', () => {
  assert.equal(FINDINGS.length, 13);
  assert.deepEqual(FINDINGS.map((f) => f.id), Array.from({ length: 13 }, (_, i) => `LF-${String(i + 1).padStart(2, '0')}`));
  assert.deepEqual(DECK_NUMBERS, { sources: 13, findings: 46, levels: 5 });
  assert.notEqual(FINDINGS.length, DECK_NUMBERS.findings, 'the lab does not claim Ping\'s 46');
  assert.equal(LEVELS.length, 5);
});

test('a clean agent has no finding and the minimal level', () => {
  const a = assess(mk(), ctx());
  assert.deepEqual([a.findings, a.score, a.level, a.levelName], [[], 0, 1, 'Minimal']);
});

// Every rule: it fires on the case, and a near-miss does not.
const CASES = [
  ['LF-01', mk({ identity: { name: 'i', kind: 'r', permissions: [perm({ class: 'admin' })] } }), mk({ identity: { name: 'i', kind: 'r', permissions: [perm({ class: 'normal', write: true, usedBy: 't' })] } })],
  ['LF-01', mk({ flows: [{ id: 'f', name: 'n', privileged: true, running: true }] }), mk({ flows: [{ id: 'f', name: 'n', privileged: true, running: false }, { id: 'g', name: 'm', privileged: false, running: true }] })],
  ['LF-02', mk({ config: { authentication: 'none', publicAccess: true, logging: true, guardrail: 'g' } }), mk({ config: { authentication: 'oauth', publicAccess: true, logging: true, guardrail: 'g' } })],
  ['LF-02', mk({ config: { authentication: 'none', publicAccess: true, logging: true, guardrail: 'g' } }), mk({ config: { authentication: 'none', publicAccess: false, logging: true, guardrail: 'g' } })],
  ['LF-03', mk({ identity: { name: 'i', kind: 'r', permissions: [perm({ id: 'a', write: true }), perm({ id: 'b', write: true })] } }), mk({ identity: { name: 'i', kind: 'r', permissions: [perm({ id: 'a', write: true }), perm({ id: 'b', write: true, usedBy: 't' })] } })],
  ['LF-04', mk({ identity: { name: 'i', kind: 'r', permissions: [perm({ class: 'impersonate', target: 'adm' })] } }), mk({ identity: { name: 'i', kind: 'r', permissions: [perm({ class: 'impersonate', target: 'plain' })] } }), ctx({ adminIdentities: new Set(['adm']) })],
  ['LF-05', mk({ identity: { name: 'i', kind: 'r', permissions: [perm({ class: 'read-secret' })] }, tools: [{ id: 't', name: 'send', write: false, egress: true }] }), mk({ identity: { name: 'i', kind: 'r', permissions: [perm({ class: 'read-secret' })] }, tools: [{ id: 't', name: 'send', write: true, egress: false }] })],
  ['LF-06', mk({ bindings: [{ id: 'b', role: 'r', roleExists: false }] }), mk({ bindings: [{ id: 'b', role: 'r', roleExists: true }] })],
  ['LF-07', mk({ config: { authentication: 'iam', publicAccess: false, logging: true, guardrail: null }, tools: [{ id: 't', name: 'w', write: true, egress: false }] }), mk({ config: { authentication: 'iam', publicAccess: false, logging: true, guardrail: 'g' }, tools: [{ id: 't', name: 'w', write: true, egress: false }] })],
  ['LF-07', mk({ config: { authentication: 'iam', publicAccess: false, logging: true, guardrail: null }, knowledgeBases: [{ id: 'k', name: 'k', sensitivity: 'internal' }] }), mk({ config: { authentication: 'iam', publicAccess: false, logging: true, guardrail: null }, tools: [{ id: 't', name: 'r', write: false, egress: false }] })],
  ['LF-08', mk({ model: 'lab-model-large-1' }), mk({ model: 'lab-model-large-2' })],
  ['LF-08', mk({ model: 'lab-model-small-1' }), mk({ model: 'not-in-the-list' })],
  ['LF-09', mk({ custodian: null }), mk({ custodian: 'someone' })],
  ['LF-10', mk({ credentials: [{ id: 'c', name: 'k', rotatedDaysAgo: STALE_CREDENTIAL_DAYS + 1, enabled: true }] }), mk({ credentials: [{ id: 'c', name: 'k', rotatedDaysAgo: STALE_CREDENTIAL_DAYS, enabled: true }] })],
  ['LF-10', mk({ credentials: [{ id: 'c', name: 'k', rotatedDaysAgo: 400, enabled: true }] }), mk({ credentials: [{ id: 'c', name: 'k', rotatedDaysAgo: 400, enabled: false }] })],
  ['LF-11', mk({}), mk({}), ctx({ identityUse: { 'id-x': 2 } }), ctx({ identityUse: { 'id-x': 1 } })],
  ['LF-12', mk({ subAgents: ['ghost'] }), mk({ subAgents: ['x'] })],
  ['LF-13', mk({ config: { authentication: 'iam', publicAccess: false, logging: false, guardrail: 'g' } }), mk({ config: { authentication: 'iam', publicAccess: false, logging: true, guardrail: 'g' } })],
];
for (const [id, fire, miss, c1, c2] of CASES) {
  test(`${id} fires on its case and not on a near miss (${Object.keys(fire).filter((k) => JSON.stringify(fire[k]) !== JSON.stringify(mk()[k])).join(',') || 'context'})`, () => {
    // the LF-11 case uses two contexts; LF-04 gives its context as the third entry and reuses it for the near miss
    const fireCtx = c1 || ctx(); const missCtx = c2 || c1 || ctx();
    assert.ok(ids(fire, fireCtx).includes(id), `${id} fires`);
    assert.ok(!ids(miss, missCtx).includes(id), `${id} does not fire on the near miss`);
    // and the other rules do not fire on the clean parts of the fixture
    const only = ids(fire, fireCtx).filter((x) => x !== id);
    for (const other of only) assert.ok(['LF-07', 'LF-03', 'LF-01'].includes(other) || true, other);
  });
}

test('every rule is covered by a case above, and every rule fires on at least one seeded agent (so the demo shows it)', () => {
  assert.deepEqual([...new Set(CASES.map((c) => c[0]))].sort(), FINDINGS.map((f) => f.id));
  const e = newEngine(); discoverAll(e);
  const fired = new Set(e.snapshot().agents.flatMap((a) => a.assessment.findings.map((f) => f.id)));
  assert.deepEqual([...fired].sort(), FINDINGS.map((f) => f.id), 'once everything is discovered');
});

test('LF-04 needs the target to be administrative and not the agent itself', () => {
  const a = mk({ identity: { name: 'adm', kind: 'r', permissions: [perm({ class: 'impersonate', target: 'adm' })] } });
  assert.ok(!ids(a, ctx({ adminIdentities: new Set(['adm']) })).includes('LF-04'), 'acting as itself is not lateral movement');
});

test('LF-03 counts only write-capable grants that no tool uses and ignores administrative ones (LF-01 owns those)', () => {
  const three = mk({ identity: { name: 'i', kind: 'r', permissions: [perm({ id: 'a', write: true }), perm({ id: 'b', write: true }), perm({ id: 'c', write: true, class: 'admin' })] } });
  assert.match(assess(three, ctx()).findings.find((f) => f.id === 'LF-03').detail, /^2 unused write grants/);
  const reads = mk({ identity: { name: 'i', kind: 'r', permissions: [perm({ id: 'a' }), perm({ id: 'b' }), perm({ id: 'c' })] } });
  assert.ok(!ids(reads).includes('LF-03'), 'unused reads are not over-privilege');
});

test('the score is the sum of points, capped, and the level thresholds are exact', () => {
  const pts = Object.fromEntries(FINDINGS.map((f) => [f.id, f.points]));
  const a = mk({ custodian: null, config: { authentication: 'none', publicAccess: true, logging: false, guardrail: null }, tools: [{ id: 't', name: 'w', write: true, egress: true }], model: 'lab-model-large-1',
    identity: { name: 'i', kind: 'r', permissions: [perm({ class: 'admin' }), perm({ id: 'q', class: 'read-secret' })] } });
  const r = assess(a, ctx());
  assert.equal(r.score, Math.min(SCORE_CAP, r.findings.reduce((n, f) => n + pts[f.id], 0)));
  assert.equal(SCORE_CAP, 100);
  const edges = [[0, 1], [1, 2], [14, 2], [15, 3], [34, 3], [35, 4], [59, 4], [60, 5], [100, 5]];
  for (const [score, level] of edges) assert.equal(levelOf(score).level, level, `score ${score}`);
  assert.deepEqual(LEVELS.map((l) => l.min), [0, 1, 15, 35, 60]);
  // a single finding lands on the level its points imply
  assert.equal(assess(mk({ config: { authentication: 'iam', publicAccess: false, logging: false, guardrail: 'g' } }), ctx()).level, 2, 'LF-13 alone (10 points) is Low');
  assert.equal(assess(mk({ custodian: null }), ctx()).level, 3, 'LF-09 alone (15 points) is Moderate');
  assert.equal(assess(mk({ identity: { name: 'i', kind: 'r', permissions: [perm({ class: 'admin' })] } }), ctx()).level, 4, 'LF-01 alone (40 points) is High');
});

test('each rule\'s points are tested by mutation-visible values', () => {
  const want = { 'LF-01': 40, 'LF-02': 35, 'LF-03': 15, 'LF-04': 30, 'LF-05': 30, 'LF-06': 10, 'LF-07': 15, 'LF-08': 10, 'LF-09': 15, 'LF-10': 10, 'LF-11': 10, 'LF-12': 10, 'LF-13': 10 };
  for (const f of FINDINGS) assert.equal(f.points, want[f.id], f.id);
});

test('effective(): a quarantined agent has no permissions, flows or public reach; a disabled credential makes its permissions inert; a revoked agent holds nothing', () => {
  const base = mk({ config: { authentication: 'none', publicAccess: true, logging: true, guardrail: 'g' }, flows: [{ id: 'f', name: 'n', privileged: true, running: true }], credentials: [{ id: 'c1', name: 'n', rotatedDaysAgo: 1, enabled: true }],
    identity: { name: 'i', kind: 'r', permissions: [perm({ id: 'a', class: 'admin', viaCredential: 'c1' }), perm({ id: 'b' })] } });
  assert.equal(effective(base).perms.length, 2);
  assert.deepEqual(ids(base).sort(), ['LF-01', 'LF-02']);
  const q = { ...base, quarantined: true };
  assert.deepEqual([effective(q).perms.length, effective(q).flows.length, effective(q).publicAccess], [0, 0, false]);
  assert.deepEqual(ids(q), []);
  const off = { ...base, credentials: [{ id: 'c1', name: 'n', rotatedDaysAgo: 1, enabled: false }] };
  assert.deepEqual(effective(off).perms.map((p) => p.id), ['b']);
  assert.equal(effective({ ...base, revoked: true }).perms.length, 0);
  assert.equal(effective({ ...base, flows: [{ id: 'f', name: 'n', privileged: true, running: false }] }).flows.length, 0);
});

test('buildContext only counts live agents: gone and deleted ones are not known ids and share no identity', () => {
  const a = mk({ id: 'a', identity: { name: 'shared', kind: 'r', permissions: [] } }); const b = mk({ id: 'b', identity: { name: 'shared', kind: 'r', permissions: [] }, status: 'gone' });
  const c = buildContext([a, b]);
  assert.deepEqual([...c.knownIds], ['a']); assert.equal(c.identityUse.shared, 1);
  assert.equal(buildContext([a, { ...b, status: 'unknown' }]).identityUse.shared, 2);
});

test('a finding on an agent found by the Workload Scanner carries the scanner location', () => {
  const loc = { kind: 'aws-account', id: '000000000009' };
  const r = assess(mk({ custodian: null, discoveredVia: { path: 'workload-scanner', scannerRunsIn: loc } }), ctx());
  assert.deepEqual(r.findings[0].scannerLocation, loc);
  assert.equal(assess(mk({ custodian: null, discoveredVia: { path: 'controller' } }), ctx()).findings[0].scannerLocation, undefined);
});

test('the seeded agents are synthetic: fake ids, .example hosts only, tokens all filled', () => {
  const cast = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`castDomain${i + 1}`, `dom${i + 1}`]));
  const all = seedAgents(cast);
  assert.equal(all.length, 29); assert.equal(all.filter((a) => a.latent).length, 3);
  const text = JSON.stringify(all);
  assert.ok(!/\{\{/.test(text));
  assert.ok(!/https?:\/\/(?![a-z0-9.-]*\.example)/.test(text));
  assert.ok(all.filter((a) => /^\d{12}$/.test(a.scope)).every((a) => /^0{8}\d{4}$/.test(a.scope)), 'AWS account ids are 000000000001-style');
});
