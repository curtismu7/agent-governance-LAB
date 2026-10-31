import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStory } from '../src/story.js';
import { DEFAULT_CAST, VERTICALS, unfilled } from '../src/cast.js';
import { AVAILABILITY, BANNER, CLAIM_LABEL, CLAIMS, DISCREPANCIES, FIELD_SOURCES, FIELD_SOURCE_NAMES, LIMITS_TEXT, NOT_DEMONSTRATED, TALK_TRACK, WHY, WHY_TEXT } from '../src/data.js';
import { LIMITS } from '../src/engine.js';
import { scanHosts, scanKeys } from '../src/safety.js';
import { findCredentials } from '../src/credentials.js';
import { SOURCES } from '../src/catalog.js';
import { DIAGRAM_NAMES, buildDiagram, loadDiagram } from '../src/diagramData.js';
import { validateDiagram } from '../src/diagramStudioValidate.js';

const s = buildStory(DEFAULT_CAST, 'finance');

test('both banners say SIMULATED, name their mode, carry the unverified label and the release', () => {
  for (const m of ['mock', 'live']) { assert.match(BANNER[m], new RegExp(`^SIMULATED, ${m.toUpperCase()} mode`)); assert.ok(BANNER[m].includes(CLAIM_LABEL)); assert.ok(BANNER[m].includes('2026-11-02')); assert.match(BANNER[m], /UNVERIFIED on our tenant/); }
  assert.match(BANNER.live, /loopback only, zero outbound network/);
});

test('every claim names its slide; the numbers are the deck\'s (13 sources, 12 delete, 9 quarantine, 46 findings, 5 levels) and the lab\'s are labelled the lab\'s', () => {
  for (const c of CLAIMS) assert.ok(Number.isInteger(c.slide) && c.claim.length > 40, c.id);
  assert.ok(CLAIMS.find((c) => c.id === 'sources').claim.includes('Thirteen sources'));
  assert.ok(CLAIMS.find((c) => c.id === 'remediation').claim.includes('twelve of thirteen'));
  assert.match(s.deckNumbers.text, /13 sources, 46 findings, 5 levels/); assert.match(s.deckNumbers.text, /its own 13 illustrative findings/);
  assert.equal(SOURCES.length, 13);
});

test('the deck discrepancies are shown, not resolved: risk scoring (slide 21 vs 45), nine vs seven, the cut-off line', () => {
  assert.deepEqual(DISCREPANCIES.map((d) => d.id), ['risk-scoring', 'nine', 'cut-off', 'naming']);
  const r = DISCREPANCIES.find((d) => d.id === 'risk-scoring').text; assert.match(r, /Slide 21/); assert.match(r, /Planned/); assert.match(r, /does not resolve/);
  assert.match(DISCREPANCIES.find((d) => d.id === 'nine').text, /names seven/);
  assert.match(DISCREPANCIES.find((d) => d.id === 'cut-off').text, /lab reading of a partly-cut-off deck line/);
});

test('slide 21 availability: GA, Roadmap (Q4 2026) and Planned items are tagged and state that no behaviour is claimed; campaigns and succession say availability not stated', () => {
  const by = (name) => AVAILABILITY.find((a) => a.capability.startsWith(name));
  for (const n of ['Platform Agent Discovery', 'Activity Collectors', 'Agent Delegated Administration']) assert.equal(by(n).availability, 'GA', n);
  for (const n of ['Shadow AI Discovery', 'Agent Lifecycle Management', 'Agent Classification', 'Custodian Management', 'Agent Events']) { assert.equal(by(n).availability, 'Roadmap (Q4 2026)', n); assert.match(by(n).lab, /No behaviour is claimed|no behaviour is claimed/i, n); }
  for (const n of ['Access Visualization', 'Risk Scoring']) assert.equal(by(n).availability, 'Planned', n);
  for (const n of ['Certification campaigns', 'Succession management']) assert.equal(by(n).availability, 'described in the deck, availability not stated', n);
  assert.equal(AVAILABILITY.length, 12);
});

test('every field source is a known kind; the nine swagger names, both private-network objects and the lab-invented marker are present', () => {
  for (const f of FIELD_SOURCES) assert.ok(Object.hasOwn(FIELD_SOURCE_NAMES, f.source), f.field);
  const all = JSON.stringify(FIELD_SOURCES);
  for (const name of ['GatewayBypassPostureJSON', 'GatewayCallerAccessJSON', 'GatewayDetailJSON', 'GatewayEnginesJSON', 'GatewayScorecardJSON', 'BypassDiffJSON', 'RuntimeCallerAccessJSON', 'TargetCallerAccessJSON', 'Truncated', 'modelPrivateNetworkTenantConfig', 'modelPrivateNetworkConfig']) assert.ok(all.includes(name), name);
  assert.ok(all.includes('lab-invented (the schema gives only the field name)'));
  assert.ok(FIELD_SOURCES.some((f) => f.source === 'swagger') && FIELD_SOURCES.some((f) => f.source === 'invented') && FIELD_SOURCES.some((f) => f.source === 'reading') && FIELD_SOURCES.some((f) => f.source === 'deck'));
  assert.deepEqual(FIELD_SOURCE_NAMES, { deck: 'deck claim', swagger: 'console swagger name (schema only)', reading: 'lab reading', invented: 'lab-invented' });
});

test('the limits text states exactly the limits the engine enforces', () => {
  const want = { 'at most 300 characters': LIMITS.reason, 'a comment 200': LIMITS.comment, 'at most 200 proposals': LIMITS.proposals, 'at most 5 open': LIMITS.openPerAgent, '500 audit entries': LIMITS.audit, '30 sync runs': LIMITS.runs, '5 campaigns': LIMITS.campaigns, '10 private-network connections': LIMITS.connections, '50 connector polls': LIMITS.polls, 'at most 20 injected failures': LIMITS.failures, 'at most 6 tags': LIMITS.tags, 'at most 40 hops': LIMITS.hops };
  for (const [text, n] of Object.entries(want)) { assert.ok(LIMITS_TEXT.includes(text.replace(/\d+/, String(n))), `${text} = ${n}`); }
});

test('the talk track has a Why it matters entry with challenge, technical and business lines marked as Ping claims; the deck text is carried unchanged', () => {
  const w = TALK_TRACK.find((t) => t.id === 'why-platform-agents');
  assert.match(w.say, /Challenge:/); assert.match(w.say, /Technical:/); assert.match(w.say, /Business:/); assert.match(w.say, /Ping claims, unverified on our tenant/);
  assert.ok(WHY.challenge.startsWith('Agents created in cloud consoles sit outside identity processes')); assert.ok(WHY.technical.includes('46-finding risk scores'));
  assert.equal(w.say, WHY_TEXT);
  for (const id of ['say-first', 'inventory', 'review', 'ownership', 'remediate', 'succession', 'sync', 'gateway', 'private']) assert.ok(TALK_TRACK.some((t) => t.id === id), id);
});

test('no shipped text says "door", names a real customer, holds a credential or a non-reserved host, in any vertical', () => {
  for (const [v, cast] of Object.entries(VERTICALS)) {
    const t = JSON.stringify(buildStory(cast, v));
    assert.ok(!/\bdoor\b/i.test(t), v); assert.deepEqual(scanHosts(t), [], v); assert.deepEqual(scanKeys(t), []); assert.equal(findCredentials(t).filter((c) => c.id !== 'long-blob').length, 0, v);
    assert.deepEqual(unfilled(t, cast), [], v);
  }
  assert.ok(NOT_DEMONSTRATED.some((n) => /46 findings/.test(n)) && NOT_DEMONSTRATED.some((n) => /Activity Collectors/.test(n)));
});

test('the story carries the catalog the page renders: 13 sources with delete and quarantine flags, 13 findings, 5 levels, scorecard checks', () => {
  assert.equal(s.sources.filter((x) => x.delete).length, 12); assert.equal(s.sources.filter((x) => x.quarantine).length, 9);
  assert.deepEqual(s.sources.filter((x) => x.quarantine && !x.quarantineNamedByDeck).map((x) => x.id).sort(), ['agentbuilder', 'aifoundry']);
  assert.equal(s.levels.length, 5); assert.equal(s.scorecardChecks.length, 12); assert.equal(s.scenarios.length, 8);
});

test('the three diagrams are diagram-studio/1 data that validate in every vertical, with one edge per step and no duplicate edge', () => {
  assert.deepEqual(DIAGRAM_NAMES, ['governance-cycle', 'safe-sync', 'private-network-discovery']);
  for (const n of DIAGRAM_NAMES) {
    assert.deepEqual(validateDiagram(loadDiagram(n)), [], n);
    for (const cast of Object.values(VERTICALS)) { const d = buildDiagram(cast, n); assert.ok(d.steps.length >= 6); assert.ok(!/\{\{/.test(JSON.stringify(d))); }
    const doc = loadDiagram(n); const keys = doc.edges.map((e) => `${e.source}>${e.target}`);
    assert.equal(new Set(keys).size, keys.length, `${n}: no two edges on the same pair and direction (their labels would overlap)`);
    assert.equal(doc.steps.length, doc.edges.length);
  }
});
