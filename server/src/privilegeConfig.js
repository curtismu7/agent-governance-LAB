// Real-mode configuration: the local PingOne Privilege console (local.procyon.ai:8643 by default). The settings come from the one
// shared settings file (~/Development/.env or STANDALONE_ENV): the tenant id, the console's API key and secret ("For Developers" pair,
// the same pair privilege-api-explorer-LAB uses) and optionally a PEM file that names the console's FrontEndCA root, trusted for the
// console origin ONLY. Owner rule 2026-11-14: Real mode may pull inventory from the live Privilege tenant; nothing else leaves the machine.
import fs from 'node:fs';
import os from 'node:os';

export const PRIV_SETTING_NAMES = ['AGL_PRIV_CONSOLE_URL', 'AGL_PRIV_TENANT', 'AGL_PRIV_API_KEY', 'AGL_PRIV_API_SECRET', 'AGL_PRIV_CA'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A URL check that refuses credentials-in-URL, paths and anything but https (http on loopback is allowed for tests only via allowHttp).
export function checkConsoleUrl(raw, { what = 'AGL_PRIV_CONSOLE_URL', allowHttp = false } = {}) {
  let u;
  try { u = new URL(String(raw)); } catch { return { ok: false, problem: `${what} is not a URL` }; }
  if (u.username || u.password) return { ok: false, problem: `${what} carries credentials in the URL; put them in AGL_PRIV_API_KEY and AGL_PRIV_API_SECRET` };
  if (u.pathname !== '/' && u.pathname !== '') return { ok: false, problem: `${what} must be the console origin only, no path` };
  if (u.protocol === 'https:') { /* fine */ }
  else if (u.protocol === 'http:' && (allowHttp || u.hostname === 'localhost' || u.hostname === '127.0.0.1')) { /* loopback http is fine */ }
  else return { ok: false, problem: `${what} must be https (http is allowed only for localhost)` };
  return { ok: true, url: u, origin: u.origin, host: u.hostname };
}

// Reads the five keys, fills only the missing ones from the shared settings file, and validates. Returns
// { ok: true, consoleUrl, origin, host, tenant, key, secret, ca } or { ok: false, problem }.
export function privilegeConfig(env = process.env, { readFile = (p) => fs.readFileSync(p, 'utf8'), allowHttp = false } = {}) {
  const s = {};
  for (const k of PRIV_SETTING_NAMES) if (typeof env[k] === 'string' && env[k] !== '') s[k] = env[k];
  if (!s.AGL_PRIV_CONSOLE_URL || !s.AGL_PRIV_TENANT || !s.AGL_PRIV_API_KEY || !s.AGL_PRIV_API_SECRET) {
    return { ok: false, problem: 'Real mode reads the live Privilege console and needs AGL_PRIV_CONSOLE_URL, AGL_PRIV_TENANT, AGL_PRIV_API_KEY and AGL_PRIV_API_SECRET in the shared settings file. Mock and Live keep working without them.' };
  }
  const cu = checkConsoleUrl(s.AGL_PRIV_CONSOLE_URL, { allowHttp });
  if (!cu.ok) return cu;
  const tenant = String(s.AGL_PRIV_TENANT).toLowerCase();
  if (!UUID_RE.test(tenant)) return { ok: false, problem: 'AGL_PRIV_TENANT must be the tenant id (a UUID)' };
  if (s.AGL_PRIV_API_KEY.length < 8 || s.AGL_PRIV_API_SECRET.length < 8) return { ok: false, problem: 'AGL_PRIV_API_KEY and AGL_PRIV_API_SECRET look too short to be the console pair' };
  let ca = null;
  if (s.AGL_PRIV_CA) {
    try { ca = readFile(s.AGL_PRIV_CA.replace(/^~(?=\/)/, os.homedir())); } catch { return { ok: false, problem: 'AGL_PRIV_CA is not a readable file' }; }
    if (ca.length > 65_536 || !ca.includes('-----BEGIN CERTIFICATE-----')) return { ok: false, problem: 'AGL_PRIV_CA must be a PEM certificate file' };
  }
  return { ok: true, consoleUrl: cu.url, origin: cu.origin, host: cu.host, tenant, key: s.AGL_PRIV_API_KEY, secret: s.AGL_PRIV_API_SECRET, ca };
}

export const realAvailableFrom = (env = process.env, opts) => privilegeConfig(env, opts).ok;
export const realProblemFrom = (env = process.env, opts) => { const c = privilegeConfig(env, opts); return c.ok ? null : c.problem; };
