// The Privilege console REST client, used ONLY in Privilege (Real) mode. One pinned origin (the console), the key/secret header
// scheme from Settings → For Developers, a fresh x-procyon-session-id per call (structurally required, unvalidated: a correlation
// id), read-only GETs of three collections. Responses are size-capped and the key, the secret and anything credential-shaped are
// redacted from every error. The optional PEM (AGL_PRIV_CA) is trusted for the console origin ONLY.
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';

export const PRIV_LIMITS = { timeoutMs: 8000, maxBytes: 2_097_152 };

export class PrivilegeError extends Error {
  constructor(code, detail, status) { super(detail); this.code = code; this.status = status; }
}

// The console's root certificate, fetched once and pinned: the lab trusts exactly this leaf chain for this origin, not the system store.
export async function fetchConsoleCert(host, port) {
  // Same pin as the client: the console host is loopback, whatever /etc/hosts says today.
  const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, lookup: (h, o, cb) => { const d = typeof o === 'function' ? o : cb; d(null, '127.0.0.1', 4); }, autoSelectFamily: false });
  await new Promise((res, rej) => { socket.once('secureConnect', res); socket.once('error', rej); });
  const cert = socket.getPeerCertificate(true);
  // Walk to the self-signed root of the presented chain.
  let c = cert; const seen = new Set();
  while (c.issuerCertificate && c.issuerCertificate.fingerprint256 !== c.fingerprint256 && !seen.has(c.issuerCertificate.fingerprint256)) { seen.add(c.fingerprint256); c = c.issuerCertificate; }
  socket.destroy();
  const pem = ['-----BEGIN CERTIFICATE-----', c.raw.toString('base64').replace(/(.{64})/g, '$1\n'), '-----END CERTIFICATE-----', ''].join('\n');
  return pem;
}

export function createPrivilegeClient({ origin, tenant, key, secret, ca, timeoutMs = PRIV_LIMITS.timeoutMs, maxBytes = PRIV_LIMITS.maxBytes, sessionId = () => crypto.randomUUID() } = {}) {
  const u = new URL(origin);
  const port = u.port || (u.protocol === 'https:' ? 443 : 80);
  const lib = u.protocol === 'https:' ? https : http;
  const base = `${origin.replace(/\/$/, '')}/api/${tenant}/v1`;
  const redact = (t) => String(t).split(key).join('***').split(secret).join('***');
  // The console's name may be served by the desktop app's /etc/hosts entries, which come and go with the app. Resolution is
  // pinned: the console host resolves to LOOPBACK only (the app binds 127.0.0.1), any other answer or any other host is refused.
  // Honours the { all: true } shape (an address LIST) and the single-address shape.
  const lookup = (hostname, options, cb) => {
    const opts = typeof options === 'function' ? {} : options;
    const done = typeof options === 'function' ? options : cb;
    if (String(hostname).toLowerCase() !== u.hostname.toLowerCase()) return done(new Error(`unexpected host ${String(hostname).slice(0, 60)}`));
    if (opts && opts.all === true) return done(null, [{ address: '127.0.0.1', family: 4 }]);
    done(null, '127.0.0.1', 4);
  };

  function get(collection) {
    return new Promise((resolve, reject) => {
      const req = lib.request({
        protocol: u.protocol, hostname: u.hostname.replace(/^\[|\]$/g, ''), port, path: `/api/${tenant}/v1/${collection}?ObjectMeta.Namespace=default`,
        method: 'GET', agent: false, lookup, ...(ca && lib === https ? { ca } : {}),
        headers: { 'x-api-key': key, 'x-api-secret': secret, 'x-procyon-session-id': sessionId(), accept: 'application/json', connection: 'close' },
      }, (res) => {
        const chunks = []; let size = 0;
        res.on('data', (c) => { size += c.length; if (size <= maxBytes) chunks.push(c); else res.destroy(); });
        res.on('end', () => {
          if (size > maxBytes) return reject(new PrivilegeError('too_large', `the ${collection} answer is over the ${maxBytes}-byte cap`, 502));
          if (res.statusCode === 401 || res.statusCode === 403) return reject(new PrivilegeError('console_auth', 'the console refused the key pair (check its expiry in Settings → For Developers)', 502));
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(new PrivilegeError('console_error', `the console answered ${res.statusCode} for ${collection}`, 502));
          let body;
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reject(new PrivilegeError('bad_body', `the ${collection} answer is not JSON`, 502)); }
          resolve(body);
        });
        res.on('error', (e) => reject(new PrivilegeError('network_error', redact(e.message))));
      });
      req.setTimeout(timeoutMs, () => { req.destroy(); reject(new PrivilegeError('timeout', 'the console did not answer in time', 504)); });
      req.on('error', (e) => reject(new PrivilegeError(e.code === 'ECONNREFUSED' ? 'connect_refused' : 'network_error', redact(`the console did not answer (${e.code || e.message || 'error'})`), 504)));
      req.end();
    });
  }

  return {
    origin,
    // The three collections the lab reads. Read-only: no PUT, POST or DELETE is ever issued to the console.
    async fetchAll() {
      const apps = await get('applications');
      const policies = await get('pacpolicys');
      const tagPolicies = await get('tagpolicys');
      return {
        applications: Array.isArray(apps.Applications) ? apps.Applications : [],
        pacPolicys: Array.isArray(policies.PacPolicys) ? policies.PacPolicys : [],
        tagPolicys: Array.isArray(tagPolicies.TagPolicys) ? tagPolicies.TagPolicys : [],
      };
    },
  };
}
