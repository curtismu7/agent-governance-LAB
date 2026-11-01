// The glue between the HTTP layer and the engine: Mock reads tables, Live drives the workspace's engine. Every action gets one W3C
// trace and a list of hops (the raw request and response panes), with anything credential-shaped masked.
import { Engine } from './engine.js';
import { perform } from './actions.js';
import { cleanFree } from './credentials.js';
import { newTrace, formatTraceparent } from './trace.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A copy of the visitor's parameters that is safe to show in the request pane: every string and every object KEY cleaned and masked (nothing is cut), numbers and
// booleans kept. Nothing is dropped silently: more than 10 list items or 20 keys, or nesting deeper than 3, is shown as a marker that says so. Two keys that mask
// to the same text get a numeric suffix. Depth-limited, so a hostile structure cannot overflow the stack.
export const SCRUB = { items: 10, keys: 20, depth: 3 };
export function scrub(value, depth = 0) {
  if (typeof value === 'string') return cleanFree(value);
  if (Array.isArray(value)) {
    if (depth > SCRUB.depth) return '[nested too deep to show]';
    const shown = value.slice(0, SCRUB.items).map((v) => scrub(v, depth + 1));
    return value.length > SCRUB.items ? [...shown, `[${value.length - SCRUB.items} more not shown]`] : shown;
  }
  if (isObj(value)) {
    if (depth > SCRUB.depth) return '[nested too deep to show]';
    const keys = Object.keys(value); const out = {}; const used = new Set();
    for (const k of keys.slice(0, SCRUB.keys)) {
      const clean = cleanFree(k); let nk = clean;
      for (let n = 2; used.has(nk); n++) nk = `${clean}~${n}`;
      used.add(nk);
      Object.defineProperty(out, nk, { value: scrub(value[k], depth + 1), enumerable: true, writable: true, configurable: true });
    }
    if (keys.length > SCRUB.keys) Object.defineProperty(out, '[more keys]', { value: `${keys.length - SCRUB.keys} more not shown`, enumerable: true, writable: true, configurable: true });
    return out;
  }
  return typeof value === 'number' || typeof value === 'boolean' || value === null ? value : undefined;
}

export function mockState(table, vertical, scenarioId) {
  const v = table.verticals[vertical];
  const sc = (typeof scenarioId === 'string' && v.scenarios.find((s) => s.id === scenarioId)) || v.scenarios[0];
  return { state: sc.state, scenario: { id: sc.id, title: sc.title, say: sc.say, steps: sc.steps }, scenarios: v.scenarios.map((s) => ({ id: s.id, title: s.title, say: s.say })) };
}

export function liveState(ws, workspaces, vertical, cast) {
  const e = workspaces.peek(ws, vertical) || new Engine(cast);
  return e.snapshot();
}

// Runs one engine action for a workspace with a trace. Returns { outcome, hops, traceparent, state }.
export function runAction({ ws, workspaces, vertical, cast, op, params, traceparent, route }) {
  const e = workspaces.engine(ws, vertical, cast);
  const t = newTrace(traceparent);
  const root = t.span();
  e.trace = { traceId: t.traceId, span: t.span }; e.hops = []; e.hopsTruncated = false;
  let outcome;
  try { outcome = perform(e, op, params); } finally { e.trace = null; }
  const first = { n: 1, label: 'browser to the lab API', request: { method: route.method, url: route.url, headers: { traceparent: formatTraceparent(t.traceId, root), 'x-workspace': ws }, body: scrub(params) }, response: { status: outcome.ok ? 200 : outcome.status, body: outcome.ok ? { ok: true } : { error: outcome.code } } };
  const hops = [first, ...e.hops.map((h, i) => ({ ...h, n: i + 2 }))];
  const truncated = e.hopsTruncated; e.hops = [];
  return { outcome, hops, hopsTruncated: truncated, traceparent: formatTraceparent(t.traceId, root), traceId: t.traceId, state: e.snapshot() };
}
