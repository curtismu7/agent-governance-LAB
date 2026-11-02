// Rule 13: each browser tab gets its own workspace id, kept in sessionStorage, and sends it as X-Workspace on every API call
// that touches server state. Storage can be blocked, so a failure falls back to a per-load id.
const KEY = "agl.workspace";
let memo = null;

// Tests only: forget the id held in memory so the next call picks a new one.
export const forgetWorkspace = () => { memo = null; };

// The server's rule (server/src/workspaces.js validWorkspaceId), minus its credential detectors, which the page cannot run: lowercase letters, digits and hyphens, 1 to
// 40; not 24 or more hex characters in a row; not starting like a JWT; no hyphen-separated part that names a credential or starts a token (sk-, pw-, ghp-,
// token-, password-, ...). A saved id this rejects is replaced at once; anything only the detectors catch is settled by the server's 400 bad_workspace (below).
// A test compares this copy with the server's own check on a table of ids.
const CREDENTIAL_PARTS = new Set(["sk", "pk", "rk", "pw", "pwd", "pass", "passwd", "password", "passphrase", "secret", "token", "apikey", "bearer", "glpat", "ghp", "gho", "ghu", "ghs", "xoxa", "xoxb", "xoxp", "xoxr", "xoxs", "akia", "asia"]);
export function validWorkspaceId(s) {
  if (typeof s !== "string" || !/^[a-z0-9-]{1,40}$/.test(s) || /[0-9a-f]{24,}/.test(s) || s.startsWith("eyj")) return false;
  return !s.split("-").some((part) => CREDENTIAL_PARTS.has(part));
}

// 16 random hex digits that always include a letter: the server refuses an id that looks like a card number (an all-digit id that passes the Luhn check),
// which about 1 in 14,000 plain random ids would be.
export function newWorkspaceId() {
  for (;;) {
    const bytes = new Uint8Array(8);
    (window.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (/[a-f]/.test(hex)) return `w-${hex}`;
  }
}

export function workspaceId() {
  if (memo) return memo;
  try { const saved = window.sessionStorage.getItem(KEY); if (saved && validWorkspaceId(saved)) return (memo = saved); } catch { /* blocked */ }
  memo = newWorkspaceId();
  try { window.sessionStorage.setItem(KEY, memo); } catch { /* blocked */ }
  return memo;
}

// The server answered 400 bad_workspace: the saved id is refused (a stored id from an older build, or a hand-edited one). Pick a fresh one.
export function renewWorkspace() {
  memo = newWorkspaceId();
  try { window.sessionStorage.setItem(KEY, memo); } catch { /* blocked */ }
  return memo;
}

// One retry with a new id when the server refuses ours, so a refused id can never leave the page unable to load.
export async function workspaceFetch(url, opts = {}) {
  const go = () => fetch(url, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}), "x-workspace": workspaceId() } });
  const r = await go();
  if (r.status !== 400) return r;
  let refused = false;
  try { refused = (await r.clone().json()).error === "bad_workspace"; } catch { /* not JSON */ }
  if (!refused) return r;
  renewWorkspace();
  return go();
}
