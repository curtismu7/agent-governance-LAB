// The Mock tables are generated from the engine. A test fails if they drift, if the talk-track doc drifts, and if the HTTP API (Live) gives a different final
// state than the scripted run for the same steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_TABLE } from '../src/mockTable.js';
import { EXPECTED, buildMockTable, runScenario, scenarioList } from '../src/scenarios.js';
import { VERTICALS, DEFAULT_CAST } from '../src/cast.js';
import { renderTalkTrackMarkdown } from '../src/story.js';
import { OP_NAMES } from '../src/actions.js';
import { api, withServer, get, json, W } from './helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the committed Mock table is exactly what the engine generates now (run `npm run mock-table` after a change)', () => {
  assert.deepEqual(MOCK_TABLE, buildMockTable());
});

test('every scripted step gives the result the story says, in every vertical, and every scenario has a say', () => {
  for (const [v, cast] of Object.entries(VERTICALS)) {
    for (const sc of scenarioList(cast)) {
      const got = runScenario(cast, sc).steps.map((s) => (s.result.ok ? 'ok' : s.result.code));
      assert.deepEqual(got, EXPECTED[sc.id], `${v}/${sc.id}`);
      assert.ok(sc.say.length > 20);
      for (const st of sc.steps) assert.ok(st.say.length > 5);
    }
  }
  assert.deepEqual(Object.keys(EXPECTED), scenarioList(DEFAULT_CAST).map((s) => s.id));
});

test('the Mock table agrees with the table\'s own refusals: the steps recorded are the steps run', () => {
  const t = MOCK_TABLE.verticals.finance.scenarios.find((s) => s.id === 'approval');
  assert.deepEqual(t.steps.map((s) => (s.ok ? 'ok' : s.code)), EXPECTED.approval);
  assert.equal(t.state.agents.find((a) => a.id === 'ag-bedrock-02').quarantined, true);
  assert.equal(MOCK_TABLE.verticals.finance.scenarios.length, 8);
});

test('docs/talk-track.md is exactly what the talk-track data generates (run `npm run talk-track`)', () => {
  assert.equal(fs.readFileSync(path.join(root, 'docs/talk-track.md'), 'utf8'), renderTalkTrackMarkdown(DEFAULT_CAST));
});

// op -> the HTTP call the page makes
const HTTP = {
  sync: ['POST', () => '/api/sync', (p) => ({ sync: p })],
  propose: ['POST', () => '/api/proposals', (p) => ({ proposal: p })],
  decide: ['POST', (p) => `/api/proposals/${p.proposalId}/decision`, ({ proposalId, ...r }) => ({ decision: r })],
  execute: ['POST', (p) => `/api/proposals/${p.proposalId}/execute`, ({ proposalId, ...r }) => ({ execute: r })],
  campaign: ['POST', () => '/api/campaign', (p) => ({ campaign: p })],
  itemDecision: ['POST', (p) => `/api/campaign/items/${p.itemId}/decision`, ({ itemId, ...r }) => ({ decision: r })],
  depart: ['POST', () => '/api/custodians/depart', (p) => ({ depart: p })],
  providerChange: ['POST', () => '/api/provider/change', (p) => ({ change: p })],
  onboarding: ['PUT', () => '/api/org/onboarding', (p) => ({ onboarding: p })],
  privateTenant: ['PUT', () => '/api/private-network/tenant', (p) => ({ tenant: p })],
  addConnection: ['POST', () => '/api/private-network/connections', ({ actor, connection }) => ({ connection: { actor, ...connection } })],
  updateConnection: ['PUT', (p) => `/api/private-network/connections/${p.connectionId}`, ({ actor, connection }) => ({ connection: { actor, ...connection } })],
  poll: ['POST', () => '/api/private-network/connector/poll', (p) => ({ poll: p })],
  gateway: ['POST', (p) => `/api/gateways/${p.gatewayId}/actions`, (p) => ({ action: p.action })],
};

test('MOCK/LIVE PARITY: replaying every scenario through the HTTP API gives exactly the state the Mock table holds', async () => {
  assert.deepEqual(Object.keys(HTTP).sort(), [...OP_NAMES].sort(), 'every op has an HTTP route');
  await withServer(async (url) => {
    let n = 0;
    for (const sc of scenarioList(VERTICALS.finance)) {
      const ws = `parity-${n++}`;
      for (const st of sc.steps) { const [m, route, body] = HTTP[st.op]; const r = await api(url, m, route(st.params), body(st.params), ws); assert.equal(r.body.ok === true ? 'ok' : r.body.error, EXPECTED[sc.id][sc.steps.indexOf(st)], `${sc.id}: ${st.say}`); }
      const live = (await json(await get(url, '/api/state?mode=live&vertical=finance', W(ws)))).state;
      const mock = MOCK_TABLE.verticals.finance.scenarios.find((s) => s.id === sc.id).state;
      assert.deepEqual(live, mock, sc.id);
    }
  });
});
