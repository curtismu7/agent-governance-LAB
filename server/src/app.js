// One Express app. /api = health, info, story, diagram, state and the action endpoints (sync, proposals, campaign, succession, private network, gateways, reset).
// Server state per workspace id (X-Workspace) is one engine per vertical, so one visitor's Reset never touches another's.
// Mock reads generated tables and refuses every write; Live drives the engine. Both are loopback-only with zero outbound calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites } from './safety.js';
import { createHealth } from './health.js';
import { loadCast, verticalFrom } from './cast.js';
import { defaultMode, modeOf } from './config.js';
import { buildStory } from './story.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';
import { InputError } from './errors.js';
import { MOCK_TABLE } from './mockTable.js';
import { createWorkspaces, workspaceFrom } from './workspaces.js';
import { liveState, mockState, runAction } from './service.js';
import { maskDeep } from './mask.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function createApp({ health = createHealth(), configFile = CONFIG, workspaces = createWorkspaces(), table = MOCK_TABLE } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  api.use(express.json({ limit: '32kb' }));
  // Defence in depth: every JSON answer is masked for credential-shaped values, whatever path produced it.
  api.use((_req, res, next) => { const send = res.json.bind(res); res.json = (b) => send(maskDeep(b)); next(); });
  api.use('/health', health.router);
  const verticalOf = (req) => verticalFrom(req.body?.vertical ?? req.query.vertical);
  const castFor = (req) => loadCast(configFile, verticalOf(req));
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  const ws = (req, res) => { const id = workspaceFrom(req); if (!id) res.status(400).json({ error: 'bad_workspace' }); return id; };
  const bodyOf = (req) => (isObj(req.body) ? req.body : {});

  api.get('/story', (req, res) => { noStore(res); res.json(buildStory(castFor(req), verticalOf(req))); });
  api.get('/diagram', (req, res) => { noStore(res); res.json(buildDiagram(castFor(req), DIAGRAM_NAMES.includes(req.query.name) ? req.query.name : DIAGRAM_NAMES[0])); });
  api.get('/info', (_req, res) => { noStore(res); res.json({ mode: defaultMode(), modes: ['mock', 'live'], simulated: true, release: '2026-11-02', unverified: true }); });

  api.get('/state', (req, res) => {
    const id = ws(req, res); if (!id) return;
    noStore(res);
    const mode = modeOf(req.query.mode); if (!mode) return res.status(400).json({ error: 'bad_mode', detail: 'mode must be mock or live' });
    const vertical = verticalOf(req);
    if (mode === 'mock') return res.json({ mode, vertical, workspace: id, ...mockState(table, vertical, req.query.scenario) });
    return res.json({ mode, vertical, workspace: id, state: liveState(id, workspaces, vertical, castFor(req)) });
  });

  // Every write: Live only, strict top-level keys, one trace, hops, and the whole fresh state back. Refusals keep their honest HTTP status.
  const write = (method, route, { op, keys, params }) => {
    api[method](route, (req, res, next) => {
      const id = ws(req, res); if (!id) return;
      noStore(res);
      try {
        if (!isObj(req.body)) return res.status(400).json({ error: 'bad_request' });
        const mode = modeOf(req.body.mode);
        if (!mode) return res.status(400).json({ error: 'bad_mode', detail: 'mode must be mock or live' });
        if (mode === 'mock') return res.status(409).json({ error: 'mock_is_read_only', detail: 'Mock mode only reads tables: switch to Live to act' });
        if (!Object.keys(req.body).every((k) => ['mode', 'vertical', ...keys].includes(k))) return res.status(400).json({ error: 'unknown_field', detail: 'the body carries a field the lab does not take' });
        const vertical = verticalOf(req);
        const r = runAction({ ws: id, workspaces, vertical, cast: castFor(req), op, params: params(req), traceparent: req.headers.traceparent, route: { method: method.toUpperCase(), url: `/api${route}` } });
        res.set('traceparent', r.traceparent);
        const common = { workspace: id, mode, vertical, hops: r.hops, hopsTruncated: r.hopsTruncated, traceId: r.traceId, state: r.state };
        if (r.outcome.ok) return res.json({ ok: true, result: r.outcome.result, ...common });
        return res.status(r.outcome.status || 400).json({ ok: false, error: r.outcome.code, detail: r.outcome.detail, ...common });
      } catch (e) { return next(e); }
    });
  };
  const idParam = (req) => (typeof req.params.id === 'string' ? req.params.id : '');
  const obj = (v) => (isObj(v) ? v : { __bad: 1 });
  write('post', '/sync', { op: 'sync', keys: ['sync'], params: (req) => (req.body.sync === undefined ? {} : obj(req.body.sync)) });
  write('post', '/proposals', { op: 'propose', keys: ['proposal'], params: (req) => obj(req.body.proposal) });
  write('post', '/proposals/:id/decision', { op: 'decide', keys: ['decision'], params: (req) => ({ ...obj(req.body.decision), proposalId: idParam(req) }) });
  write('post', '/proposals/:id/execute', { op: 'execute', keys: ['execute'], params: (req) => ({ ...obj(req.body.execute), proposalId: idParam(req) }) });
  write('post', '/campaign', { op: 'campaign', keys: ['campaign'], params: (req) => obj(req.body.campaign) });
  write('post', '/campaign/items/:id/decision', { op: 'itemDecision', keys: ['decision'], params: (req) => ({ ...obj(req.body.decision), itemId: idParam(req) }) });
  write('post', '/custodians/depart', { op: 'depart', keys: ['depart'], params: (req) => obj(req.body.depart) });
  write('post', '/provider/change', { op: 'providerChange', keys: ['change'], params: (req) => obj(req.body.change) });
  write('put', '/org/onboarding', { op: 'onboarding', keys: ['onboarding'], params: (req) => obj(req.body.onboarding) });
  write('put', '/private-network/tenant', { op: 'privateTenant', keys: ['tenant'], params: (req) => obj(req.body.tenant) });
  // The connection fields sit beside the actor in the body; the engine takes them as a nested object.
  const connParams = (req, extra = {}) => { const b = obj(req.body.connection); const { actor, ...fields } = b; return { actor, connection: fields, ...extra }; };
  write('post', '/private-network/connections', { op: 'addConnection', keys: ['connection'], params: (req) => connParams(req) });
  write('put', '/private-network/connections/:id', { op: 'updateConnection', keys: ['connection'], params: (req) => connParams(req, { connectionId: idParam(req) }) });
  write('post', '/private-network/connector/poll', { op: 'poll', keys: ['poll'], params: (req) => obj(req.body.poll) });
  write('post', '/gateways/:id/actions', { op: 'gateway', keys: ['action'], params: (req) => ({ gatewayId: idParam(req), action: obj(req.body.action) }) });

  // Reset clears this workspace's engines (requests, grants, receipts, platform state, outbox, audit, the clock) and nothing else.
  api.post('/reset', (req, res) => { const id = ws(req, res); if (!id) return; noStore(res); workspaces.reset(id); return res.json({ reset: 'ok', workspace: id }); });
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);
  // Errors become short JSON. Express's default handler would send an HTML stack trace with absolute file paths.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode);
    if (err instanceof InputError) return res.status(err.status).json({ error: err.code });
    if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
    return res.status(500).json({ error: 'internal_error' });
  });

  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
