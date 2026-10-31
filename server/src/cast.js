// {{token}} templating for the story and catalog data. customer.config.json (optional, git-ignored) overrides brand, host and the first custodian.
// Tokens are filled from one of three vertical packs. A test fails on any token a pack does not define.
// Every person, agent, account and host in a pack is synthetic: only .example hosts, no real company, tenant or account.
import fs from 'node:fs';
import { scanHosts } from './safety.js';

const TOKEN = /\{\{(\w+)\}\}/g;
const MAX_CAST = 40;
const ID = /^[a-z0-9.-]{1,40}$/;

export const VERTICALS = {
  finance: {
    castBrand: 'Fabrikam Bank', castHost: 'fabrikam', castAdmin: 'priya.nair', castAdmin2: 'lee.park', castCustodian: 'maya.chen', castCustodian2: 'omar.reyes',
    castCustodian3: 'ines.duarte', castOutsider: 'sam.jones', castTeam: 'payments-platform',
    castDomain1: 'refunds', castDomain2: 'ledger', castDomain3: 'fraud', castDomain4: 'collections', castDomain5: 'treasury', castDomain6: 'onboarding',
  },
  health: {
    castBrand: 'Contoso Health', castHost: 'contoso', castAdmin: 'grace.liu', castAdmin2: 'kofi.mensah', castCustodian: 'lena.ortiz', castCustodian2: 'tariq.hassan',
    castCustodian3: 'maria.costa', castOutsider: 'noah.becker', castTeam: 'clinical-platform',
    castDomain1: 'intake', castDomain2: 'claims', castDomain3: 'triage', castDomain4: 'scheduling', castDomain5: 'pharmacy', castDomain6: 'referrals',
  },
  retail: {
    castBrand: 'Northwind Retail', castHost: 'northwind', castAdmin: 'olu.adeyemi', castAdmin2: 'anna.berg', castCustodian: 'diego.ruiz', castCustodian2: 'hana.sato',
    castCustodian3: 'raj.patel', castOutsider: 'mia.kowalski', castTeam: 'commerce-platform',
    castDomain1: 'checkout', castDomain2: 'stock', castDomain3: 'returns', castDomain4: 'pricing', castDomain5: 'loyalty', castDomain6: 'delivery',
  },
};
export const DEFAULT_VERTICAL = 'finance';
export const DEFAULT_CAST = VERTICALS[DEFAULT_VERTICAL];

export const unfilled = (text, cast) => [...String(text).matchAll(TOKEN)].map((m) => m[1]).filter((k) => !Object.hasOwn(cast, k));
export const fill = (text, cast) => String(text).replace(TOKEN, (m, k) => (Object.hasOwn(cast, k) ? cast[k] : m));
// Iterative, so a deep structure cannot overflow the stack.
export function fillDeep(value, cast) {
  const clone = (x) => (Array.isArray(x) ? [] : x && typeof x === 'object' ? {} : x);
  const outRoot = { v: clone(value) };
  const work = [[value, outRoot, 'v']];
  while (work.length) {
    const [src, dst, key] = work.pop();
    if (typeof src === 'string') { dst[key] = fill(src, cast); continue; }
    if (src === null || typeof src !== 'object') { dst[key] = src; continue; }
    const copy = clone(src);
    dst[key] = copy;
    for (const k of Object.keys(src).reverse()) work.push([src[k], copy, k]);
  }
  return outRoot.v;
}

export const verticalFrom = (id) => (typeof id === 'string' && Object.hasOwn(VERTICALS, id) ? id : DEFAULT_VERTICAL);

// Only brand, host and the first custodian, as short plain strings; anything else in the file is ignored. The custodian must not collide
// with another person in the pack.
export function loadCast(file, vertical = DEFAULT_VERTICAL) {
  const cast = { ...VERTICALS[verticalFrom(vertical)] };
  if (!file) return cast;
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [short, key] of [['brand', 'castBrand'], ['custodian', 'castCustodian'], ['host', 'castHost']]) {
      const v = cfg?.cast?.[short];
      if (typeof v !== 'string' || !v.trim()) continue;
      const clean = v.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').trim().slice(0, MAX_CAST);
      if (/:\/\/|@/.test(clean) || scanHosts(clean).length) continue;
      if (short !== 'brand' && !ID.test(clean.toLowerCase())) continue;
      if (short === 'host' && clean.includes('.')) continue;
      const val = short === 'brand' ? clean : clean.toLowerCase();
      if (short === 'custodian' && Object.entries(cast).some(([k, x]) => k !== 'castCustodian' && x === val)) continue;
      cast[key] = val;
    }
  } catch { /* no file or not JSON: the defaults */ }
  return cast;
}

// The roster: two tenant administrators, three custodians and one member who is neither. Roles are the lab's own (Agent Delegated Administration is GA on slide 21;
// how it assigns roles is not in the deck). `departed` is set when a custodian leaves (succession).
export function buildRoster(cast) {
  const p = (id, role) => ({ id, role });
  return [p(cast.castAdmin, 'admin'), p(cast.castAdmin2, 'admin'), p(cast.castCustodian, 'custodian'), p(cast.castCustodian2, 'custodian'), p(cast.castCustodian3, 'custodian'), p(cast.castOutsider, 'member')];
}
