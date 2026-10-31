// Governing the AgentCore gateway itself (slides 35 and 45): the gateway is an object of policy, not just a route. Operations: enable or disable a tool
// target, switch the WAF failure mode, close a bypass route, pin an endpoint, end a session, flip log-only to enforcing (typed confirmation).
// Swagger names (modelAgentCoreAccountMetadata, console swagger 2026-10-31, SCHEMA ONLY): GatewayBypassPostureJSON, GatewayCallerAccessJSON,
// GatewayDetailJSON, GatewayEnginesJSON, GatewayScorecardJSON, BypassDiffJSON, RuntimeCallerAccessJSON, TargetCallerAccessJSON, Truncated.
// The schema gives only each field's NAME and a prose description; every inner shape below is LAB-INVENTED (the schema gives only the field name).
// The twelve scorecard checks are the ones the swagger description lists; the rule for each check is the lab's reading.
import { refuse } from './errors.js';
import { cleanFree } from './credentials.js';
import { isReservedHost } from './safety.js';

export const WAF_MODES = ['fail-open', 'fail-closed'];
export const ENGINE_MODES = ['LOG_ONLY', 'ENFORCE'];
export const GATEWAY_ACTIONS = ['set-target', 'set-waf', 'close-bypass', 'pin-endpoint', 'end-session', 'set-enforcement'];
export const CHECKS = [
  ['authorizer', 'Authorizer'], ['audience-pinning', 'Audience pinning'], ['enforcement', 'Enforcement'], ['policy-scope', 'Policy scope'],
  ['enforcement-health', 'Enforcement health'], ['caller-pinning', 'Caller pinning'], ['throttling', 'Throttling'], ['waf', 'WAF'],
  ['egress-privacy', 'Egress privacy'], ['content-checks', 'Content checks'], ['bypass-closed', 'Bypass closed'], ['network-paths', 'Network paths'],
];
export const TRUNCATE_AT = 24_000; // lab-invented: the "wire limit" for the Truncated flag (bytes of JSON in the account snapshot)

const isStr = (v, max = 80) => typeof v === 'string' && v.length > 0 && v.length <= max;
const has = (list, id) => typeof id === 'string' && list.some((x) => x.id === id);

export function seedGateways(cast) {
  const mk = (n, name, extra) => ({
    id: `gw-lab-0${n}`, name, status: 'READY',
    authorizer: { type: 'JWT', discoveryUrl: `https://idp.${cast.castHost}.example/.well-known/openid-configuration`, audiences: [`${name}-clients`] },
    engine: { id: `eng-lab-0${n}`, mode: 'LOG_ONLY', status: 'ACTIVE', policyCount: 4 },
    wafFailureMode: 'fail-open', rateLimit: 100, egress: 'private', contentChecks: true, kmsKey: `kms-lab-0${n}`, pinnedEndpoint: null,
    targets: [{ id: 'tg-1', name: 'orders-tool', enabled: true, tools: 6 }, { id: 'tg-2', name: 'payments-tool', enabled: true, tools: 3 }, { id: 'tg-3', name: 'search-tool', enabled: true, tools: 2 }],
    sessions: [{ id: 's-0001', principal: `role-lab-agentcore-0${n}` }, { id: 's-0002', principal: 'role-lab-batch-job' }, { id: 's-0003', principal: cast.castCustodian }],
    runtimes: [
      { id: 'rt-1', name: `${name}-runtime`, networkMode: 'PUBLIC', authorizer: 'IAM', jwtGatewayPin: false, resourcePolicy: 'direct-allowed', callers: [{ principal: `role-lab-agentcore-0${n}`, viaGateway: true, direct: true }, { principal: 'role-lab-batch-job', viaGateway: false, direct: true }] },
      { id: 'rt-2', name: `${name}-worker`, networkMode: 'VPC', authorizer: 'IAM', jwtGatewayPin: true, resourcePolicy: 'gateway-only', callers: [{ principal: `role-lab-agentcore-0${n}`, viaGateway: true, direct: false }] },
    ],
    cedar: [{ principal: `role-lab-agentcore-0${n}`, target: 'tg-1', tools: ['lookup-order', 'list-orders'] }, { principal: '*', target: 'tg-3', tools: ['search'] }, { principal: 'role-lab-batch-job', target: 'tg-2', tools: ['post-payment'] }],
    ...extra,
  });
  return [mk(1, `${cast.castDomain1}-gateway`, {}), mk(2, `${cast.castDomain2}-gateway`, { wafFailureMode: 'fail-closed', engine: { id: 'eng-lab-02', mode: 'ENFORCE', status: 'ACTIVE', policyCount: 6 }, pinnedEndpoint: `https://gw2.${cast.castHost}.example` })];
}
// An engine attached to no gateway is drift (swagger GatewayEnginesJSON description); the lab seeds one.
export const seedOrphanEngines = () => [{ id: 'eng-lab-99', status: 'ACTIVE', policyCount: 2 }];

// ---------- scorecard and blobs ----------------------------------------------------------------------------------------------------------------------
export function bypassOpen(rt) { return rt.resourcePolicy !== 'gateway-only' || rt.callers.some((c) => c.direct); }
export function bypassDiff(gw) {
  return gw.runtimes.map((rt) => ({
    runtime: rt.id,
    gatewayMediated: rt.callers.filter((c) => c.direct && c.viaGateway).map((c) => c.principal),
    bypassOnly: rt.callers.filter((c) => c.direct && !c.viaGateway).map((c) => c.principal),
  }));
}
export function scorecard(gw) {
  const t = (id, green, why) => ({ id, name: CHECKS.find((c) => c[0] === id)[1], green, why });
  const checks = [
    t('authorizer', gw.authorizer.type === 'JWT', gw.authorizer.type === 'JWT' ? 'a JWT authorizer is configured' : 'no JWT authorizer'),
    t('audience-pinning', gw.authorizer.audiences.length > 0 && !gw.authorizer.audiences.includes('*'), 'allowed audiences are listed and none is a wildcard'),
    t('enforcement', gw.engine.mode === 'ENFORCE', `the policy engine is in ${gw.engine.mode}`),
    t('policy-scope', gw.engine.policyCount > 0, `${gw.engine.policyCount} policies are attached`),
    t('enforcement-health', gw.engine.status === 'ACTIVE', `the engine is ${gw.engine.status}`),
    t('caller-pinning', gw.pinnedEndpoint !== null, gw.pinnedEndpoint ? 'the gateway endpoint is pinned' : 'the gateway endpoint is not pinned (lab reading of "caller pinning")'),
    t('throttling', gw.rateLimit > 0, gw.rateLimit > 0 ? `a rate limit of ${gw.rateLimit} per minute is set` : 'no rate limit'),
    t('waf', gw.wafFailureMode === 'fail-closed', `the WAF fails ${gw.wafFailureMode === 'fail-closed' ? 'closed' : 'open'}`),
    t('egress-privacy', gw.egress === 'private', `egress is ${gw.egress}`),
    t('content-checks', gw.contentChecks === true, gw.contentChecks ? 'content checks are on' : 'content checks are off'),
    t('bypass-closed', gw.runtimes.every((r) => !bypassOpen(r)), gw.runtimes.some(bypassOpen) ? `bypass open on ${gw.runtimes.filter(bypassOpen).map((r) => r.id).join(', ')}` : 'no runtime can be called around the gateway'),
    t('network-paths', gw.runtimes.every((r) => r.networkMode === 'VPC'), gw.runtimes.some((r) => r.networkMode !== 'VPC') ? `public network mode on ${gw.runtimes.filter((r) => r.networkMode !== 'VPC').map((r) => r.id).join(', ')}` : 'every runtime is on a private network'),
  ];
  return { gateway: gw.id, checks, greenCount: checks.filter((c) => c.green).length, total: checks.length };
}

// The nine modelAgentCoreAccountMetadata fields (names from the schema; shapes lab-invented). In the real schema each is a string of JSON text.
export function metadata(gateways, orphanEngines) {
  const m = {
    GatewayDetailJSON: gateways.map((g) => ({ gateway: g.id, name: g.name, status: g.status, authorizer: g.authorizer, policyEngine: { id: g.engine.id, mode: g.engine.mode, status: g.engine.status }, wafFailureMode: g.wafFailureMode, kmsKey: g.kmsKey, pinnedEndpoint: g.pinnedEndpoint, rateLimit: g.rateLimit })),
    GatewayEnginesJSON: [...gateways.map((g) => ({ id: g.engine.id, status: g.engine.status, policyCount: g.engine.policyCount, attachments: [{ gateway: g.id, mode: g.engine.mode }], orphaned: false })), ...orphanEngines.map((e) => ({ ...e, attachments: [], orphaned: true }))],
    GatewayScorecardJSON: gateways.map(scorecard),
    GatewayBypassPostureJSON: gateways.flatMap((g) => g.runtimes.map((r) => ({ gateway: g.id, runtime: r.id, networkMode: r.networkMode, authorizer: r.authorizer, jwtGatewayPin: r.jwtGatewayPin, resourcePolicy: r.resourcePolicy, bypassOpen: bypassOpen(r) }))),
    GatewayCallerAccessJSON: gateways.map((g) => ({ gateway: g.id, principals: [...new Set(g.runtimes.flatMap((r) => r.callers.filter((c) => c.viaGateway).map((c) => c.principal)))].map((p) => ({ principal: p, action: 'bedrock-agentcore:InvokeGateway', decision: 'allow' })) })),
    RuntimeCallerAccessJSON: gateways.flatMap((g) => g.runtimes.map((r) => ({ gateway: g.id, runtime: r.id, direct: r.callers.filter((c) => c.direct).map((c) => ({ principal: c.principal, action: 'bedrock-agentcore:InvokeAgentRuntime', decision: 'allow' })) }))),
    BypassDiffJSON: gateways.map((g) => ({ gateway: g.id, runtimes: bypassDiff(g) })),
    TargetCallerAccessJSON: gateways.map((g) => ({ gateway: g.id, targets: g.targets.map((t) => ({ target: t.id, enabled: t.enabled, principals: t.enabled ? g.cedar.filter((c) => c.target === t.id).map((c) => ({ principal: c.principal, tools: c.tools })) : [] })) })),
  };
  m.Truncated = JSON.stringify(m).length > TRUNCATE_AT;
  return m;
}

// ---------- operations -------------------------------------------------------------------------------------------------------------------------------
const pick = (e, id) => {
  const g = typeof id === 'string' ? e.s.gateways.find((x) => x.id === id) : null;
  if (!g) throw refuse('unknown_gateway', 'no such gateway', 404);
  return g;
};

// One dispatch. `a` is { actor, kind, ... } already known to be an object. Returns { before, after, ... } with the fields the visitor needs.
export function gatewayAction(e, gatewayId, a) {
  const allowed = { 'set-target': ['target', 'enabled'], 'set-waf': ['mode', 'confirm'], 'close-bypass': ['runtime'], 'pin-endpoint': ['endpoint'], 'end-session': ['session'], 'set-enforcement': ['mode', 'confirm'] };
  if (typeof a.kind !== 'string' || !Object.hasOwn(allowed, a.kind)) throw refuse('bad_action', 'kind must be one of the gateway actions');
  if (!Object.keys(a).every((k) => ['actor', 'kind', ...allowed[a.kind]].includes(k))) throw refuse('unknown_field', 'the action carries a field the lab does not take');
  const who = e.requireAdmin(a.actor, 'the gateway is an object of policy: only a tenant administrator changes it (lab reading)');
  const g = pick(e, gatewayId);
  const before = scorecard(g).greenCount;
  const typed = (expected) => { if (typeof a.confirm !== 'string' || a.confirm !== expected) throw refuse('confirmation_mismatch', 'the typed confirmation does not match the gateway name; nothing changed', 403); };
  let result;
  if (a.kind === 'set-target') {
    const t = typeof a.target === 'string' ? g.targets.find((x) => x.id === a.target) : null;
    if (!t) throw refuse('unknown_target', 'no such tool target', 404);
    if (typeof a.enabled !== 'boolean') throw refuse('bad_value', 'enabled must be true or false');
    if (t.enabled === a.enabled) throw refuse('already_in_state', 'the target is already in that state', 409);
    t.enabled = a.enabled; result = { target: t.id, enabled: t.enabled, effect: t.enabled ? 'the target is callable again' : 'the target answers no calls and lists no principals' };
  } else if (a.kind === 'set-waf') {
    if (!WAF_MODES.includes(a.mode)) throw refuse('bad_value', 'mode must be fail-open or fail-closed');
    if (g.wafFailureMode === a.mode) throw refuse('already_in_state', 'the WAF is already in that failure mode', 409);
    if (a.mode === 'fail-closed') typed(g.name);
    g.wafFailureMode = a.mode; result = { wafFailureMode: g.wafFailureMode };
  } else if (a.kind === 'set-enforcement') {
    if (!ENGINE_MODES.includes(a.mode)) throw refuse('bad_value', 'mode must be LOG_ONLY or ENFORCE');
    if (g.engine.mode === a.mode) throw refuse('already_in_state', 'the policy engine is already in that mode', 409);
    if (a.mode === 'ENFORCE') typed(g.name);
    g.engine.mode = a.mode; result = { engineMode: g.engine.mode };
  } else if (a.kind === 'close-bypass') {
    const r = typeof a.runtime === 'string' ? g.runtimes.find((x) => x.id === a.runtime) : null;
    if (!r) throw refuse('unknown_runtime', 'no such runtime', 404);
    if (!bypassOpen(r)) throw refuse('already_in_state', 'that bypass route is already closed', 409);
    const diffBefore = bypassDiff(g).find((d) => d.runtime === r.id);
    r.callers = r.callers.map((c) => ({ ...c, direct: false })); r.resourcePolicy = 'gateway-only'; r.jwtGatewayPin = true;
    const diffAfter = bypassDiff(g).find((d) => d.runtime === r.id);
    // The principals whose ONLY path was the bypass now have no path at all: the remediation list the swagger describes for BypassDiffJSON.
    const lockedOut = r.callers.filter((c) => !c.viaGateway).map((c) => c.principal);
    result = { runtime: r.id, bypassDiff: { before: diffBefore, after: diffAfter }, lockedOut };
  } else if (a.kind === 'pin-endpoint') {
    const host = (() => { try { const u = new URL(String(a.endpoint)); return u.protocol === 'https:' && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash && !u.port ? u.hostname : null; } catch { return null; } })();
    if (!isStr(a.endpoint, 120) || !host || !isReservedHost(host) || cleanFree(a.endpoint, 120) !== a.endpoint) throw refuse('bad_endpoint', 'endpoint must be an https URL on a .example or .invalid host, with no path, port or credentials');
    if (g.pinnedEndpoint === `https://${host}`) throw refuse('already_in_state', 'that endpoint is already pinned', 409);
    g.pinnedEndpoint = `https://${host}`; result = { pinnedEndpoint: g.pinnedEndpoint };
  } else if (a.kind === 'end-session') {
    const i = typeof a.session === 'string' ? g.sessions.findIndex((x) => x.id === a.session) : -1;
    if (i < 0) throw refuse('unknown_session', 'no such session', 404);
    const [s] = g.sessions.splice(i, 1); result = { ended: s.id, principal: s.principal };
  }
  const after = scorecard(g).greenCount;
  e.audit(`gateway:${a.kind}`, who, { gateway: g.id, ...result, scorecardBefore: before, scorecardAfter: after });
  e.hop(`lab controller to the AgentCore control API (illustration, never sent): ${a.kind}`, { method: 'POST', url: `https://control.agentcore.lab.example/gateways/${g.id}/${a.kind}`, body: { by: who } }, { status: 200, body: { ok: true } });
  return { gateway: g.id, kind: a.kind, ...result, scorecard: { before, after, total: 12 } };
}
