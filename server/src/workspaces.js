// Rule 13: a workspace id keeps one visitor's state apart from another's. Server state per workspace is one access Engine per vertical
// (requests, grants, receipts, the platforms' own state, the audit trail, the outbox and the lab clock). Bounded in count (new workspaces are refused at the cap, nothing is evicted) and age (idle for an hour).
// The browser sends its id in X-Workspace (default "default"). Reset clears the current workspace only.
import { Engine } from './engine.js';
import { looksLikeCredential } from './credentials.js';
import { refuse } from './errors.js';

export const WORKSPACE_RE = /^[a-z0-9-]{1,40}$/;
export const DEFAULT_WORKSPACE = 'default';

// An id is lowercase letters, digits and hyphens, 1 to 40. It is echoed in the `workspace` field and in the hop headers, so it must not become a place to park a
// secret: an id is refused (400 bad_workspace, never echoed) when it holds 24 or more hex characters in a row (a hash or key), when a hyphen-separated part names a
// credential or starts a token (sk-..., pw-..., ghp-..., token-..., password-...), when it starts like a JWT, or when the credential detectors find something in it.
// The page makes a new id and asks again (web/src/workspace.js applies the same rule to a saved id; a test compares the two on a table of ids).
const CREDENTIAL_PARTS = new Set(['sk', 'pk', 'rk', 'pw', 'pwd', 'pass', 'passwd', 'password', 'passphrase', 'secret', 'token', 'apikey', 'bearer', 'glpat', 'ghp', 'gho', 'ghu', 'ghs', 'xoxa', 'xoxb', 'xoxp', 'xoxr', 'xoxs', 'akia', 'asia']);
export function validWorkspaceId(raw) {
  if (typeof raw !== 'string' || !WORKSPACE_RE.test(raw)) return false;
  if (/[0-9a-f]{24,}/.test(raw) || raw.startsWith('eyj')) return false;
  if (raw.split('-').some((part) => CREDENTIAL_PARTS.has(part))) return false;
  return !looksLikeCredential(raw);
}

export function workspaceFrom(req) {
  const raw = req.headers['x-workspace'];
  if (raw === undefined) return DEFAULT_WORKSPACE;
  return validWorkspaceId(raw) ? raw : null;
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
