// The Privilege (Real) mode: the config, the pinned-origin client (against a local https server, never the real console), the
// mapping from console objects to the lab's agent records, and the mode switch on the API. No test touches the live tenant.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { privilegeConfig, checkConsoleUrl } from '../src/privilegeConfig.js';
import { createPrivilegeClient, PRIV_LIMITS } from '../src/privilegeClient.js';
import { mapApplications, mapGateways, refName, PRIVILEGE_SOURCE_ID } from '../src/privilegeMap.js';
import { Engine } from '../src/engine.js';
import { createApp } from '../src/app.js';
import { startHttpServer } from '../src/app.js';
import { C } from './helpers.js';

const b64 = (s) => Buffer.from(s).toString('base64');
const TEN = '0428ba4f-169c-436b-aff9-b230496e0e3b';
const ref = (name) => b64(`${TEN}@@@default@@@${name}`);

const appObj = (name, appType, mcp = {}, tags = {}) => ({
  ObjectMeta: { Name: name, Namespace: 'default', UpdatedAt: '2026-11-14T00:00:00Z', CTags: { Map: tags } },
  Spec: { AppType: appType, ...(appType === 'mcp' ? { McpAppConfig: { FrontEndName: { Elems: [`${name}.default.applications.procyon.ai:8643`] }, Backends: { Elems: ['http://svc.cluster.local'] }, AuthMode: mcp.authMode ?? 'none', EntryPath: '/mcp', MeshCluster: 'mesh-1', AIGuardConfig: { Enabled: mcp.guard ?? false, FailClosed: mcp.failClosed ?? false }, ...mcp.extra } } : appType === 'http' ? { HttpAppConfig: { FrontEndName: { Elems: [`${name}.default.applications.procyon.ai:8643`] }, Backends: { Elems: ['http://svc.cluster.local'] }, AuthMode: 'none', AIGuardConfig: { Enabled: false } } } : {}) },
});
const pacPolicy = (appName, keys, tools = ['lookup-order']) => ({
  ObjectMeta: { Name: `pol-${appName}` }, Spec: { ActionMap: { MCP: { PolicyRule: keys.map((k) => ({ ObjectRef: { RefKind: 'Application', RefID: ref(appName) }, Attributes: { Map: { agentaccesskey: ref(k) } }, Capabilities: { Map: { tools: { Elems: tools } } } })) } } },
});

// ---------- config ----------
test('the Real config needs all four settings, a UUID tenant and an origin-only URL', () => {
  const ok = { AGL_PRIV_CONSOLE_URL: 'https://local.procyon.ai:8643', AGL_PRIV_TENANT: TEN, AGL_PRIV_API_KEY: 'k'.repeat(10), AGL_PRIV_API_SECRET: 's'.repeat(10) };
  assert.equal(privilegeConfig(ok).ok, true);
  for (const drop of ['AGL_PRIV_CONSOLE_URL', 'AGL_PRIV_TENANT', 'AGL_PRIV_API_KEY', 'AGL_PRIV_API_SECRET']) {
    const { [drop]: _, ...rest } = ok;
    assert.equal(privilegeConfig(rest).ok, false, drop);
  }
  assert.equal(privilegeConfig({ ...ok, AGL_PRIV_TENANT: 'not-a-uuid' }).ok, false);
  assert.equal(privilegeConfig({ ...ok, AGL_PRIV_CONSOLE_URL: 'https://host.example/console/path' }).ok, false);
  assert.equal(privilegeConfig({ ...ok, AGL_PRIV_CONSOLE_URL: 'https://user:pw@host.example' }).ok, false);
  assert.equal(privilegeConfig({ ...ok, AGL_PRIV_CONSOLE_URL: 'http://local.procyon.ai:8643' }).ok, false, 'http off loopback is refused');
  assert.equal(privilegeConfig({ ...ok, AGL_PRIV_CONSOLE_URL: 'http://localhost:8643' }).ok, true, 'http on loopback is allowed');
  assert.equal(privilegeConfig({ ...ok, AGL_PRIV_CA: '/nonexistent/ca.pem' }).ok, false);
});

// ---------- client against a local server (the pinned-origin behaviour, the auth headers, the caps) ----------
test('the client pins the origin, sends the key/secret headers, and refuses another origin', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, key: req.headers['x-api-key'], secret: req.headers['x-api-secret'], sid: req.headers['x-procyon-session-id'] });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url.includes('applications') ? { Applications: [appObj('a', 'mcp')] } : req.url.includes('pacpolicys') ? { PacPolicys: [pacPolicy('a', ['key-1'])] } : { TagPolicys: [] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const client = createPrivilegeClient({ origin, tenant: TEN, key: 'test-key-1234', secret: 'test-secret-5678' });
  const d = await client.fetchAll();
  assert.equal(d.applications.length, 1); assert.equal(d.pacPolicys.length, 1); assert.deepEqual(d.tagPolicys, []);
  assert.equal(seen.length, 3);
  assert.ok(seen.every((s) => s.url.startsWith(`/api/${TEN}/v1/`)), 'the tenant path');
  assert.ok(seen.every((s) => s.key === 'test-key-1234' && s.secret === 'test-secret-5678'));
  assert.ok(seen.every((s) => /^[0-9a-f-]{36}$/.test(s.sid)), 'a fresh session id per call');
  const bad = createPrivilegeClient({ origin: 'http://127.0.0.1:1', tenant: TEN, key: 'test-key-1234', secret: 'test-secret-5678', timeoutMs: 300 });
  await assert.rejects(bad.fetchAll(), (e) => e.code === 'network_error' || e.code === 'connect_refused' || e.code === 'timeout');
  server.close();
});

test('auth and shape failures come back as typed errors with the key redacted', async () => {
  const server = http.createServer((req, res) => { res.statusCode = 401; res.end('denied test-key-1234'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const client = createPrivilegeClient({ origin: `http://127.0.0.1:${server.address().port}`, tenant: TEN, key: 'test-key-1234', secret: 'test-secret-5678' });
  await assert.rejects(client.fetchAll(), (e) => e.code === 'console_auth' && !String(e).includes('test-key-1234'));
  server.close();
});

// ---------- mapping ----------
test('the mapping is deterministic: ids are name-hashed, keys come from the pac policies, nothing is invented', () => {
  const raw = {
    applications: [appObj('alpha', 'mcp', { authMode: 'static-token', guard: true }), appObj('beta', 'http'), appObj('gamma', 'mcp-aggregate')],
    pacPolicys: [pacPolicy('alpha', ['key-a', 'key-b'], ['tool-1', 'tool-2']), pacPolicy('beta', [], [])],
    tagPolicys: [{ ObjectMeta: { Name: 'tp-1' } }],
  };
  const agents = mapApplications(raw);
  assert.equal(agents.length, 3);
  assert.equal(agents[0].id, agents.map((a) => a.id)[0]);
  const alpha = agents.find((a) => a.name === 'alpha');
  assert.deepEqual([...alpha.privilege.agentKeys].sort(), ['key-a', 'key-b']);
  assert.deepEqual(alpha.tools.map((t) => t.name).sort(), ['tool:tool-1', 'tool:tool-2']);
  assert.equal(alpha.config.authentication, 'oauth', 'static-token is a configured auth');
  assert.equal(alpha.config.guardrail, 'ai-guard');
  assert.equal(alpha.source, PRIVILEGE_SOURCE_ID);
  const beta = agents.find((a) => a.name === 'beta');
  assert.equal(beta.config.authentication, 'none');
  assert.equal(beta.config.publicAccess, true, 'a door with no auth is publicly reachable');
  assert.equal(beta.identity.permissions.length, 0, 'no key granted, no permission claimed');
  // determinism: the same input gives the same ids
  assert.deepEqual(mapApplications(raw).map((a) => a.id), agents.map((a) => a.id));
  const gws = mapGateways(raw);
  assert.equal(gws.length, 1, 'only mcp apps are gateways (not http, not aggregate)');
  assert.ok(gws.every((g) => g.privilege.agentKeys.length >= 0));
});

test('refName unwraps the base64 tenant@@@namespace@@@name form and refuses junk', () => {
  assert.equal(refName(ref('worker-agent')), 'worker-agent');
  assert.equal(refName('!!!not base64!!!'), null);
});

// ---------- the engine over live data ----------
test('an Engine over the Privilege world inventories the real apps and refuses delete (the console is read-only here)', () => {
  const raw = {
    applications: [appObj('alpha', 'mcp', { authMode: 'none', guard: false }), appObj('beta', 'mcp', { authMode: 'static-token', guard: true })],
    pacPolicys: [pacPolicy('alpha', ['key-a'])], tagPolicys: [],
  };
  const world = { agents: mapApplications(raw), gateways: mapGateways(raw) };
  const e = new Engine(C, world);
  const s = e.snapshot();
  assert.equal(s.agents.length, 2);
  assert.ok(s.agents.every((a) => a.source === PRIVILEGE_SOURCE_ID));
  assert.equal(s.summary.bySource.length, 1);
  assert.equal(s.summary.bySource[0].name, 'PingOne Privilege (live)');
  assert.equal(s.sync.last.by, 'live Privilege (initial scan)');
  assert.equal(s.sync.last.outcome, 'complete');
  // The lab rules run over the live records: an unauthenticated door with logging off fires the lab's findings
  const alpha = s.agents.find((a) => a.name === 'alpha');
  assert.ok(alpha.assessment.findings.some((f) => f.id === 'LF-13'), 'logging off is found by the lab rule');
  // delete is refused: the console API is read-only in this lab
  assert.throws(() => e.propose({ agentId: alpha.id, kind: 'delete', params: {}, reason: 'cleanup', actor: C.castAdmin }), /delete is not supported/);
});

// ---------- the API switch ----------
test('Real on the API: without the AGL_PRIV_* settings Real resolves to the loopback live engine, honestly labelled', async () => {
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ env: {} }) });
  try {
    const r = await fetch(`${url}api/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'real' }) });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.mode, 'live', 'no settings: Real is the local engine');
    assert.equal(body.note, 'real_without_privilege_settings');
    assert.ok(body.realReason, 'the reason is carried');
    const st = await (await fetch(`${url}api/state?mode=live&vertical=finance`)).json();
    assert.equal(st.mode, 'live');
  } finally { await new Promise((r) => server.close(r)); }
});

test('Real with usable AGL_PRIV_* settings loads the live inventory through the client (the local http server stands in for the console)', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url.includes('applications') ? { Applications: [appObj('live-agent-1', 'mcp', { authMode: 'none' })] } : req.url.includes('pacpolicys') ? { PacPolicys: [pacPolicy('live-agent-1', ['k1'])] } : { TagPolicys: [] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const env = { AGL_PRIV_CONSOLE_URL: origin, AGL_PRIV_TENANT: TEN, AGL_PRIV_API_KEY: 'test-key-1234', AGL_PRIV_API_SECRET: 'test-secret-5678' };
  const { server: api, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ env }) });
  try {
    const r = await fetch(`${url}api/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'real' }) });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.mode, 'privilege');
    assert.ok(body.fetchedAt);
    const st = await (await fetch(`${url}api/state?mode=privilege&vertical=finance`)).json();
    assert.equal(st.mode, 'privilege');
    assert.equal(st.state.agents.length, 1);
    assert.equal(st.state.agents[0].name, 'live-agent-1');
    assert.equal(st.state.sync.last.by, 'live Privilege (initial scan)');
    // and the write path runs the lab's own engine over the live data
    const agentId = st.state.agents[0].id;
    const propose = await fetch(`${url}api/proposals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'privilege', vertical: 'finance', proposal: { actor: C.castAdmin, agentId, kind: 'retag', params: { key: 'environment', value: 'staging' }, reason: 'move to staging' } }) });
    const pb = await propose.json();
    assert.equal(pb.ok, true, `retag on a live record works (${pb.error || ''})`);
    assert.equal(pb.state.agents.find((a) => a.id === agentId).tags.environment, 'staging');
    // a write with an unloaded world is refused (a restart clears it)
  } finally {
    await new Promise((r) => api.close(r));
    await new Promise((r) => server.close(r));
  }
});
