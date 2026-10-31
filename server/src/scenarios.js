// Scripted scenarios: data (with names from the cast) run through the real engine. The Mock tables are generated from this by
// `npm run mock-table`, so Mock cannot show anything the engine would not do (a doctor check and a test fail on drift).
import { Engine } from './engine.js';
import { VERTICALS } from './cast.js';
import { perform } from './actions.js';

const prop = (actor, agentId, kind, params = {}, reason = '') => ({ op: 'propose', params: { actor, agentId, kind, params, reason } });
const decide = (actor, proposalId, decision = 'approve') => ({ op: 'decide', params: { actor, proposalId, decision } });
const run = (actor, proposalId) => ({ op: 'execute', params: { actor, proposalId } });
const gw = (actor, gatewayId, action) => ({ op: 'gateway', params: { gatewayId, action: { actor, ...action } } });

export function scenarioList(c) {
  const A = c.castAdmin; const A2 = c.castAdmin2; const C = c.castCustodian; const C2 = c.castCustodian2; const C3 = c.castCustodian3; const G1 = `${c.castDomain1}-gateway`;
  return [
    { id: 'first-scan', title: 'The first scan: one inventory across thirteen sources', say: 'Twenty-three agents are discovered across AWS, Google, Azure and three SaaS platforms (three more sit behind a private network or in an organizational unit that is not onboarded yet). Some have no custodian, some are public and unauthenticated, some hold administrator grants.', steps: [] },
    {
      id: 'discover', title: 'A second scan finds new agents and a new account',
      say: 'Between scans, agents are created in cloud consoles and a new AWS account appears in an onboarded organizational unit. The next sync discovers them. Onboarding the sandbox OU brings its account in at the following sync.',
      steps: [
        { say: 'The second sync discovers three new agents (one has no owner hint, so it arrives orphaned) and onboards the new account in the production OU automatically.', op: 'sync', params: {} },
        { say: `${A} adds the sandbox organizational unit to the onboarding scope.`, op: 'onboarding', params: { actor: A, ous: ['ou-lab-prod', 'ou-lab-sandbox'] } },
        { say: 'The next sync enumerates the sandbox account and discovers its agent.', op: 'sync', params: {} },
      ],
    },
    {
      id: 'approval', title: 'A custodian proposes, an administrator approves, then it runs',
      say: 'Every custodian action needs approval from a tenant administrator before it executes. Self-approval, a custodian approving, approving too early and an unsupported delete are all refused, and the audit log names the acting user each time.',
      steps: [
        { say: `${C} proposes quarantining ${`ag-bedrock-02`}, a reconciler that holds an administrator grant.`, ...prop(C, 'ag-bedrock-02', 'quarantine', {}, 'Administrator grant on a reconciler') },
        { say: `${C} tries to approve it: only a tenant administrator can.`, ...decide(C, 'prop-0001') },
        { say: `${A} proposes a retag of another agent, then tries to approve it too: nobody approves their own proposal.`, ...prop(A, 'ag-bedrock-01', 'retag', { key: 'data-class', value: 'internal' }) },
        { say: `${A} tries to approve their own proposal.`, ...decide(A, 'prop-0002') },
        { say: 'Running a proposal that is not yet approved is refused.', ...run(C, 'prop-0001') },
        { say: `${A} approves the quarantine.`, ...decide(A, 'prop-0001') },
        { say: `${C} executes it. The agent's identity is detached and its administrator-privilege finding no longer applies.`, ...run(C, 'prop-0001') },
        { say: `${A2} tries to approve it again: it is already decided.`, ...decide(A2, 'prop-0001') },
        { say: `${A} proposes deleting a Databricks agent. The deck says delete is in development there, so it is refused.`, ...prop(A, 'ag-databricks-01', 'delete') },
      ],
    },
    {
      id: 'remediate', title: 'Targeted fixes bring the score down',
      say: 'Strip an unused write role, stop a privileged flow, disable a named credential, close a public endpoint. Each is proposed by the custodian, approved by an administrator and executed; the finding that fired stops firing.',
      steps: [
        { say: 'A custodian proposes stripping one of two unused write grants.', ...prop(C3, 'ag-bedrockflow-01', 'strip-role', { permissionId: 'p2' }, 'Unused write grant') },
        { say: 'Approved by an administrator.', ...decide(A, 'prop-0001') },
        { say: 'Executed.', ...run(C3, 'prop-0001') },
        { say: 'A privileged flow on a Copilot Studio agent is proposed to be stopped.', ...prop(C2, 'ag-copilot-01', 'stop-flow', { flowId: 'f1' }, 'Bulk approve flow is privileged') },
        { say: 'Approved by the other administrator.', ...decide(A2, 'prop-0002') },
        { say: 'Executed.', ...run(C2, 'prop-0002') },
        { say: 'The named credential that carries an administrator scope on an Agentforce agent is proposed to be disabled.', ...prop(C3, 'ag-agentforce-01', 'disable-credential', { credentialId: 'nc1' }, 'System administrator scope') },
        { say: 'Approved.', ...decide(A, 'prop-0003') },
        { say: 'Executed: the permission that rode on it is inert.', ...run(C3, 'prop-0003') },
        { say: 'A public, unauthenticated agent is proposed to be made private.', ...prop(C2, 'ag-agentcore-01', 'reconfigure', { field: 'publicAccess', value: false }, 'Public endpoint without authentication') },
        { say: 'Approved.', ...decide(A2, 'prop-0004') },
        { say: 'Executed.', ...run(C2, 'prop-0004') },
      ],
    },
    {
      id: 'partial-failure', title: 'A provider does not answer: nothing is deleted',
      say: 'An agent is really deleted in a console while one provider is down. The partial run deletes nothing and marks every agent it could not see as unknown, never gone. A clean run afterwards marks the really removed agent as gone and recovers the rest.',
      steps: [
        { say: 'A first sync (it also releases the new agents of the second scan).', op: 'sync', params: {} },
        { say: 'Someone deletes a Lex bot in the AWS console.', op: 'providerChange', params: { agentId: 'ag-lex-01', present: false } },
        { say: 'Sync with Vertex AI not answering (injected timeout). The run is partial: nothing is deleted, the Lex bot and the Vertex agents are unknown, not gone.', op: 'sync', params: { failures: [{ source: 'vertexai', kind: 'timeout' }] } },
        { say: 'Sync again with every provider answering: the Lex bot is now gone, the Vertex agents are recovered.', op: 'sync', params: {} },
        { say: 'A malformed failure (an unknown source) refuses the whole sync.', op: 'sync', params: { failures: [{ source: 'nope', kind: 'timeout' }] } },
      ],
    },
    {
      id: 'gateway', title: 'Governing the gateway itself',
      say: 'Flip log-only to enforcing: a wrong typed confirmation changes nothing, the gateway name does. Close a bypass route and see who was reachable only through it. Disable a target, fail the WAF closed, pin the endpoint, end a session. The scorecard of twelve checks moves each time.',
      steps: [
        { say: `A wrong typed confirmation for the enforcing flip changes nothing.`, ...gw(A, 'gw-lab-01', { kind: 'set-enforcement', mode: 'ENFORCE', confirm: 'wrong name' }) },
        { say: `Typing the gateway name (${G1}) flips the policy engine to enforcing.`, ...gw(A, 'gw-lab-01', { kind: 'set-enforcement', mode: 'ENFORCE', confirm: G1 }) },
        { say: 'Close the bypass route on the public runtime: the before and after bypass diff shows who was only reachable around the gateway.', ...gw(A, 'gw-lab-01', { kind: 'close-bypass', runtime: 'rt-1' }) },
        { say: 'Disable the payments tool target.', ...gw(A, 'gw-lab-01', { kind: 'set-target', target: 'tg-2', enabled: false }) },
        { say: 'Switch the WAF from fail-open to fail-closed (typed confirmation).', ...gw(A, 'gw-lab-01', { kind: 'set-waf', mode: 'fail-closed', confirm: G1 }) },
        { say: 'Pin the gateway endpoint.', ...gw(A, 'gw-lab-01', { kind: 'pin-endpoint', endpoint: `https://gw1.${c.castHost}.example` }) },
        { say: 'End the batch job\'s session.', ...gw(A, 'gw-lab-01', { kind: 'end-session', session: 's-0002' }) },
        { say: 'The WAF is already fail-closed: refused.', ...gw(A, 'gw-lab-01', { kind: 'set-waf', mode: 'fail-closed', confirm: G1 }) },
        { say: `A custodian cannot change the gateway.`, ...gw(C, 'gw-lab-01', { kind: 'set-target', target: 'tg-1', enabled: false }) },
      ],
    },
    {
      id: 'private-network', title: 'Agents inside your own network',
      say: 'A tenant that has not enabled Private network cannot add a connection. Enable it, add a connection whose scanner runs in an AWS account, find that Enabled is fixed once added, let the connector poll outbound, and the next sync discovers the private agents, each carrying where the scanner runs.',
      steps: [
        { say: 'A first sync: the agents in the private network account are not found.', op: 'sync', params: {} },
        { say: 'Adding a connection while the tenant has Private network disabled is refused.', op: 'addConnection', params: { actor: A, connection: { name: 'prod-private', sources: ['bedrock', 'agentcore', 'lex'], scopeIds: ['000000000002'], enabled: true, scannerId: 'scanner-1', scannerRunsIn: { kind: 'aws-account', id: '000000000009' } } } },
        { say: `${A} enables Private network for the tenant.`, op: 'privateTenant', params: { actor: A, enabled: true } },
        { say: 'Add a connection: the Workload Scanner runs in AWS account 000000000009.', op: 'addConnection', params: { actor: A, connection: { name: 'prod-private', sources: ['bedrock', 'agentcore', 'lex'], scopeIds: ['000000000002'], enabled: true, scannerId: 'scanner-1', scannerRunsIn: { kind: 'aws-account', id: '000000000009' } } } },
        { say: 'Try to switch Enabled off: it is fixed once the connection is added.', op: 'updateConnection', params: { actor: A, connectionId: 'conn-001', connection: { enabled: false } } },
        { say: 'The connector polls. It only ever dials out, through the proxy.', op: 'poll', params: { actor: A } },
        { say: 'The next sync scans the private account through the Workload Scanner and discovers its agents with the scanner location on each.', op: 'sync', params: {} },
      ],
    },
    {
      id: 'succession-certify', title: 'A custodian leaves; a certification campaign runs',
      say: 'When a custodian leaves, a transfer is proposed for each agent and an administrator approves each. A campaign asks each custodian to certify or revoke; a revoke goes through approval; unreviewed items escalate to an administrator.',
      steps: [
        { say: `${A} records that ${C2} has left, naming ${C3} as successor. A transfer is proposed for every agent ${C2} held.`, op: 'depart', params: { actor: A, person: C2, successor: C3 } },
        { say: `${A2} approves the first transfer (${A} proposed it, so ${A} could not).`, ...decide(A2, 'prop-0001') },
        { say: 'Executed.', ...run(A2, 'prop-0001') },
        { say: 'Denies the second.', ...decide(A2, 'prop-0002', 'deny') },
        { say: 'Approving after a denial is refused.', ...decide(A2, 'prop-0002') },
        { say: `${A} opens a certification campaign. Agents whose custodian has left start escalated.`, op: 'campaign', params: { actor: A, action: 'start' } },
        { say: `${C} certifies one agent.`, op: 'itemDecision', params: { actor: C, itemId: 'ci-0001', decision: 'certify' } },
        { say: `${C} revokes another agent's access: this is a proposal that still needs approval.`, op: 'itemDecision', params: { actor: C, itemId: 'ci-0002', decision: 'revoke' } },
        { say: `${A} closes the campaign: items nobody reviewed escalate.`, op: 'campaign', params: { actor: A, action: 'close' } },
        { say: 'A custodian cannot decide an escalated item.', op: 'itemDecision', params: { actor: C, itemId: 'ci-0003', decision: 'certify' } },
        { say: 'An administrator can.', op: 'itemDecision', params: { actor: A2, itemId: 'ci-0003', decision: 'certify' } },
      ],
    },
  ];
}

// The result each step must give, in order. 'ok' or the refusal code. A doctor check and a test compare against it.
export const EXPECTED = {
  'first-scan': [],
  discover: ['ok', 'ok', 'ok'],
  approval: ['ok', 'admin_only', 'ok', 'self_approval', 'not_approved', 'ok', 'ok', 'already_decided', 'unsupported_on_source'],
  remediate: Array(12).fill('ok'),
  'partial-failure': ['ok', 'ok', 'ok', 'ok', 'bad_failure'],
  gateway: ['confirmation_mismatch', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'already_in_state', 'admin_only'],
  'private-network': ['ok', 'private_network_disabled', 'ok', 'ok', 'enabled_is_fixed', 'ok', 'ok'],
  'succession-certify': ['ok', 'ok', 'ok', 'ok', 'already_denied', 'ok', 'ok', 'ok', 'ok', 'admin_only', 'ok'],
};

export function runScenario(cast, sc) {
  const e = new Engine(cast);
  const steps = sc.steps.map((st) => { const r = perform(e, st.op, st.params); return { say: st.say, op: st.op, result: r }; });
  return { engine: e, steps };
}

// Everything Mock shows, generated from the engine: per vertical, per scenario, the steps and the final state.
export function buildMockTable() {
  const verticals = {};
  for (const [v, cast] of Object.entries(VERTICALS)) {
    verticals[v] = {
      scenarios: scenarioList(cast).map((sc) => {
        const { engine, steps } = runScenario(cast, sc);
        return { id: sc.id, title: sc.title, say: sc.say, steps: steps.map((s) => ({ say: s.say, op: s.op, ok: s.result.ok, code: s.result.ok ? null : s.result.code, detail: s.result.ok ? null : s.result.detail })), state: engine.snapshot() };
      }),
    };
  }
  return { schema: 'agent-governance-lab-mock-table/1', verticals };
}
