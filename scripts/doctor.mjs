// Preflight: the same checks GET /api/health reports from, plus whether the port is free, plus one real run of the engine through the HTTP API
// (a sync, a proposal, an approval and its execution) on a throwaway port. Prints only pass/fail lines, never a setting's value. Exit 1 on failure.
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(path.join(root, p)));
const { installNetguard } = await load('server/src/netguard.js');
installNetguard();
const { applySharedSettings } = await load('server/src/settings.js');
applySharedSettings();

const { runChecks } = await load('server/src/doctor.js');
let failed = 0;
const report = (level, name, detail) => { if (level === 'fail') failed++; console.log(`${level.toUpperCase().padEnd(4)}  ${name}: ${detail}`); };
for (const c of await runChecks()) report(c.level, c.id, c.detail);

// A real cycle through the HTTP layer, in this process, on an ephemeral loopback port: sync, propose, refuse self-approval, approve, execute.
try {
  const { createApp, startHttpServer } = await load('server/src/app.js');
  const { createHealth } = await load('server/src/health.js');
  const health = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health }) });
  try {
    const base = url.replace(/\/$/, ''); const h = { 'content-type': 'application/json', origin: base, 'x-workspace': 'doctor' };
    const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify({ mode: 'live', vertical: 'finance', ...b }) }); return { status: r.status, body: await r.json() }; };
    const cast = (await (await fetch(`${base}/api/story?vertical=finance`)).json()).cast;
    const sync = await post('/api/sync', { sync: { failures: [{ source: 'vertexai', kind: 'timeout' }] } });
    const prop = await post('/api/proposals', { proposal: { actor: cast.castCustodian, agentId: 'ag-bedrock-02', kind: 'quarantine' } });
    const id = prop.body.result.proposalId;
    const self = await post(`/api/proposals/${id}/decision`, { decision: { actor: cast.castCustodian, decision: 'approve' } });
    const ok = await post(`/api/proposals/${id}/decision`, { decision: { actor: cast.castAdmin, decision: 'approve' } });
    const run = await post(`/api/proposals/${id}/execute`, { execute: { actor: cast.castAdmin } });
    const good = sync.body.result.outcome === 'partial' && self.status === 403 && self.body.error === 'admin_only' && ok.body.ok && run.body.ok && run.body.state.agents.find((a) => a.id === 'ag-bedrock-02').quarantined;
    report(good ? 'pass' : 'fail', 'engine-cycle', good ? 'a partial sync (one provider injected as silent), a proposal, a refused approval by a custodian, an administrator approval and the execute all behaved over the HTTP API' : 'the sync, propose, approve, execute cycle did not complete');
  } finally { health.stop(); await new Promise((res) => server.close(res)); }
} catch { report('fail', 'engine-cycle', 'the HTTP cycle could not run'); }

const port = Number(process.env.PORT) || 7300;
await new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', (e) => { report('fail', 'port-free', `${port} is not free (${e.code}). Set PORT to a free port in 7300-7349`); resolve(); });
  s.listen(port, '127.0.0.1', () => s.close(() => { report('pass', 'port-free', `${port} is free`); resolve(); }));
});
process.exit(failed ? 1 : 0);
