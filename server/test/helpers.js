import http from 'node:http';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createWorkspaces } from '../src/workspaces.js';
import { Engine } from '../src/engine.js';
import { VERTICALS } from '../src/cast.js';

export const C = VERTICALS.finance;
export const newEngine = (cast = C) => new Engine(cast);

export async function withServer(fn, { configFile = '/nonexistent/customer.config.json', workspaces = createWorkspaces(), webDist, env, proxyHosts } = {}) {
  const health = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, configFile, workspaces, ...(webDist ? { webDist } : {}), ...(env ? { env } : {}), ...(proxyHosts ? { proxyHosts } : {}) }) });
  try { await fn(url.replace(/\/$/, ''), { workspaces }); } finally { health.stop(); await new Promise((res) => server.close(res)); }
}

export const post = (url, path, body, headers = {}) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, ...headers }, body: JSON.stringify(body) });
export const put = (url, path, body, headers = {}) => fetch(`${url}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: url, ...headers }, body: JSON.stringify(body) });
export const get = (url, path, headers = {}) => fetch(`${url}${path}`, { headers });
export const json = async (res) => res.json();

// fetch cannot set Host; node:http can.
export function rawHttp(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, agent: false }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

export const W = (id) => ({ 'x-workspace': id });
export const live = (extra = {}) => ({ mode: 'live', vertical: 'finance', ...extra });

// People and agents the engine tests use (finance pack). K is the custodian of ag-bedrock-01 and ag-bedrock-02; K2 of ag-agentcore-01; K3 of ag-lex-02.
export const A = C.castAdmin; export const A2 = C.castAdmin2; export const K = C.castCustodian; export const K2 = C.castCustodian2; export const K3 = C.castCustodian3; export const O = C.castOutsider;
export const codeOf = (fn) => { try { fn(); return null; } catch (e) { if (e.code) return e.code; throw e; } };
export const prop = (e, who, agentId, kind, params = {}, extra = {}) => e.propose({ actor: who, agentId, kind, params, ...extra });
export const approve = (e, who, proposalId) => e.decide({ actor: who, proposalId, decision: 'approve' });
export const deny = (e, who, proposalId) => e.decide({ actor: who, proposalId, decision: 'deny' });
export const exec = (e, who, proposalId) => e.execute({ actor: who, proposalId });
// propose, approve by the other administrator, execute: returns the proposal id.
// An administrator's own action runs at once; a custodian's is approved by an administrator and then executed.
export function remediate(e, who, agentId, kind, params = {}) {
  const p = prop(e, who, agentId, kind, params);
  if (p.status === 'executed') return p.proposalId;
  approve(e, A, p.proposalId); exec(e, who, p.proposalId);
  return p.proposalId;
}
// Discover everything: the second scan, both OUs, a private-network connection.
export function discoverAll(e) {
  e.sync({}); e.setOnboarding({ actor: A, ous: ['ou-lab-prod', 'ou-lab-sandbox'] });
  e.setPrivateTenant({ actor: A, enabled: true });
  e.addConnection({ actor: A, connection: { name: 'c', sources: ['bedrock', 'agentcore', 'lex'], scopeIds: ['000000000002'], enabled: true, scannerId: 's1', scannerRunsIn: { kind: 'aws-account', id: '000000000009' } } });
  return e.sync({});
}
export const agentOf = (e, id) => e.snapshot().agents.find((a) => a.id === id);

// HTTP-level helpers: one live write.
export async function api(url, method, path, body, ws = 'default', headers = {}) {
  const f = method === 'PUT' ? put : post;
  const r = await f(url, path, { mode: 'live', vertical: 'finance', ...body }, { 'x-workspace': ws, ...headers });
  return { status: r.status, body: await r.json() };
}
