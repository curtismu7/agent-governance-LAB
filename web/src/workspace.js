// Rule 13: each browser tab gets its own workspace id, kept in sessionStorage, and sends it as X-Workspace on every API call
// that touches server state. Storage can be blocked, so a failure falls back to a per-load id.
const KEY = "agl.workspace";
let memo = null;

// Tests only: forget the id held in memory so the next call picks a new one.
export const forgetWorkspace = () => { memo = null; };

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
  try { const saved = window.sessionStorage.getItem(KEY); if (saved && /^[a-z0-9-]{1,40}$/.test(saved)) return (memo = saved); } catch { /* blocked */ }
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
