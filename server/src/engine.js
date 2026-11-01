// The governance engine: an in-process model of a cross-cloud agent inventory with REAL state. Provider world (what exists), inventory (what was discovered),
// the safe sync (gone vs the provider did not answer), custodian proposals (propose -> admin approves or denies -> execute, with self-approval, approve-after-deny
// and stale approvals refused), remediation, succession, a certification campaign, private-network discovery, and the AgentCore gateways.
// One Engine per workspace and vertical. No I/O, no randomness, no network, no clock: with the same calls it gives the same state. The Mock tables are generated from it.
// Every writer is synchronous, so a check and its change can never interleave with another request (check-and-add is atomic per engine).
import { SOURCES, SOURCE, SCOPES, SCOPE, OUS, OU_IDS, MODELS, TAG_KEYS, RECONFIGURE_FIELDS, DEFAULT_ONBOARDED_OUS, ORG_ID, PRIVATE_NETWORK_SOURCES, seedAgents } from './catalog.js';
import { FINDINGS, assess, buildContext, levelOf } from './findings.js';
import { seedGateways, seedOrphanEngines, metadata, scorecard, gatewayAction } from './gateway.js';
import { buildRoster } from './cast.js';
import { cleanFree } from './credentials.js';
import { formatTraceparent } from './trace.js';
import { refuse } from './errors.js';

export const AUDIT_MARGIN = 40; // new work is refused once fewer than this many audit slots are free: one action never writes more than this many entries
export const SUCCESSION = 'succession (lab)'; // the proposer of a transfer that a custodian's departure triggers
export const LIMITS = { proposals: 200, openPerAgent: 5, audit: 500, refusals: 200, runs: 30, connections: 10, polls: 50, failures: 20, reason: 300, comment: 200, tags: 6, hops: 40, campaigns: 5, name: 60, sources: 3, scopeIds: 5 };
export const PROPOSAL_KINDS = ['delete', 'quarantine', 'strip-role', 'stop-flow', 'disable-credential', 'retag', 'reconfigure', 'transfer', 'revoke-access'];
export const FAILURE_KINDS = ['timeout', 'error', 'throttled'];
export const SCANNER_KINDS = ['aws-account', 'azure-subscription', 'gcp-project'];
const SCANNER_ID = { 'aws-account': /^\d{12}$/, 'azure-subscription': /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'gcp-project': /^[a-z][a-z0-9-]{5,29}$/ };
const BASE_MS = Date.parse('2026-11-02T09:00:00.000Z');
const OPEN = new Set(['proposed', 'approved']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v, max = 64) => typeof v === 'string' && v.length > 0 && v.length <= max;
const pad = (n, w = 4) => String(n).padStart(w, '0');
const clone = (x) => JSON.parse(JSON.stringify(x));
const onlyKeys = (o, allowed) => isObj(o) && Object.keys(o).every((k) => allowed.includes(k));
const strictKeys = (o, allowed, what = 'the call') => { if (!onlyKeys(o, allowed)) throw refuse('unknown_field', `${what} carries a field the lab does not take`); };
const need = (cond, code, msg, status = 400) => { if (!cond) throw refuse(code, msg, status); };

export class Engine {
  constructor(cast) {
    this.cast = cast;
    this.trace = null; this.hops = []; this.hopsTruncated = false;
    this.s = this.fresh();
    this.runSync([], 'lab (initial scan)');
  }

  fresh() {
    const records = new Map(seedAgents(this.cast).map((a) => [a.id, a]));
    return {
      seq: { audit: 0, proposal: 0, run: 0, campaign: 0, item: 0, conn: 0, poll: 0 },
      world: { records, present: new Set([...records.values()].filter((a) => !a.latent).map((a) => a.id)), released: false },
      agents: new Map(), people: new Map(buildRoster(this.cast).map((p) => [p.id, { ...p, departed: false }])),
      proposals: [], audit: [], refusals: [], dropped: { refusals: 0, runs: 0, polls: 0 }, runs: [], campaigns: [], onboardedOus: [...DEFAULT_ONBOARDED_OUS], accountsSeen: new Set(),
      privateNetwork: { tenantEnabled: false, connections: [], polls: [] },
      gateways: seedGateways(this.cast), orphanEngines: seedOrphanEngines(),
    };
  }
  reset() { this.s = this.fresh(); this.hops = []; this.runSync([], 'lab (initial scan)'); }

  // ---------- helpers -------------------------------------------------------------------------------------------------------------------------
  hop(label, request, response) {
    if (!this.trace) return;
    if (this.hops.length >= LIMITS.hops) { this.hopsTruncated = true; return; }
    this.hops.push({ n: this.hops.length + 1, label, request: { ...request, headers: { traceparent: formatTraceparent(this.trace.traceId, this.trace.span()), ...(request.headers || {}) } }, response });
  }
  audit(kind, actor, data = {}) {
    const a = { ...data, n: ++this.s.seq.audit, at: new Date(BASE_MS + this.s.seq.audit * 60_000).toISOString(), kind, actor };
    // Refused attempts go to their own, smaller ring (counted when it drops), so a flood of refusals can never push out the record of what was decided or executed.
    // Every other entry is kept: new work is refused (auditRoom) before the audit log is full.
    if (kind.startsWith('refused:')) { this.s.refusals.push(a); if (this.s.refusals.length > LIMITS.refusals) { this.s.refusals.shift(); this.s.dropped.refusals += 1; } }
    else this.s.audit.push(a);
    return a;
  }
  auditRoom() { return LIMITS.audit - this.s.audit.length; }
  person(id) { return isStr(id) && this.s.people.has(id) ? this.s.people.get(id) : null; }
  // A valid, present roster member. Never echoes the value.
  actor(id) {
    const p = this.person(id);
    need(p, 'bad_actor', 'actor must be someone in the roster');
    need(!p.departed, 'actor_departed', 'that person has left; their custodian rights have ended', 403);
    return p;
  }
  requireAdmin(id, why = 'only a tenant administrator can do this') {
    const p = this.actor(id);
    if (p.role !== 'admin') { this.audit('refused:admin_only', p.id, {}); throw refuse('admin_only', why, 403); }
    return p.id;
  }
  agent(id) { const a = isStr(id) ? this.s.agents.get(id) : null; need(a, 'unknown_agent', 'no such agent in the inventory', 404); return a; }
  live(a) { return a.status === 'active' || a.status === 'unknown'; }
  bump(a) { a.rev += 1; }

  // ---------- discovery and the safe sync -----------------------------------------------------------------------------------------------------
  // Org enumeration: AWS member accounts of the lab's organization are listed and onboarded automatically, scoped by organizational unit.
  accountsView() {
    return SCOPES.filter((c) => c.cloud === 'aws' && (!c.latent || this.s.world.released)).map((c) => ({ id: c.id, ou: c.ou, label: c.label, status: this.s.onboardedOus.includes(c.ou) ? 'onboarded' : 'not-onboarded', reach: c.reach }));
  }
  connectionFor(scope, source) {
    const pn = this.s.privateNetwork;
    return pn.tenantEnabled ? pn.connections.find((c) => c.enabled && c.scopeIds.includes(scope) && c.sources.includes(source)) || null : null;
  }

  // failures: [{ source | scope, kind }]. Validated as a whole: a bad entry refuses the whole call.
  checkFailures(failures) {
    need(Array.isArray(failures), 'bad_failures', 'failures must be a list');
    need(failures.length <= LIMITS.failures, 'too_many_failures', `at most ${LIMITS.failures} injected failures per sync`);
    return failures.map((f) => {
      need(isObj(f) && Object.keys(f).every((k) => ['source', 'scope', 'kind'].includes(k)), 'bad_failure', 'each failure is { source or scope, kind }');
      need((f.source === undefined) !== (f.scope === undefined), 'bad_failure', 'each failure names a source or a scope, not both');
      need(FAILURE_KINDS.includes(f.kind), 'bad_failure', `kind must be ${FAILURE_KINDS.join(', ')}`);
      if (f.source !== undefined) need(typeof f.source === 'string' && Object.hasOwn(SOURCE, f.source), 'bad_failure', 'unknown source');
      if (f.scope !== undefined) need(typeof f.scope === 'string' && Object.hasOwn(SCOPE, f.scope), 'bad_failure', 'unknown scope');
      return { source: f.source, scope: f.scope, kind: f.kind };
    });
  }

  sync(input = {}) {
    strictKeys(input, ['failures', 'actor'], 'the sync');
    const failures = this.checkFailures(input.failures ?? []);
    const who = input.actor === undefined ? 'lab visitor' : this.actor(input.actor).id; // anyone present may run a sync; the acting user is recorded
    return this.runSync(failures, who);
  }

  runSync(failures, who) {
    const s = this.s;
    const seq = ++s.seq.run;
    const run = { id: `run-${pad(seq)}`, seq, by: who, parts: [], discovered: [], recovered: [], gone: [], unknown: [], enumerated: [] };
    // Provider changes between the first and second scan: new agents in consoles and one new AWS account (the lab's scripted "world moves on").
    if (seq === 2 && !s.world.released) {
      s.world.released = true;
      for (const a of s.world.records.values()) if (a.latent) s.world.present.add(a.id);
    }
    const before = { present: new Set(s.world.present), records: new Set(s.agents.keys()) };
    // enumerate and onboard accounts
    for (const acc of this.accountsView()) {
      if (acc.status === 'onboarded' && !s.accountsSeen.has(acc.id)) { s.accountsSeen.add(acc.id); run.enumerated.push(acc.id); }
    }
    // the parts of this run: one per (source, scope) the controller or a scanner is meant to answer for
    const pairs = new Map();
    for (const a of s.world.records.values()) {
      const sc = SCOPE[a.scope];
      if (sc.latent && !s.world.released) continue;
      if (sc.cloud === 'aws' && !s.onboardedOus.includes(sc.ou)) continue;
      pairs.set(`${a.source}|${a.scope}`, { source: a.source, scope: a.scope });
    }
    const seen = new Set();
    for (const part of pairs.values()) {
      const sc = SCOPE[part.scope];
      const inj = failures.find((f) => f.source === part.source || f.scope === part.scope);
      const conn = sc.reach === 'private' ? this.connectionFor(part.scope, part.source) : null;
      const rec = { source: part.source, scope: part.scope, via: conn ? 'workload-scanner' : 'controller', status: 'ok', reason: null, seen: 0, discovered: 0 };
      if (inj) { rec.status = 'failed'; rec.reason = `the provider did not answer (${inj.kind}, injected)`; }
      else if (sc.reach === 'private' && !conn) { rec.status = 'not-scanned'; rec.reason = 'a private network the controller cannot reach and no enabled Workload Scanner connection covers'; }
      this.hop(rec.via === 'workload-scanner' ? `Workload Scanner polls out through your proxy for ${part.source} in ${part.scope} (illustration, never sent)` : `controller to the ${part.source} API in ${part.scope} (illustration, never sent)`,
        { method: 'POST', url: `https://${part.source}.api.lab.example/list-agents`, body: { scope: part.scope } }, { status: rec.status === 'ok' ? 200 : rec.status === 'failed' ? 504 : 0, body: { status: rec.status } });
      if (rec.status === 'ok') {
        for (const w of s.world.records.values()) {
          if (w.source !== part.source || w.scope !== part.scope || !s.world.present.has(w.id)) continue;
          seen.add(w.id); rec.seen += 1;
          const have = s.agents.get(w.id);
          if (!have) { this.discover(w, run, conn); run.discovered.push(w.id); rec.discovered += 1; }
          else if (have.status === 'unknown' || have.status === 'gone') { have.status = 'active'; have.lastSeenRun = seq; this.bump(have); run.recovered.push(w.id); }
          else have.lastSeenRun = seq;
        }
      }
      run.parts.push(rec);
    }
    const failedAny = run.parts.some((p) => p.status === 'failed');
    // Not seen this run: "gone" only if the whole run completed AND the provider answered for that agent's part; otherwise "unknown". Nothing is ever deleted here.
    for (const a of s.agents.values()) {
      if (!this.live(a) || seen.has(a.id)) continue;
      const part = run.parts.find((p) => p.source === a.source && p.scope === a.scope);
      if (!failedAny && part && part.status === 'ok') { if (a.status !== 'gone') { a.status = 'gone'; this.bump(a); } run.gone.push(a.id); }
      else { if (a.status !== 'unknown') { a.status = 'unknown'; this.bump(a); } run.unknown.push(a.id); }
    }
    // The outcome is "complete" only when every part answered AND no agent was left unknown. "partial": a provider did not answer (nothing is deleted).
    // "not-fully-scanned": nothing failed, but some of the estate was not scanned (a private network with no enabled connection, or an organizational unit
    // that is not onboarded), so agents there are unknown; the parts that were scanned still mark what they no longer see as gone.
    run.outcome = failedAny ? 'partial' : (run.parts.some((p) => p.status !== 'ok') || run.unknown.length > 0) ? 'not-fully-scanned' : 'complete';
    // Measured, not asserted: how many provider objects and inventory records this run removed.
    run.removedFromProvider = [...before.present].filter((id) => !s.world.present.has(id)).length;
    run.inventoryRecordsRemoved = [...before.records].filter((id) => !s.agents.has(id)).length;
    s.runs.push(run); if (s.runs.length > LIMITS.runs) { s.runs.shift(); s.dropped.runs += 1; }
    this.audit('sync', who, { run: run.id, outcome: run.outcome, discovered: run.discovered.length, gone: run.gone.length, unknown: run.unknown.length, failedParts: run.parts.filter((p) => p.status === 'failed').length });
    return run;
  }

  discover(w, run, conn) {
    const rec = clone(w);
    const hinted = rec.custodianHint ? this.cast[rec.custodianHint] : null;
    const p = hinted ? this.s.people.get(hinted) : null;
    rec.custodian = p && p.role === 'custodian' && !p.departed ? p.id : null;
    rec.classification = { basis: rec.custodian ? 'owner hint on the agent in the cloud console' : 'no owner hint', result: rec.custodian ? 'assigned' : 'orphan' };
    delete rec.custodianHint; delete rec.latent;
    rec.status = 'active'; rec.quarantined = false; rec.revoked = false; rec.discoveredAtRun = run.seq; rec.lastSeenRun = run.seq;
    rec.discoveredVia = conn ? { path: 'workload-scanner', connectionId: conn.id, scannerRunsIn: clone(conn.scannerRunsIn) } : { path: 'controller' };
    this.s.agents.set(rec.id, rec);
  }

  // The visitor plays "someone deletes or recreates an agent in the cloud console". Not a custodian action: no approval, recorded as the cloud console.
  providerChange(input) {
    strictKeys(input, ['agentId', 'present'], 'the change');
    need(isStr(input.agentId) && this.s.world.records.has(input.agentId), 'unknown_agent', 'no such agent at the provider', 404);
    need(typeof input.present === 'boolean', 'bad_value', 'present must be true or false');
    const had = this.s.world.present.has(input.agentId);
    need(had !== input.present, 'already_in_state', 'the provider already has it that way', 409);
    if (input.present) this.s.world.present.add(input.agentId); else this.s.world.present.delete(input.agentId);
    this.audit('provider-change', 'cloud console (simulated)', { agentId: input.agentId, present: input.present });
    return { agentId: input.agentId, present: input.present };
  }

  // Organizational-unit scoping of the AWS Organizations onboarding.
  setOnboarding(input) {
    strictKeys(input, ['actor', 'ous'], 'the call');
    const who = this.requireAdmin(input.actor, 'only a tenant administrator changes onboarding');
    need(Array.isArray(input.ous) && input.ous.length <= OU_IDS.length && input.ous.every((o) => typeof o === 'string' && OU_IDS.includes(o)) && new Set(input.ous).size === input.ous.length, 'bad_ous', 'ous must be a list of known organizational units');
    this.s.onboardedOus = OU_IDS.filter((o) => input.ous.includes(o));
    this.audit('onboarding', who, { ous: [...this.s.onboardedOus] });
    return { onboardedOus: [...this.s.onboardedOus] };
  }

  // ---------- proposals: propose -> admin approves or denies -> execute ---------------------------------------------------------------------------
  validateKind(a, kind, params) {
    const src = SOURCE[a.source];
    const keys = { delete: [], quarantine: [], 'strip-role': ['permissionId'], 'stop-flow': ['flowId'], 'disable-credential': ['credentialId'], retag: ['key', 'value'], reconfigure: ['field', 'value'], transfer: ['to'], 'revoke-access': [] }[kind];
    strictKeys(params, keys, 'the proposal');
    if (kind === 'delete') { need(src.delete, 'unsupported_on_source', 'delete is not supported on this source (the deck says Databricks is "in development")', 409); return {}; }
    if (kind === 'quarantine') { need(src.quarantine, 'unsupported_on_source', 'quarantine is not supported on this source: the deck says nine sources but names seven, this is not one of them, and the other two are not named, so the lab models seven', 409); need(!a.quarantined, 'already_in_state', 'the agent is already quarantined', 409); return {}; }
    if (kind === 'strip-role') { const p = typeof params.permissionId === 'string' ? a.identity.permissions.find((x) => x.id === params.permissionId) : null; need(p, 'unknown_permission', 'no such permission on this agent', 404); return { permissionId: p.id }; }
    if (kind === 'stop-flow') { const f = typeof params.flowId === 'string' ? a.flows.find((x) => x.id === params.flowId) : null; need(f, 'unknown_flow', 'no such flow on this agent', 404); need(f.running, 'already_in_state', 'the flow is already stopped', 409); return { flowId: f.id }; }
    if (kind === 'disable-credential') { const c = typeof params.credentialId === 'string' ? a.credentials.find((x) => x.id === params.credentialId) : null; need(c, 'unknown_credential', 'no such credential on this agent', 404); need(c.enabled, 'already_in_state', 'the credential is already disabled', 409); return { credentialId: c.id }; }
    if (kind === 'retag') {
      need(typeof params.key === 'string' && TAG_KEYS.includes(params.key), 'bad_tag_key', `key must be one of ${TAG_KEYS.join(', ')}`);
      need(typeof params.value === 'string', 'bad_value', 'value must be text');
      const value = cleanFree(params.value, 40); need(value.length > 0, 'bad_value', 'value must not be empty');
      need(a.tags[params.key] !== value, 'already_in_state', 'the tag already has that value', 409);
      need(Object.hasOwn(a.tags, params.key) || Object.keys(a.tags).length < LIMITS.tags, 'tag_limit', `an agent carries at most ${LIMITS.tags} tags`, 409);
      return { key: params.key, value };
    }
    if (kind === 'reconfigure') {
      need(typeof params.field === 'string' && Object.hasOwn(RECONFIGURE_FIELDS, params.field), 'bad_field', 'field must be publicAccess, logging, authentication or guardrail');
      const allowed = RECONFIGURE_FIELDS[params.field];
      need(allowed.some((x) => x === params.value), 'bad_value', 'that value is not allowed for the field');
      need(a.config[params.field] !== params.value, 'already_in_state', 'the setting already has that value', 409);
      return { field: params.field, value: params.value };
    }
    if (kind === 'transfer') {
      const to = this.person(params.to);
      need(to && to.role === 'custodian' && !to.departed, 'bad_custodian', 'the new custodian must be a custodian who is still here');
      need(a.custodian !== to.id, 'already_in_state', 'that person is already the custodian', 409);
      return { to: to.id };
    }
    need(!a.revoked, 'already_in_state', 'the agent\'s access is already revoked', 409);
    return {};
  }

  openFor(agentId, kind, params) { return this.s.proposals.find((p) => OPEN.has(p.status) && p.agentId === agentId && p.kind === kind && JSON.stringify(p.params) === JSON.stringify(params)); }

  makeProposal(by, a, kind, params, reason, extra = {}) {
    const s = this.s;
    need(s.proposals.length < LIMITS.proposals, 'workspace_full', `a workspace keeps at most ${LIMITS.proposals} proposals: Reset`, 409);
    need(s.proposals.filter((p) => OPEN.has(p.status) && p.agentId === a.id).length < LIMITS.openPerAgent, 'too_many_open', `an agent has at most ${LIMITS.openPerAgent} open proposals`, 409);
    need(!this.openFor(a.id, kind, params), 'duplicate_proposal', 'the same proposal is already open for this agent', 409);
    const p = { id: `prop-${pad(++s.seq.proposal)}`, agentId: a.id, kind, params, reason, proposedBy: by, status: 'proposed', agentRev: a.rev, decidedBy: null, decision: null, comment: '', executedBy: null, result: null, ...extra };
    s.proposals.push(p);
    this.audit('proposal.created', extra.recordedBy || by, { proposal: p.id, agentId: a.id, proposalKind: kind, ...(extra.recordedBy ? { proposedBy: by } : {}) });
    return p;
  }

  propose(input) {
    strictKeys(input, ['actor', 'agentId', 'kind', 'params', 'reason'], 'the proposal');
    const who = this.actor(input.actor);
    const a = this.agent(input.agentId);
    need(this.live(a), 'agent_not_live', 'that agent is gone or deleted', 409);
    need(typeof input.kind === 'string' && PROPOSAL_KINDS.includes(input.kind), 'bad_kind', `kind must be one of ${PROPOSAL_KINDS.join(', ')}`);
    // Operations are restricted to administrators and each agent's assigned custodian (slide 45).
    if (who.role !== 'admin' && who.id !== a.custodian) { this.audit('refused:not_allowed', who.id, { agentId: a.id, proposalKind: input.kind }); throw refuse('not_allowed', 'only an administrator or this agent\'s assigned custodian can propose an action on it', 403); }
    const params = this.validateKind(a, input.kind, input.params === undefined ? {} : input.params);
    const reason = input.reason === undefined ? '' : (need(typeof input.reason === 'string', 'bad_reason', 'reason must be text'), cleanFree(input.reason, LIMITS.reason));
    const p = this.makeProposal(who.id, a, input.kind, params, reason);
    // Only administrators act immediately (slide 45): an administrator's own action runs now, audited with the acting user. A custodian's waits for an administrator.
    if (who.role === 'admin') {
      p.status = 'approved'; p.decidedBy = who.id; p.decision = 'administrator-immediate';
      this.audit('proposal.approved', who.id, { proposal: p.id, agentId: a.id, immediate: true });
      const r = this.performProposal(p, who.id);
      return { proposalId: p.id, status: p.status, immediate: true, result: r.result };
    }
    return { proposalId: p.id, status: p.status };
  }

  proposal(id) { const p = isStr(id) ? this.s.proposals.find((x) => x.id === id) : null; need(p, 'unknown_proposal', 'no such proposal', 404); return p; }

  markStale(p, why) {
    p.status = 'stale'; p.result = { stale: why };
    this.audit('proposal.stale', 'lab', { proposal: p.id, why });
    this.releaseItem(p);
  }

  decide(input) {
    strictKeys(input, ['actor', 'proposalId', 'decision', 'comment'], 'the decision');
    const p = this.proposal(input.proposalId);
    const who = this.actor(input.actor);
    if (who.id === p.proposedBy) { this.audit('refused:self_approval', who.id, { proposal: p.id }); throw refuse('self_approval', 'nobody approves their own proposal', 403); }
    if (who.role !== 'admin') { this.audit('refused:admin_only', who.id, { proposal: p.id }); throw refuse('admin_only', 'every custodian action needs approval from a tenant administrator', 403); }
    need(input.decision === 'approve' || input.decision === 'deny', 'bad_decision', 'decision must be approve or deny');
    const comment = input.comment === undefined ? '' : (need(typeof input.comment === 'string', 'bad_comment', 'comment must be text'), cleanFree(input.comment, LIMITS.comment));
    need(p.status !== 'denied', 'already_denied', 'that proposal was denied; propose it again', 409);
    need(p.status !== 'stale', 'stale_proposal', 'that proposal went stale', 409);
    need(p.status === 'proposed', 'already_decided', 'that proposal is already decided', 409);
    if (input.decision === 'approve') {
      const a = this.s.agents.get(p.agentId);
      if (!a || !this.live(a) || a.rev !== p.agentRev) { this.markStale(p, 'the agent changed after the proposal'); throw refuse('stale_proposal', 'the agent changed after the proposal was made; propose it again', 409); }
    }
    p.status = input.decision === 'approve' ? 'approved' : 'denied'; p.decidedBy = who.id; p.decision = input.decision; p.comment = comment;
    this.audit(p.status === 'approved' ? 'proposal.approved' : 'proposal.denied', who.id, { proposal: p.id, agentId: p.agentId });
    if (p.status === 'denied') this.releaseItem(p);
    return { proposalId: p.id, status: p.status };
  }

  execute(input) {
    strictKeys(input, ['actor', 'proposalId'], 'the call');
    const p = this.proposal(input.proposalId);
    const who = this.actor(input.actor);
    if (who.role !== 'admin' && who.id !== p.proposedBy) { this.audit('refused:not_allowed', who.id, { proposal: p.id }); throw refuse('not_allowed', 'only an administrator or the proposer executes an approved proposal', 403); }
    need(p.status !== 'executed', 'already_executed', 'that proposal already ran', 409);
    need(p.status !== 'denied', 'proposal_denied', 'that proposal was denied', 409);
    need(p.status !== 'stale', 'stale_proposal', 'that proposal went stale', 409);
    need(p.status === 'approved', 'not_approved', 'an administrator must approve the proposal before it runs', 409);
    const r = this.performProposal(p, who.id);
    return { proposalId: p.id, status: p.status, result: r.result };
  }

  // Runs an approved proposal: re-checks that the agent is unchanged and the precondition still holds (else the proposal goes stale), applies it, audits it.
  performProposal(p, whoId) {
    const a = this.s.agents.get(p.agentId);
    if (!a || !this.live(a) || a.rev !== p.agentRev) { this.markStale(p, 'the agent changed after the approval'); throw refuse('stale_proposal', 'the agent changed after the approval; propose it again', 409); }
    let params;
    try { params = this.validateKind(a, p.kind, p.params); } catch (err) { this.markStale(p, 'the precondition no longer holds'); throw refuse('stale_proposal', 'the precondition no longer holds; propose it again', 409); }
    const result = this.apply(a, p.kind, params);
    this.bump(a);
    p.status = 'executed'; p.executedBy = whoId; p.result = result;
    this.audit('proposal.executed', whoId, { proposal: p.id, agentId: a.id, proposalKind: p.kind, approvedBy: p.decidedBy });
    this.hop(`lab controller to the ${a.source} API: ${p.kind} (illustration, never sent)`, { method: p.kind === 'delete' ? 'DELETE' : 'POST', url: `https://${a.source}.api.lab.example/agents/${a.id}/${p.kind}`, body: { by: whoId, approvedBy: p.decidedBy } }, { status: 200, body: { ok: true } });
    const item = this.itemFor(p);
    if (item && p.kind === 'revoke-access') { item.status = 'revoked'; item.decidedBy = p.proposedBy; }
    return { result };
  }

  apply(a, kind, params) {
    if (kind === 'delete') { this.s.world.present.delete(a.id); a.status = 'deleted'; return { deleted: a.id }; }
    if (kind === 'quarantine') { a.quarantined = true; return { quarantined: a.id }; }
    if (kind === 'strip-role') { const i = a.identity.permissions.findIndex((x) => x.id === params.permissionId); const [p] = a.identity.permissions.splice(i, 1); return { stripped: p.grant }; }
    if (kind === 'stop-flow') { a.flows.find((x) => x.id === params.flowId).running = false; return { stopped: params.flowId }; }
    if (kind === 'disable-credential') { a.credentials.find((x) => x.id === params.credentialId).enabled = false; return { disabled: params.credentialId }; }
    if (kind === 'retag') { a.tags[params.key] = params.value; return { tag: params.key }; }
    if (kind === 'reconfigure') { a.config[params.field] = params.value; return { field: params.field }; }
    if (kind === 'transfer') { const from = a.custodian; a.custodian = params.to; return { from, to: params.to }; }
    a.revoked = true; return { revoked: a.id };
  }

  // Succession (slide 19): when a custodian leaves, a transfer is proposed for every agent they held. Each still needs approval from a different administrator.
  depart(input) {
    strictKeys(input, ['actor', 'person', 'successor'], 'the call');
    const who = this.requireAdmin(input.actor, 'only a tenant administrator records a departure');
    const person = this.person(input.person); const succ = this.person(input.successor);
    need(person && person.role === 'custodian' && !person.departed, 'bad_person', 'person must be a custodian who is still here');
    need(succ && succ.role === 'custodian' && !succ.departed && succ.id !== person.id, 'bad_custodian', 'the successor must be another custodian who is still here');
    const held = [...this.s.agents.values()].filter((a) => a.custodian === person.id && this.live(a));
    const fresh = held.filter((a) => !this.openFor(a.id, 'transfer', { to: succ.id }));
    need(this.s.proposals.length + fresh.length <= LIMITS.proposals, 'workspace_full', `a workspace keeps at most ${LIMITS.proposals} proposals: Reset`, 409);
    need(fresh.every((a) => this.s.proposals.filter((p) => OPEN.has(p.status) && p.agentId === a.id).length < LIMITS.openPerAgent), 'too_many_open', 'an agent has too many open proposals', 409);
    person.departed = true;
    this.audit('custodian.departed', who, { person: person.id, successor: succ.id, agents: held.length });
    // The departure triggers the transfers (the system proposes), so any administrator may approve each one. Needing approval at all is a lab reading, not the deck.
    const created = fresh.map((a) => this.makeProposal(SUCCESSION, a, 'transfer', { to: succ.id }, 'succession: the custodian left', { succession: true, recordedBy: who }).id);
    return { person: person.id, successor: succ.id, proposals: created, alreadyOpen: held.length - fresh.length };
  }

  // ---------- certification campaign (slides 18 and 58; clock-free) -----------------------------------------------------------------------
  campaign() { return this.s.campaigns.find((c) => c.status === 'open') || null; }
  itemFor(p) { for (const c of this.s.campaigns) { const i = c.items.find((x) => x.proposalId === p.id); if (i) return i; } return null; }
  releaseItem(p) {
    const i = this.itemFor(p);
    if (i && i.status === 'revoke-proposed') { i.proposalId = null; i.status = i.escalated ? 'escalated' : (this.campaign() ? 'pending' : 'escalated'); if (i.status === 'escalated') i.escalated = true; }
  }

  startCampaign(input) {
    strictKeys(input, ['actor', 'action'], 'the call');
    const who = this.requireAdmin(input.actor, 'only a tenant administrator runs a certification campaign');
    need(input.action === 'start' || input.action === 'close', 'bad_action', 'action must be start or close');
    const open = this.campaign();
    if (input.action === 'start') {
      need(!open, 'campaign_open', 'a campaign is already open', 409);
      need(this.s.campaigns.length < LIMITS.campaigns, 'workspace_full', `a workspace keeps at most ${LIMITS.campaigns} campaigns: Reset`, 409);
      const c = { id: `camp-${pad(++this.s.seq.campaign)}`, status: 'open', startedBy: who, closedBy: null, items: [] };
      for (const a of this.s.agents.values()) {
        if (!this.live(a)) continue;
        const cust = a.custodian ? this.s.people.get(a.custodian) : null;
        const orphan = !cust || cust.departed;
        c.items.push({ id: `ci-${pad(++this.s.seq.item)}`, agentId: a.id, custodian: orphan ? null : cust.id, status: orphan ? 'escalated' : 'pending', escalated: orphan, proposalId: null, decidedBy: null, comment: '' });
      }
      this.s.campaigns.push(c);
      this.audit('campaign.started', who, { campaign: c.id, items: c.items.length, escalatedAtStart: c.items.filter((i) => i.escalated).length });
      return { campaign: c.id, items: c.items.length };
    }
    need(open, 'no_open_campaign', 'there is no open campaign', 409);
    const esc = open.items.filter((i) => i.status === 'pending');
    for (const i of esc) { i.status = 'escalated'; i.escalated = true; }
    open.status = 'closed'; open.closedBy = who;
    this.audit('campaign.closed', who, { campaign: open.id, escalated: esc.length });
    return { campaign: open.id, escalated: esc.length };
  }

  decideItem(input) {
    strictKeys(input, ['actor', 'itemId', 'decision', 'comment'], 'the decision');
    const who = this.actor(input.actor);
    let item = null; let camp = null;
    if (isStr(input.itemId)) for (const c of this.s.campaigns) { const i = c.items.find((x) => x.id === input.itemId); if (i) { item = i; camp = c; } }
    need(item, 'unknown_item', 'no such certification item', 404);
    need(input.decision === 'certify' || input.decision === 'revoke', 'bad_decision', 'decision must be certify or revoke');
    const comment = input.comment === undefined ? '' : (need(typeof input.comment === 'string', 'bad_comment', 'comment must be text'), cleanFree(input.comment, LIMITS.comment));
    need(item.status === 'pending' || item.status === 'escalated', 'item_not_open', 'that item is already decided', 409);
    if (item.status === 'pending') {
      need(camp.status === 'open', 'campaign_closed', 'the custodians\' window is closed', 409);
      if (who.id !== item.custodian) { this.audit('refused:not_the_custodian', who.id, { item: item.id }); throw refuse('not_the_custodian', 'only the agent\'s custodian decides a pending item', 403); }
    } else if (who.role !== 'admin') { this.audit('refused:admin_only', who.id, { item: item.id }); throw refuse('admin_only', 'an escalated item is decided by a tenant administrator', 403); }
    const a = this.agent(item.agentId);
    if (input.decision === 'certify') {
      item.status = 'certified'; item.decidedBy = who.id; item.comment = comment;
      this.audit('certification.certified', who.id, { item: item.id, agentId: a.id });
      return { itemId: item.id, status: item.status };
    }
    // A revoke changes what the agent can do, so it goes through the same propose -> approve -> execute path.
    need(this.live(a), 'agent_not_live', 'that agent is gone or deleted', 409);
    const params = this.validateKind(a, 'revoke-access', {});
    const p = this.makeProposal(who.id, a, 'revoke-access', params, `certification ${camp.id}: access revoked`, { item: item.id });
    item.status = 'revoke-proposed'; item.proposalId = p.id; item.decidedBy = who.id; item.comment = comment;
    this.audit('certification.revoke-proposed', who.id, { item: item.id, proposal: p.id });
    // An administrator's revoke of an escalated item runs at once (administrators act immediately); a custodian's revoke waits for an administrator.
    if (who.role === 'admin') {
      p.status = 'approved'; p.decidedBy = who.id; p.decision = 'administrator-immediate';
      this.audit('proposal.approved', who.id, { proposal: p.id, agentId: a.id, immediate: true });
      this.performProposal(p, who.id);
    }
    return { itemId: item.id, status: item.status, proposalId: p.id };
  }

  // ---------- private-network discovery (slides 35 and 45) --------------------------------------------------------------------------------
  setPrivateTenant(input) {
    strictKeys(input, ['actor', 'enabled'], 'the call');
    const who = this.requireAdmin(input.actor, 'only a tenant administrator changes the tenant\'s private-network setting');
    need(typeof input.enabled === 'boolean', 'bad_value', 'enabled must be true or false');
    this.s.privateNetwork.tenantEnabled = input.enabled;
    this.audit('private-network.tenant', who, { enabled: input.enabled });
    return { tenantEnabled: input.enabled };
  }

  checkConnection(c, { creating }) {
    const fields = creating ? ['name', 'sources', 'scopeIds', 'enabled', 'scannerId', 'scannerRunsIn'] : ['name', 'sources', 'scopeIds', 'enabled', 'scannerRunsIn'];
    strictKeys(c, fields, 'the connection');
    const out = {};
    if (creating || c.name !== undefined) { need(typeof c.name === 'string', 'bad_name', 'name must be text'); out.name = cleanFree(c.name, LIMITS.name); need(out.name.length > 0, 'bad_name', 'name must not be empty'); }
    if (creating || c.sources !== undefined) {
      need(Array.isArray(c.sources) && c.sources.length >= 1 && c.sources.length <= LIMITS.sources && new Set(c.sources).size === c.sources.length && c.sources.every((x) => typeof x === 'string' && PRIVATE_NETWORK_SOURCES.includes(x)), 'bad_sources', 'sources must be a list of bedrock, agentcore or lex');
      out.sources = [...c.sources];
    }
    if (creating || c.scopeIds !== undefined) {
      need(Array.isArray(c.scopeIds) && c.scopeIds.length >= 1 && c.scopeIds.length <= LIMITS.scopeIds && new Set(c.scopeIds).size === c.scopeIds.length && c.scopeIds.every((x) => typeof x === 'string' && Object.hasOwn(SCOPE, x) && SCOPE[x].cloud === 'aws'), 'bad_scopes', 'scopeIds must be a list of AWS accounts');
      out.scopeIds = [...c.scopeIds];
    }
    if (creating || c.enabled !== undefined) { need(typeof c.enabled === 'boolean', 'bad_value', 'enabled must be true or false'); out.enabled = c.enabled; }
    if (creating || c.scannerRunsIn !== undefined) {
      const r = c.scannerRunsIn;
      need(isObj(r) && Object.keys(r).every((k) => k === 'kind' || k === 'id') && typeof r.kind === 'string' && SCANNER_KINDS.includes(r.kind) && typeof r.id === 'string' && SCANNER_ID[r.kind].test(r.id) && (r.kind === 'azure-subscription' || cleanFree(r.id) === r.id), 'bad_scanner_location', 'scannerRunsIn is { kind: aws-account, azure-subscription or gcp-project, id in that form }');
      out.scannerRunsIn = { kind: r.kind, id: r.id };
    }
    if (creating) { need(isStr(c.scannerId, 30) && /^[a-z0-9-]+$/.test(c.scannerId) && cleanFree(c.scannerId) === c.scannerId, 'bad_scanner', 'scannerId must be lowercase letters, digits and dashes'); out.scannerId = c.scannerId; }
    return out;
  }

  addConnection(input) {
    strictKeys(input, ['actor', 'connection'], 'the call');
    const who = this.requireAdmin(input.actor, 'only a tenant administrator adds a connection');
    const pn = this.s.privateNetwork;
    need(pn.tenantEnabled, 'private_network_disabled', 'the tenant has not enabled Private network connections', 409);
    const c = this.checkConnection(input.connection, { creating: true });
    need(pn.connections.length < LIMITS.connections, 'workspace_full', `a workspace keeps at most ${LIMITS.connections} connections: Reset`, 409);
    const peer = pn.connections.find((x) => x.scannerId === c.scannerId);
    need(!peer || (peer.scannerRunsIn.kind === c.scannerRunsIn.kind && peer.scannerRunsIn.id === c.scannerRunsIn.id), 'scanner_location_mismatch', 'every connection one Scanner serves runs in the same place', 409);
    const conn = { id: `conn-${pad(++this.s.seq.conn, 3)}`, ...c };
    pn.connections.push(conn);
    this.audit('private-network.connection-added', who, { connection: conn.id, enabled: conn.enabled });
    return { connectionId: conn.id, enabled: conn.enabled };
  }

  updateConnection(input) {
    strictKeys(input, ['actor', 'connectionId', 'connection'], 'the call');
    const who = this.requireAdmin(input.actor, 'only a tenant administrator edits a connection');
    const pn = this.s.privateNetwork;
    const conn = isStr(input.connectionId) ? pn.connections.find((c) => c.id === input.connectionId) : null;
    need(conn, 'unknown_connection', 'no such connection', 404);
    const patch = this.checkConnection(input.connection, { creating: false });
    need(patch.enabled === undefined || patch.enabled === conn.enabled, 'enabled_is_fixed', 'Enabled is fixed once the connection is added: add a new connection instead', 409);
    if (patch.scannerRunsIn) {
      const shared = pn.connections.some((x) => x.id !== conn.id && x.scannerId === conn.scannerId);
      need(!shared || (patch.scannerRunsIn.kind === conn.scannerRunsIn.kind && patch.scannerRunsIn.id === conn.scannerRunsIn.id), 'scanner_location_shared', 'other connections share this Scanner: they must all run in the same place', 409);
    }
    const { enabled, ...rest } = patch;
    Object.assign(conn, rest);
    this.audit('private-network.connection-updated', who, { connection: conn.id, fields: Object.keys(rest) });
    return { connectionId: conn.id };
  }

  // The connector (Workload Connector) polls OUTBOUND through the proxy. The lab makes no network call: this writes the simulated poll log.
  connectorPoll(input) {
    strictKeys(input, ['actor'], 'the call');
    const who = this.requireAdmin(input.actor, 'only a tenant administrator runs the connector');
    const pn = this.s.privateNetwork;
    need(pn.tenantEnabled, 'private_network_disabled', 'the tenant has not enabled Private network connections', 409);
    const live = pn.connections.filter((c) => c.enabled);
    need(live.length > 0, 'no_enabled_connection', 'no enabled connection to poll for', 409);
    for (const c of live) {
      const entry = { n: ++this.s.seq.poll, connection: c.id, direction: 'outbound', via: 'proxy.lab.example', to: 'controller.lab.example', scannerRunsIn: clone(c.scannerRunsIn), asked: 'any scan work for me?' };
      pn.polls.push(entry); if (pn.polls.length > LIMITS.polls) { pn.polls.shift(); this.s.dropped.polls += 1; }
      this.hop(`Workload Connector dials OUT through the proxy (illustration, never sent)`, { method: 'POST', url: 'https://controller.lab.example/connector/poll', headers: { via: 'proxy.lab.example' }, body: { connection: c.id } }, { status: 200, body: { work: 'scan on the next sync' } });
    }
    this.audit('private-network.poll', who, { connections: live.length });
    return { polled: live.length };
  }

  // ---------- gateways ------------------------------------------------------------------------------------------------------------------------------
  gateway(id, action) {
    need(isObj(action), 'bad_action', 'the action must be an object');
    return gatewayAction(this, id, action);
  }

  // ---------- the snapshot --------------------------------------------------------------------------------------------------------------------------
  agentView(a, ctx) {
    const assessment = assess(a, ctx);
    const cust = a.custodian ? this.s.people.get(a.custodian) : null;
    const reasons = [];
    if (this.live(a)) {
      if (!a.custodian) reasons.push('orphaned');
      else if (cust?.departed) reasons.push('custodian-departed');
      if (assessment.level >= 4) reasons.push('risk-high');
      if (a.status === 'unknown') reasons.push('status-unknown');
    }
    const src = SOURCE[a.source];
    return {
      id: a.id, name: a.name, source: a.source, sourceName: src.name, scope: a.scope, scopeLabel: SCOPE[a.scope].label, model: a.model, modelDeprecated: Object.hasOwn(MODELS, a.model) && MODELS[a.model].deprecated,
      config: a.config, identity: { name: a.identity.name, kind: a.identity.kind, surface: src.surface, permissions: a.identity.permissions.map((p) => ({ ...p, inert: (a.quarantined || a.revoked || (p.viaCredential && !a.credentials.some((c) => c.id === p.viaCredential && c.enabled))) ? true : false })) },
      tools: a.tools, knowledgeBases: a.knowledgeBases, guardrails: a.config.guardrail ? [a.config.guardrail] : [], credentials: a.credentials, bindings: a.bindings, subAgents: a.subAgents, flows: a.flows, tags: a.tags, card: a.card,
      custodian: a.custodian, custodianDeparted: !!cust?.departed, status: a.status, quarantined: a.quarantined, revoked: a.revoked, discoveredAtRun: a.discoveredAtRun, lastSeenRun: a.lastSeenRun, discoveredVia: a.discoveredVia, classification: a.classification,
      rev: a.rev, assessment, actionRequired: reasons, canDelete: src.delete, canQuarantine: src.quarantine,
    };
  }

  snapshot() {
    const s = this.s;
    const all = [...s.agents.values()];
    const ctx = buildContext(all, new Set([...s.people.values()].filter((x) => x.departed).map((x) => x.id)));
    const agents = all.map((a) => this.agentView(a, ctx));
    const liveAgents = agents.filter((a) => a.status === 'active' || a.status === 'unknown');
    const lastRun = s.runs[s.runs.length - 1] || null;
    const newest = Math.max(0, ...agents.map((a) => a.discoveredAtRun));
    const byLevel = Object.fromEntries([1, 2, 3, 4, 5].map((l) => [l, liveAgents.filter((a) => a.assessment.level === l).length]));
    const gws = s.gateways;
    return {
      agents,
      summary: {
        total: agents.length, live: liveAgents.length,
        byStatus: Object.fromEntries(['active', 'unknown', 'gone', 'deleted'].map((k) => [k, agents.filter((a) => a.status === k).length])),
        bySource: SOURCES.map((x) => ({ source: x.id, name: x.name, count: liveAgents.filter((a) => a.source === x.id).length })),
        byLevel, orphaned: liveAgents.filter((a) => a.actionRequired.includes('orphaned')).length,
        actionRequired: liveAgents.filter((a) => a.actionRequired.length).length, recentlyDiscovered: agents.filter((a) => a.discoveredAtRun === newest && newest > 0).map((a) => a.id),
        newestRun: newest, openProposals: s.proposals.filter((p) => OPEN.has(p.status)).length,
      },
      roster: [...s.people.values()].map((p) => ({ id: p.id, role: p.role, departed: p.departed, agents: all.filter((a) => a.custodian === p.id && this.live(a)).length })),
      proposals: s.proposals.map((p) => ({ ...p })), audit: [...s.audit, ...s.refusals].sort((x, y) => x.n - y.n).map((a) => ({ ...a })),
      auditInfo: { cap: LIMITS.audit, used: s.audit.length, refusalsKept: s.refusals.length, refusalsCap: LIMITS.refusals, refusalsDropped: s.dropped.refusals, runsDropped: s.dropped.runs, pollsDropped: s.dropped.polls, room: LIMITS.audit - s.audit.length },
      campaign: s.campaigns.length ? clone(s.campaigns[s.campaigns.length - 1]) : null, campaigns: s.campaigns.length,
      sync: { runs: s.runs.map((r) => clone(r)), last: lastRun ? clone(lastRun) : null },
      org: { id: ORG_ID, onboardedOus: [...s.onboardedOus], ous: OUS, accounts: this.accountsView() },
      provider: { present: [...s.world.present], released: s.world.released },
      privateNetwork: {
        tenantEnabled: s.privateNetwork.tenantEnabled, connections: clone(s.privateNetwork.connections), polls: clone(s.privateNetwork.polls),
        connector: { direction: 'outbound', polls: s.privateNetwork.polls.length, outbound: s.privateNetwork.polls.filter((p) => p.direction === 'outbound').length, inbound: s.privateNetwork.polls.filter((p) => p.direction !== 'outbound').length },
        discovered: agents.filter((a) => a.discoveredVia.path === 'workload-scanner').map((a) => ({ id: a.id, name: a.name, source: a.source, scope: a.scope, scannerRunsIn: a.discoveredVia.scannerRunsIn, findings: a.assessment.findings.length })),
        privateScopes: SCOPES.filter((c) => c.reach === 'private').map((c) => ({ id: c.id, label: c.label })),
      },
      gateways: gws.map((g) => ({ ...clone(g), scorecard: scorecard(g) })), agentCore: metadata(gws, s.orphanEngines),
    };
  }
}

export { FINDINGS, levelOf };
