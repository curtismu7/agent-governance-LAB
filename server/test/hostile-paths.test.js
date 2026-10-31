// A credential typed into a URL path or a workspace id must never come back, whatever the method, whether or not the web build exists, and whatever the answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rawHttp, withServer, get, post, A } from './helpers.js';
import { SECRETS, NEEDLE } from './secrets.js';
import { createWorkspaces } from '../src/workspaces.js';

const PATHS = (v) => [`/${v}`, `/api/${v}`, `/api/proposals/${v}/decision`, `/api/gateways/${v}/actions`, `/${v}/x/${v}`, `/static/${v}.js`];
const FULL = new Set(['github', 'aws', 'jwt', 'userinfo', 'hex40', 'skShort']); // every method for these; GET and POST for the rest
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

async function sweep(url) {
  const host = new URL(url).host;
  let n = 0;
  for (const [name, v] of Object.entries(SECRETS)) {
    if (/\s|\n|[?#]|[\u0000-\u001f\u007f-￿]/.test(v)) continue; // a path segment cannot carry a space, a newline, a query separator or a raw control character
    const seg = encodeURIComponent(v);
    for (const method of FULL.has(name) ? METHODS : ['GET', 'POST']) for (const p of PATHS(seg)) {
      const r = await rawHttp(`${url}${p}`, { method, headers: { host, origin: url, 'content-type': 'application/json' }, body: ['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined });
      n += 1;
      assert.ok(!r.text.includes(NEEDLE[name]) && !r.text.includes(seg.slice(4, 16)), `${name} ${method} ${p.slice(0, 30)}: the path came back: ${r.text.slice(0, 80)}`);
      assert.ok(!/Cannot (GET|POST|PUT|DELETE|PATCH)|<pre>|node_modules|\bat \S+ \(file:/.test(r.text), `${name} ${method}: a default Express page: ${r.text.slice(0, 80)}`);
    }
  }
  assert.ok(n > 300, `${n} requests swept`);
}

test('no method on any token-shaped path echoes it, with the web build present (the fallback serves the page, everything else is JSON)', async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'agl-dist-')); fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>x</title>');
  try { await withServer(sweep, { webDist: dist }); } finally { fs.rmSync(dist, { recursive: true, force: true }); }
});

test('...and with no web build at all (a fresh clone before npm run build)', async () => {
  await withServer(sweep, { webDist: '/nonexistent/dist' });
});

test('the reviewer\'s repro: POST /<token> answers fixed JSON without the path, for every method', async () => {
  await withServer(async (url) => {
    const host = new URL(url).host; const tok = ['gh', 'p_Zk3Qw9Lm2Xv8Rt5Yp1Nb7Hc4Jd6Fa0Sg'].join('');
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) { const r = await rawHttp(`${url}/${tok}`, { method: m, headers: { host, origin: url } }); assert.equal(r.status, 404); assert.deepEqual(JSON.parse(r.text), { error: 'not_found' }, m); }
  }, { webDist: '/nonexistent/dist' });
});

test('a non-API path answers fixed JSON 404 for every method but GET (GET serves the page when it exists)', async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'agl-dist-')); fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>x</title>');
  try {
    await withServer(async (url) => {
      const host = new URL(url).host;
      for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) { const r = await rawHttp(`${url}/anything/at/all`, { method: m, headers: { host, origin: url } }); assert.equal(r.status, 404); assert.deepEqual(JSON.parse(r.text), { error: 'not_found' }, m); }
      assert.equal((await rawHttp(`${url}/anything`, { headers: { host } })).status, 200);
    }, { webDist: dist });
  } finally { fs.rmSync(dist, { recursive: true, force: true }); }
  await withServer(async (url) => { const r = await rawHttp(`${url}/anything`, { headers: { host: new URL(url).host } }); assert.equal(r.status, 404); assert.deepEqual(JSON.parse(r.text), { error: 'not_found' }); }, { webDist: '/nonexistent/dist' });
});

test('a workspace id that looks like a credential is refused, never echoed in the answer or in a hop header; the ids the page makes still work', async () => {
  await withServer(async (url) => {
    const hex40 = 'a3f9c2e17b4d58a6f0c1e9d27b3a45c8e6f1d097';
    for (const id of [hex40, hex40.slice(0, 32), ['glpat', '-abcdefghijklmnop1234'].join(''), ['sk', '-abcdefghijklmnop1234'].join('')]) {
      const r = await get(url, '/api/state?mode=live', { 'x-workspace': id }); const t = await r.text();
      assert.equal(r.status, 400, id); assert.ok(!t.includes(id.slice(0, 20)), id);
      const w = await post(url, '/api/sync', { mode: 'live', vertical: 'finance' }, { 'x-workspace': id });
      assert.equal(w.status, 400); assert.ok(!(await w.text()).includes(id.slice(0, 20)));
    }
    for (const id of ['w-0123456789abcdef', 'default', 'ws-a', 'parity-0']) {
      const r = await post(url, '/api/sync', { mode: 'live', vertical: 'finance' }, { 'x-workspace': id });
      assert.equal(r.status, 200, id); const b = await r.json(); assert.equal(b.workspace, id); assert.equal(b.hops[0].request.headers['x-workspace'], id);
    }
  });
});

test('the cap on workspaces REFUSES a new one (429) and evicts nothing: a flood of made-up ids cannot push out another visitor\'s lab', async () => {
  const workspaces = createWorkspaces({ max: 3 });
  await withServer(async (url) => {
    for (const id of ['one', 'two', 'three']) assert.equal((await post(url, '/api/sync', { mode: 'live', vertical: 'finance' }, { 'x-workspace': id })).status, 200);
    const r = await post(url, '/api/sync', { mode: 'live', vertical: 'finance' }, { 'x-workspace': 'four' });
    assert.equal(r.status, 429); assert.equal((await r.json()).error, 'too_many_workspaces');
    assert.equal(workspaces.size(), 3); assert.ok(workspaces.peek('one', 'finance'), 'the oldest workspace is still there');
    assert.equal((await post(url, '/api/sync', { mode: 'live', vertical: 'finance' }, { 'x-workspace': 'one' })).status, 200, 'an existing workspace keeps working');
    assert.equal(A.length > 0, true);
  }, { workspaces });
});
