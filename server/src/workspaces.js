// Rule 13: a workspace id keeps one visitor's state apart from another's. Server state per workspace is one access Engine per vertical
// (requests, grants, receipts, the platforms' own state, the audit trail, the outbox and the lab clock). Bounded in count (new workspaces are refused at the cap, nothing is evicted) and age (idle for an hour).
// The browser sends its id in X-Workspace (default "default"). Reset clears the current workspace only.
import { Engine } from './engine.js';
import { findCredentials } from './credentials.js';
import { refuse } from './errors.js';

export const WORKSPACE_RE = /^[a-z0-9-]{1,40}$/;
export const DEFAULT_WORKSPACE = 'default';

export function workspaceFrom(req) {
  const raw = req.headers['x-workspace'];
  if (raw === undefined) return DEFAULT_WORKSPACE;
  // An id that looks like a credential (a 40-hex token, a long mixed run) is refused rather than echoed back in the `workspace` field and the hop headers.
  return typeof raw === 'string' && WORKSPACE_RE.test(raw) && findCredentials(raw).length === 0 ? raw : null;
}

export function createWorkspaces({ max = 500, ttlMs = 60 * 60 * 1000, now = Date.now } = {}) {
  const map = new Map(); // id -> { engines: Map(vertical -> Engine), at }; insertion order = oldest first
  const sweep = () => {
    const t = now();
    for (const [id, v] of map) { if (t - v.at > ttlMs) map.delete(id); else break; }
  };
  // A new workspace is REFUSED at the cap (an old one is dropped only when it has been idle for the whole ttl): a flood of made-up ids cannot evict another visitor's lab.
  const touch = (id) => {
    sweep();
    if (!map.has(id) && map.size >= max) throw refuse('too_many_workspaces', 'too many workspaces are active; an idle one expires after an hour', 429);
    const v = map.get(id) || { engines: new Map(), at: 0 }; v.at = now(); map.delete(id); map.set(id, v); return v;
  };
  return {
    // The engine for this workspace and vertical, created on first use with the cast of that moment.
    engine(id, vertical, cast) {
      const v = touch(id);
      if (!v.engines.has(vertical)) v.engines.set(vertical, new Engine(cast));
      return v.engines.get(vertical);
    },
    // Read-only look: the engine if the workspace has one, else null (nothing is created).
    peek(id, vertical) { sweep(); return map.get(id)?.engines.get(vertical) || null; },
    reset(id) { map.delete(id); },
    size() { return map.size; },
  };
}
