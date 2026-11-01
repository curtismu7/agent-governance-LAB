import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACE_RE, createWorkspaces, workspaceFrom } from '../src/workspaces.js';
import { VERTICALS } from '../src/cast.js';

const C = VERTICALS.finance;
test('workspaceFrom defaults, accepts a good id and refuses a bad one', () => {
  assert.equal(workspaceFrom({ headers: {} }), 'default');
  assert.equal(workspaceFrom({ headers: { 'x-workspace': 'abc-1' } }), 'abc-1');
  for (const bad of ['', 'A', 'a b', 'a/b', 'x'.repeat(41), ['a'], '__proto__']) assert.equal(workspaceFrom({ headers: { 'x-workspace': bad } }), bad === '__proto__' ? null : null);
  assert.ok(WORKSPACE_RE.test('a'));
});

test('engines are per workspace and per vertical, created on first use, and reset clears the workspace only', () => {
  const w = createWorkspaces();
  const a = w.engine('a', 'finance', C); const a2 = w.engine('a', 'finance', C); const ah = w.engine('a', 'health', VERTICALS.health); const b = w.engine('b', 'finance', C);
  assert.equal(a, a2); assert.notEqual(a, ah); assert.notEqual(a, b);
  assert.equal(w.peek('a', 'finance'), a); assert.equal(w.peek('zzz', 'finance'), null); assert.equal(w.peek('a', 'retail'), null);
  assert.equal(w.size(), 2, 'a peek never creates a workspace');
  w.reset('a');
  assert.equal(w.peek('a', 'finance'), null); assert.equal(w.peek('b', 'finance'), b);
});

test('the store expires idle workspaces after the ttl, and REFUSES a new one at the cap (nothing is evicted to make room)', () => {
  let t = 0;
  const w = createWorkspaces({ max: 3, ttlMs: 100, now: () => t });
  for (const id of ['a', 'b', 'c']) w.engine(id, 'finance', C);
  assert.equal(w.size(), 3);
  assert.throws(() => w.engine('d', 'finance', C), (e) => e.code === 'too_many_workspaces' && e.status === 429);
  assert.equal(w.size(), 3); assert.ok(w.peek('a', 'finance'), 'the oldest is still there');
  w.engine('a', 'finance', C); // an existing one is fine
  t = 500;
  assert.equal(w.peek('d', 'finance'), null);
  assert.equal(w.peek('a', 'finance'), null, 'an idle one expires');
  assert.equal(w.size(), 0);
  w.engine('d', 'finance', C); assert.equal(w.size(), 1, 'room again once the idle ones expired');
});

test('the DEFAULTS are the stated ones: 500 workspaces (the 501st is refused) and one hour idle (3,600,000 ms stays, one ms more expires)', () => {
  let t = 1_000_000;
  const w = createWorkspaces({ now: () => t });
  for (let i = 0; i < 500; i++) w.engine(`w-${i}`, 'finance', C);
  assert.equal(w.size(), 500);
  assert.throws(() => w.engine('w-500', 'finance', C), (e) => e.code === 'too_many_workspaces' && e.status === 429 && /an idle one expires after an hour/.test(e.message));
  t += 3_600_000;
  assert.ok(w.peek('w-0', 'finance'), 'idle for exactly one hour is still kept');
  t += 1;
  assert.equal(w.peek('w-0', 'finance'), null, 'idle for one hour and a millisecond has expired');
  assert.equal(w.size(), 0);
});
