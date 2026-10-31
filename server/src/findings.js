// Lab-written illustrative findings and a lab-invented five-level score.
// The deck (slide 45) says Ping builds a five-level score from 46 specific findings. Those 46 are Ping's and are not in the deck beyond a handful of
// categories; the thirteen below are the LAB'S OWN, each a real rule over the seeded data with a test that it fires and a near-miss that does not.
// The points, the level thresholds and the rule details are lab-invented. Pure functions: no I/O, no randomness.
import { MODELS } from './catalog.js';

export const DECK_NUMBERS = { sources: 13, findings: 46, levels: 5 }; // the DECK's numbers (slide 45); not what the lab ships
export const LEVELS = [
  { level: 1, name: 'Minimal', min: 0 },
  { level: 2, name: 'Low', min: 1 },
  { level: 3, name: 'Moderate', min: 15 },
  { level: 4, name: 'High', min: 35 },
  { level: 5, name: 'Critical', min: 60 },
];
export const SCORE_CAP = 100;
export const STALE_CREDENTIAL_DAYS = 90; // LF-10 fires when the last rotation is MORE than this many days ago

// The agent as it can act right now: a quarantined agent's identity is detached and it is not reachable; a disabled named credential makes the
// permissions that ride on it inert; a stopped flow no longer runs; a revoked agent holds nothing.
export function effective(a) {
  const quarantined = a.quarantined === true;
  const credOn = (id) => !id || a.credentials.some((c) => c.id === id && c.enabled);
  const perms = quarantined || a.revoked ? [] : a.identity.permissions.filter((p) => credOn(p.viaCredential));
  const flows = quarantined ? [] : a.flows.filter((f) => f.running);
  return {
    perms, flows, tools: a.tools, kbs: a.knowledgeBases, bindings: a.bindings, subAgents: a.subAgents, creds: a.credentials.filter((c) => c.enabled),
    publicAccess: quarantined ? false : a.config.publicAccess === true, authentication: a.config.authentication, logging: a.config.logging === true, guardrail: a.config.guardrail,
    model: a.model, custodian: a.custodian ?? null, identityName: a.identity.name,
  };
}

const F = (id, name, category, points, says, rule) => ({ id, name, category, points, says, rule });

export const FINDINGS = [
  F('LF-01', 'Administrative privilege', 'privilege', 40, 'The execution identity holds an administrative grant (a wildcard action, an Owner role, a system-administrator named credential) or a privileged flow is running.', (v) => {
    const p = v.perms.find((x) => x.class === 'admin');
    if (p) return `administrative grant: ${p.grant}`;
    const f = v.flows.find((x) => x.privileged);
    return f ? `privileged flow running: ${f.name}` : null;
  }),
  F('LF-02', 'Publicly reachable and unauthenticated', 'exposure', 35, 'The agent can be reached from the public internet and its authentication is none.', (v) => (v.publicAccess && v.authentication === 'none' ? 'public endpoint with authentication none' : null)),
  F('LF-03', 'Over-privileged identity', 'privilege', 15, 'The identity holds two or more write-capable grants (not administrative) that none of the agent\'s tools use.', (v) => {
    const n = v.perms.filter((p) => p.write && !p.usedBy && p.class !== 'admin');
    return n.length >= 2 ? `${n.length} unused write grants: ${n.map((p) => p.id).join(', ')}` : null;
  }),
  F('LF-04', 'Lateral-movement path', 'path', 30, 'The identity can assume or pass a role that is itself administrative.', (v, ctx) => {
    const p = v.perms.find((x) => x.class === 'impersonate' && x.target && ctx.adminIdentities.has(x.target) && x.target !== v.identityName);
    return p ? `can act as an administrative identity (${p.target}) through ${p.action}` : null;
  }),
  F('LF-05', 'Credential-exfiltration path', 'path', 30, 'The identity can read secrets and the agent has a tool that sends data out of the account.', (v) => {
    const s = v.perms.find((x) => x.class === 'read-secret'); const t = v.tools.find((x) => x.egress);
    return s && t ? `reads secrets (${s.action}) and tool ${t.name} sends data out` : null;
  }),
  F('LF-06', 'Dangling role', 'hygiene', 10, 'A binding names a role that no longer exists.', (v) => {
    const b = v.bindings.find((x) => x.roleExists === false);
    return b ? `binding ${b.id} names a missing role (${b.role})` : null;
  }),
  F('LF-07', 'Missing guardrails', 'guardrail', 15, 'The agent has a tool that writes, or a knowledge base, and no guardrail is attached.', (v) => (!v.guardrail && (v.tools.some((t) => t.write) || v.kbs.length > 0) ? 'no guardrail on an agent with a write tool or a knowledge base' : null)),
  F('LF-08', 'Deprecated model', 'hygiene', 10, 'The agent runs a model on the lab\'s deprecated list.', (v) => {
    const m = Object.hasOwn(MODELS, v.model) ? MODELS[v.model] : null;
    return m?.deprecated ? `model ${v.model} was retired ${m.retired}` : null;
  }),
  F('LF-09', 'Orphaned agent (no custodian)', 'ownership', 15, 'No named custodian is assigned, or the assigned custodian has left.', (v, ctx) => (!v.custodian ? 'no custodian' : ctx.departed?.has(v.custodian) ? 'the custodian has left and no one has taken over' : null)),
  F('LF-10', 'Stale credential', 'hygiene', 10, `An enabled credential was last rotated more than ${STALE_CREDENTIAL_DAYS} days ago.`, (v) => {
    const c = v.creds.find((x) => x.rotatedDaysAgo > STALE_CREDENTIAL_DAYS);
    return c ? `credential ${c.name} rotated ${c.rotatedDaysAgo} days ago` : null;
  }),
  F('LF-11', 'Shared execution identity', 'privilege', 10, 'Another agent in the inventory runs with the same execution identity.', (v, ctx) => ((ctx.identityUse[v.identityName] || 0) > 1 ? `identity ${v.identityName} is shared by ${ctx.identityUse[v.identityName]} agents` : null)),
  F('LF-12', 'Sub-agent not in the inventory', 'path', 10, 'The agent delegates to a sub-agent the inventory does not know.', (v, ctx) => {
    const m = v.subAgents.find((id) => !ctx.knownIds.has(id));
    return m ? 'delegates to a sub-agent that is not in the inventory' : null;
  }),
  F('LF-13', 'Logging disabled', 'hygiene', 10, 'The agent\'s invocation logging is off.', (v) => (v.logging ? null : 'invocation logging is off')),
];
export const FINDING_IDS = FINDINGS.map((f) => f.id);

export const levelOf = (score) => [...LEVELS].reverse().find((l) => score >= l.min);

// ctx is computed once per snapshot from the whole inventory: which identities are administrative, how many agents share an identity, which ids exist.
export function buildContext(agents, departed = new Set()) {
  const live = agents.filter((a) => a.status === 'active' || a.status === 'unknown');
  const adminIdentities = new Set(live.filter((a) => effective(a).perms.some((p) => p.class === 'admin') || effective(a).flows.some((f) => f.privileged)).map((a) => a.identity.name));
  const identityUse = {};
  for (const a of live) identityUse[a.identity.name] = (identityUse[a.identity.name] || 0) + 1;
  return { adminIdentities, identityUse, knownIds: new Set(live.map((a) => a.id)), departed };
}

export function assess(a, ctx) {
  const v = effective(a);
  const findings = [];
  for (const f of FINDINGS) {
    const detail = f.rule(v, ctx);
    if (detail) findings.push({ id: f.id, name: f.name, points: f.points, detail, ...(a.discoveredVia?.path === 'workload-scanner' ? { scannerLocation: a.discoveredVia.scannerRunsIn } : {}) });
  }
  const score = Math.min(SCORE_CAP, findings.reduce((n, f) => n + f.points, 0));
  const lv = levelOf(score);
  return { score, level: lv.level, levelName: lv.name, findings };
}
