// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the lab.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
// The pack uses .invalid placeholders and no documentation URLs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CAST } from '../server/src/cast.js';
import { buildStory } from '../server/src/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const UNV = 'Ping release claim, UNVERIFIED on our tenant.';

export function buildPack() {
  const story = buildStory(DEFAULT_CAST, 'finance');
  const sid = (n) => `S${String(n).padStart(2, '0')}`;
  const terms = {
    'first-scan': ['platform-agents', 'inventory'], discover: ['inventory', 'org-onboarding', 'safe-sync'], approval: ['custodian-approval', 'custodian'], remediate: ['remediation', 'finding-score'],
    'partial-failure': ['safe-sync'], gateway: ['gateway-governance', 'typed-confirmation'], 'private-network': ['private-network', 'safe-sync'], 'succession-certify': ['succession', 'certification', 'custodian-approval'],
  };
  const why = (id) => story.talkTrack.find((t) => t.id === id).say;
  return {
    schema: 'demo-content-pack/1',
    id: 'agent-governance-lab',
    title: 'Agent Governance LAB',
    version,
    demo: { id: 'agent-governance-lab', name: 'Agent Governance LAB', catalog: 'D105', baseUrl: 'http://localhost:7300', doctor: '/api/health', tags: ['ai-platform-agents', 'inventory', 'custodian', 'approval', 'remediation', 'safe-sync', 'agentcore', 'private-network', 'simulated'] },
    glossary: [
      { id: 'platform-agents', term: 'AI Platform Agents', definition: `Inventory, permission review and remediation for AI agents across thirteen sources (AWS Bedrock Agents, AgentCore, Lex, Bedrock Flows, Google Vertex AI Agent Engine, Agent Builder, Agent Registry, Dialogflow CX, Azure AI Foundry, Copilot Studio, Salesforce Agentforce, Databricks Mosaic AI, Snowflake Cortex AI). Retires the name Workload Agent Discovery & Control. ${UNV}`, aliases: ['Workload Agent Discovery & Control'] },
      { id: 'inventory', term: 'Cross-cloud inventory', definition: `Every agent with its identity, model, configuration and owner, including A2A agent cards from the Google Agent Registry; a dashboard of recently discovered and action-required counts with platform filters and per-agent detail (tools, knowledge bases, guardrails, credentials, bindings, sub-agents). The record shape is lab-invented. ${UNV}`, aliases: ['deep agent anatomy'] },
      { id: 'org-onboarding', term: 'AWS Organizations onboarding by organizational unit', definition: `Member accounts are enumerated and onboarded automatically, scoped by organizational unit. The lab's organization, units and fake account ids (000000000001 style) are invented. ${UNV}`, aliases: ['organizational unit'] },
      { id: 'finding-score', term: 'Findings and the five-level score', definition: `The deck says a five-level score is built from 46 specific findings. Those 46 are Ping's and are not in the deck beyond a few categories; the lab ships 13 illustrative findings of its own and a lab-invented scoring rule. The deck also lists Risk Scoring as Planned (slide 21): the discrepancy is shown, not resolved. ${UNV}`, aliases: ['risk score', 'risk scoring'] },
      { id: 'custodian', term: 'Custodian', definition: `A named human who is accountable for an agent. An orphaned agent has none and is flagged. Assignment at discovery from an owner hint is a lab reading (rule-based assignment is Roadmap, Q4 2026: no behaviour claimed). ${UNV}`, aliases: ['owner'] },
      { id: 'custodian-approval', term: 'Approval before a custodian action runs', definition: `Operations are restricted to administrators and each agent's assigned custodian and are written to the audit log with the acting user; every custodian action needs a tenant administrator's approval before it executes. The lab models it as propose, approve or deny, execute: self-approval, approve-after-deny and stale approvals are refused (lab reading). ${UNV}`, aliases: ['propose approve execute'] },
      { id: 'remediation', term: 'Remediation', definition: `Delete on twelve of thirteen sources (Databricks is in development) and quarantine on nine (the slide names seven; the other two are lab reading placeholders), plus targeted fixes: strip an over-privileged role, stop a privileged flow, disable a named credential, retag or reconfigure. ${UNV}`, aliases: ['delete', 'quarantine'] },
      { id: 'safe-sync', term: 'Safe sync', definition: `Discovery distinguishes "this agent is gone" from "the provider did not answer". If any part of a sync fails, nothing is deleted and agents not seen are marked unknown, not gone: a lab reading of a partly-cut-off deck line. ${UNV}`, aliases: ['gone versus unknown'] },
      { id: 'gateway-governance', term: 'Governing the AgentCore gateway itself', definition: `The gateway is an object of policy: enable or disable a tool target, switch the WAF failure mode, close a bypass route, pin an endpoint, end a session, flip log-only to enforcing. The nine modelAgentCoreAccountMetadata field names (GatewayDetailJSON and the rest) come from the console swagger, schema only; their inner shapes are lab-invented. ${UNV}`, aliases: ['gateway scorecard'] },
      { id: 'typed-confirmation', term: 'Typed confirmation', definition: `The deck names a typed confirmation for flipping log-only to enforcing. The lab asks for the gateway name, and uses the same for fail-closed (a lab reading). Wrong text changes nothing. ${UNV}`, aliases: [] },
      { id: 'private-network', term: 'Private-network discovery', definition: `A workload connector and scanner reach agents inside your own network and cloud accounts (Bedrock, AgentCore and Lex), polling outbound through your proxy. Swagger names (schema only): modelPrivateNetworkTenantConfig { Enabled } and modelPrivateNetworkConfig { Enabled, ScannerRunsIn }; Enabled is fixed once added. ${UNV}`, aliases: ['workload connector', 'workload scanner'] },
      { id: 'succession', term: 'Succession', definition: `When a custodian leaves, agent transfer to a new custodian is triggered (slide 19). Described in the deck, availability not stated. The lab proposes one transfer per agent for an administrator to approve. ${UNV}`, aliases: [] },
      { id: 'certification', term: 'Certification campaign', definition: `Periodic review and approval of agent access (slides 18 and 58). Described in the deck, availability not stated. The lab's clock-free state machine escalates items nobody reviewed. ${UNV}`, aliases: ['access review'] },
    ],
    sources: [
      { id: 'deck-slides', title: 'Ping ID4AI Workforce H2 2026 deck, slides 18, 19, 21, 35, 45 and 58', url: 'https://example.invalid/ping-id4ai-workforce-h2-2026-deck', kind: 'deck', use: 'The AI Platform Agents release claims and the governance availability table.', status: 'read', checked: '2026-10-31' },
      { id: 'console-swagger', title: 'Privilege console swagger, 2026-10-31 (schema only)', url: 'https://example.invalid/privilege-console-swagger', kind: 'schema', use: 'Field names for the AgentCore gateway metadata and the private-network configuration. It proves names exist, not behaviour.', status: 'read', checked: '2026-10-31' },
    ],
    cards: [
      ...story.scenarios.map((sc, i) => ({ id: `try-${sc.id}`, label: `Scenario ${i + 1}: ${sc.title}`, description: sc.say, group: 'try-it', action: { type: 'route', href: '/#inventory' }, terms: terms[sc.id], story: sid(i + 1) })),
      { id: 'try-self-approval', label: 'Approve your own proposal', description: 'Propose as an administrator and try to approve it yourself: refused. A custodian cannot approve at all.', group: 'try-it', action: { type: 'route', href: '/#ownership' }, terms: ['custodian-approval'] },
      { id: 'try-partial-sync', label: 'Make a provider not answer', description: 'Run a sync with one provider failing: nothing is deleted and unseen agents become unknown, not gone.', group: 'try-it', action: { type: 'route', href: '/#sync' }, terms: ['safe-sync'] },
      { id: 'try-typed-confirmation', label: 'Flip the gateway to enforcing', description: 'A wrong typed confirmation changes nothing; the gateway name flips it.', group: 'try-it', action: { type: 'route', href: '/#gateway' }, terms: ['gateway-governance', 'typed-confirmation'] },
      { id: 'concept-why-platform-agents', label: 'Why it matters: AI Platform Agents (slide 45)', description: why('why-platform-agents'), group: 'concept', action: { type: 'route', href: '/#talk' }, terms: ['platform-agents', 'inventory', 'safe-sync'] },
      { id: 'concept-risk-discrepancy', label: 'Risk Scoring: slide 45 versus slide 21', description: story.discrepancies.find((d) => d.id === 'risk-scoring').text, group: 'concept', action: { type: 'route', href: '/#review' }, terms: ['finding-score'] },
      { id: 'concept-availability', label: 'What is GA, roadmap or planned (slide 21)', description: 'Platform Agent Discovery, Activity Collectors and Agent Delegated Administration are GA; Shadow AI Discovery, Agent Lifecycle Management, Agent Classification, Custodian Management and Agent Events are Roadmap (Q4 2026); Access Visualization and Risk Scoring are Planned. The lab claims no behaviour for the roadmap items.', group: 'concept', action: { type: 'route', href: '/#inventory' }, terms: ['custodian', 'finding-score'] },
      { id: 'concept-diagram', label: 'Diagrams', description: 'Three diagrams: the governance cycle; safe sync; and private-network discovery.', group: 'concept', action: { type: 'route', href: '/#diagram' }, terms: ['safe-sync', 'private-network'] },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: story.scenarios.map((sc, i) => ({ id: sid(i + 1), title: sc.title, say: sc.say })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
  console.log('wrote content-pack.json');
}
