// Preflight checks shared by `npm run doctor` and GET /api/health. Never prints a secret, needs no network.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import fs from 'node:fs';
import { assertBindAllowed, bindHost, portProblem, scanHosts, scanKeys, DEFAULT_PORT, PORT_MIN, PORT_MAX } from './safety.js';
import { netguardSelfTest } from './netguard.js';
import { VERTICALS, unfilled } from './cast.js';
import { buildStory, rawStory } from './story.js';
import { Engine } from './engine.js';
import { EXPECTED, buildMockTable, runScenario, scenarioList } from './scenarios.js';
import { SOURCES, SOURCE } from './catalog.js';
import { FINDINGS } from './findings.js';
import { findCredentials } from './credentials.js';
import { maskDeep } from './mask.js';
import { modeFrom } from './config.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';
import { MOCK_TABLE } from './mockTable.js';
import { settingsPath } from './settings.js';

export const settingsFile = (env = process.env) => (env.STANDALONE_ENV ? env.STANDALONE_ENV : settingsPath(env));

export async function runChecks({ env = process.env, table = MOCK_TABLE } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 26 ? 'pass' : 'fail', `v${process.versions.node} (need >= 26)`);

  try { add('mode', 'pass', `${modeFrom(env)} is the opening mode (mock is the default); the header toggle switches between mock and live, both loopback-only`); }
  catch (e) { add('mode', 'fail', e.message); }

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.AGLAB_BIND ? ' (AGLAB_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  add('port-range', problem ? 'fail' : 'pass', problem || `${port} is inside ${PORT_MIN}-${PORT_MAX} and not reserved`);

  const file = settingsFile(env);
  try { const m = fs.statSync(file).mode & 0o777; add('settings-file', m & 0o077 ? 'info' : 'pass', m & 0o077 ? 'the shared settings file is readable by others: chmod 600 it' : 'the shared settings file exists and is mode 600 (values are never printed)'); }
  catch { add('settings-file', 'info', 'no shared settings file: mock mode needs none'); }

  const nSources = Object.keys(SOURCE).length;
  const del = SOURCES.filter((x) => x.delete).length; const quar = SOURCES.filter((x) => x.quarantine).length;
  add('catalog', nSources === 13 && del === 12 && quar === 9 && SOURCES.every((x) => x.type) ? 'pass' : 'fail', `${nSources} sources, delete on ${del}, quarantine on ${quar} (the deck says 13, 12 and 9)`);
  add('findings', FINDINGS.length >= 12 && new Set(FINDINGS.map((f) => f.id)).size === FINDINGS.length ? 'pass' : 'fail', `${FINDINGS.length} lab-written findings (the deck's 46 are Ping's, not claimed)`);

  // Each scripted step gives the result the story says it does, in every vertical, and the Mock table agrees with the engine.
  const wrong = [];
  for (const [vertical, cast] of Object.entries(VERTICALS)) {
    for (const sc of scenarioList(cast)) {
      const { steps } = runScenario(cast, sc);
      const got = steps.map((s) => (s.result.ok ? 'ok' : s.result.code));
      if (got.join() !== EXPECTED[sc.id].join()) wrong.push(`${vertical}/${sc.id}`);
    }
  }
  add('scenarios', wrong.length ? 'fail' : 'pass', wrong.length ? `scripted steps that do not give their expected result: ${wrong.slice(0, 6).join(', ')}` : `${Object.keys(EXPECTED).length} scripted scenarios give their expected results in ${Object.keys(VERTICALS).length} verticals`);

  const fresh = buildMockTable();
  add('mock-table', JSON.stringify(fresh) === JSON.stringify(table) ? 'pass' : 'fail', JSON.stringify(fresh) === JSON.stringify(table) ? 'the mock table matches the engine' : 'the mock table drifts from the engine (run npm run mock-table)');

  // A live cycle on a throwaway engine: propose, self-approval refused, approve, execute, audit.
  const e = new Engine(VERTICALS.finance);
  const c = e.cast;
  const p = e.propose({ actor: c.castCustodian, agentId: 'ag-bedrock-02', kind: 'quarantine' });
  let selfRefused = false;
  try { e.decide({ actor: c.castCustodian, proposalId: p.proposalId, decision: 'approve' }); } catch { selfRefused = true; }
  e.decide({ actor: c.castAdmin, proposalId: p.proposalId, decision: 'approve' }); e.execute({ actor: c.castAdmin, proposalId: p.proposalId });
  const snap = e.snapshot(); const a = snap.agents.find((x) => x.id === 'ag-bedrock-02');
  const cycleOk = selfRefused && a.quarantined && !a.assessment.findings.some((f) => f.id === 'LF-01') && snap.audit.some((x) => x.kind === 'proposal.executed' && x.actor === c.castAdmin);
  add('approval-cycle', cycleOk ? 'pass' : 'fail', cycleOk ? 'a custodian proposal needed an administrator, self-approval was refused, the quarantine ran and the audit log names the actor (computed now)' : 'the propose, approve, execute cycle did not behave');

  const raw = rawStory();
  const text = JSON.stringify(raw);
  const holes = unfilled(text, VERTICALS.finance);
  add('story-tokens', holes.length ? 'fail' : 'pass', holes.length ? `unfilled {{tokens}}: ${[...new Set(holes)].join(', ')}` : 'every {{cast}} token is filled');
  const badVert = Object.entries(VERTICALS).filter(([, v2]) => unfilled(text, v2).length).map(([k]) => k);
  add('verticals', badVert.length ? 'fail' : 'pass', badVert.length ? `verticals missing a token: ${badVert.join(', ')}` : `${Object.keys(VERTICALS).length} vertical packs fill every token`);
  const filled = JSON.stringify(Object.keys(VERTICALS).map((k) => buildStory(VERTICALS[k], k)));
  const hosts = scanHosts(filled);
  add('story-hosts', hosts.length ? 'fail' : 'pass', hosts.length ? `non-reserved hosts: ${hosts.join(', ')}` : 'every host in the story data is .invalid or .example');
  const keys = scanKeys(filled);
  const creds = findCredentials(filled);
  add('story-keys', keys.length || creds.length ? 'fail' : 'pass', keys.length || creds.length ? 'credential-shaped text in the story data' : 'no credential-shaped value anywhere in the story data');
  const story = buildStory(VERTICALS.finance, 'finance');
  add('masking', JSON.stringify(maskDeep(story)) === JSON.stringify(story) ? 'pass' : 'fail', 'the response mask leaves the story untouched (it only changes credential-shaped values)');
  add('diagrams', DIAGRAM_NAMES.every((n) => buildDiagram(VERTICALS.finance, n).steps.length > 0) ? 'pass' : 'fail', `${DIAGRAM_NAMES.length} diagram-studio/1 diagrams load and validate`);

  const ng = await netguardSelfTest();
  add('netguard', ng.ok ? 'pass' : 'fail', ng.ok ? `blocked fetch, socket, socket-by-IP, dns lookup, dns resolve and udp to a non-loopback host (${ng.blocked}/6)` : ng.detail);

  add('tenant', 'pass', 'simulated only: no tenant, no credentials, no outbound network; every product claim is UNVERIFIED on our tenant');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
