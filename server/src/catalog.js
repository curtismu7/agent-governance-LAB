// The catalog: the thirteen sources, the scopes (accounts, projects, subscriptions) they run in, the models, and the seeded MOCK agents.
// Everything here is synthetic: fake ids (000000000001-style AWS account ids), .example hosts, no real customer, tenant or account.
// What comes from the deck (slide 45) and what is the lab's own is tagged per field in data.js (FIELD_SOURCES).
import { fill } from './cast.js';

// The thirteen sources, in the deck's order. `type` is the console swagger enum value of imodelAIAgentAccountSpec.Type (schema only).
// delete: the deck says "delete on twelve of thirteen sources (Databricks in development)". quarantine: the deck says "nine" and NAMES seven
// (Bedrock Agents and AgentCore, Lex, Vertex AI, Copilot Studio, Agentforce, Snowflake Cortex). The other two are not named, so the lab does not guess:
// quarantine is modelled on exactly the seven named (deck claim: nine; lab reading: seven).
// permissionSurface: slide 45 names AWS IAM policies, Google project IAM bindings, Azure ARM role assignments, named credentials (Agentforce) and
// privileged flows (Copilot Studio); Databricks and Snowflake are not named, so theirs is a lab reading.
export const SOURCES = [
  { id: 'bedrock', name: 'AWS Bedrock Agents', cloud: 'aws', type: 'BEDROCK', surface: 'AWS IAM policies', surfaceSource: 'deck', delete: true, quarantine: true },
  { id: 'agentcore', name: 'AWS Bedrock AgentCore', cloud: 'aws', type: 'AGENTCORE', surface: 'AWS IAM policies', surfaceSource: 'deck', delete: true, quarantine: true },
  { id: 'lex', name: 'Amazon Lex', cloud: 'aws', type: 'LEX', surface: 'AWS IAM policies', surfaceSource: 'deck', delete: true, quarantine: true },
  { id: 'bedrockflow', name: 'Amazon Bedrock Flows', cloud: 'aws', type: 'BEDROCKFLOW', surface: 'AWS IAM policies', surfaceSource: 'deck', delete: true, quarantine: false },
  { id: 'vertexai', name: 'Google Vertex AI Agent Engine', cloud: 'gcp', type: 'VERTEXAI', surface: 'Google project IAM bindings', surfaceSource: 'deck', delete: true, quarantine: true },
  { id: 'agentbuilder', name: 'Google Agent Builder', cloud: 'gcp', type: 'AGENTBUILDER', surface: 'Google project IAM bindings', surfaceSource: 'deck', delete: true, quarantine: false },
  { id: 'agentregistry', name: 'Google Agent Registry', cloud: 'gcp', type: 'AGENTREGISTRY', surface: 'Google project IAM bindings', surfaceSource: 'deck', delete: true, quarantine: false },
  { id: 'dialogflowcx', name: 'Dialogflow CX', cloud: 'gcp', type: 'DIALOGFLOWCX', surface: 'Google project IAM bindings', surfaceSource: 'deck', delete: true, quarantine: false },
  { id: 'aifoundry', name: 'Azure AI Foundry', cloud: 'azure', type: 'AIFOUNDRY', surface: 'Azure ARM role assignments', surfaceSource: 'deck', delete: true, quarantine: false },
  { id: 'copilot', name: 'Microsoft Copilot Studio', cloud: 'azure', type: 'COPILOT', surface: 'Privileged flows', surfaceSource: 'deck', delete: true, quarantine: true },
  { id: 'agentforce', name: 'Salesforce Agentforce', cloud: 'saas', type: 'AGENTFORCE', surface: 'Named credentials', surfaceSource: 'deck', delete: true, quarantine: true },
  { id: 'databricks', name: 'Databricks Mosaic AI', cloud: 'saas', type: 'DATABRICKS', surface: 'Workspace grants', surfaceSource: 'reading', delete: false, quarantine: false },
  { id: 'snowflake', name: 'Snowflake Cortex AI', cloud: 'saas', type: 'SNOWFLAKE_CORTEX', surface: 'Role grants', surfaceSource: 'reading', delete: true, quarantine: true },
];
export const SOURCE_IDS = SOURCES.map((s) => s.id);
export const SOURCE = Object.fromEntries(SOURCES.map((s) => [s.id, s]));
// The seven sources the deck names for quarantine.
export const QUARANTINE_NAMED_BY_DECK = ['bedrock', 'agentcore', 'lex', 'vertexai', 'copilot', 'agentforce', 'snowflake'];
export const PRIVATE_NETWORK_SOURCES = ['bedrock', 'agentcore', 'lex']; // slide 35 and 45: "Bedrock, AgentCore and Lex"

// Scopes: where an agent runs. AWS accounts sit in organizational units (the lab's org). reach 'private' = only the Workload Scanner can see it.
export const SCOPES = [
  { id: '000000000001', label: 'AWS account 000000000001', cloud: 'aws', ou: 'ou-lab-prod', reach: 'public', latent: false },
  { id: '000000000002', label: 'AWS account 000000000002 (private network)', cloud: 'aws', ou: 'ou-lab-prod', reach: 'private', latent: false },
  { id: '000000000003', label: 'AWS account 000000000003', cloud: 'aws', ou: 'ou-lab-sandbox', reach: 'public', latent: false },
  { id: '000000000004', label: 'AWS account 000000000004 (created after the first scan)', cloud: 'aws', ou: 'ou-lab-prod', reach: 'public', latent: true },
  { id: 'proj-lab-001', label: 'Google project proj-lab-001', cloud: 'gcp', ou: null, reach: 'public', latent: false },
  { id: 'proj-lab-002', label: 'Google project proj-lab-002', cloud: 'gcp', ou: null, reach: 'public', latent: false },
  { id: 'sub-lab-001', label: 'Azure subscription sub-lab-001', cloud: 'azure', ou: null, reach: 'public', latent: false },
  { id: 'env-lab-001', label: 'Power Platform environment env-lab-001', cloud: 'azure', ou: null, reach: 'public', latent: false },
  { id: 'org-lab-001', label: 'Salesforce org org-lab-001', cloud: 'saas', ou: null, reach: 'public', latent: false },
  { id: 'ws-lab-001', label: 'Databricks workspace ws-lab-001', cloud: 'saas', ou: null, reach: 'public', latent: false },
  { id: 'acct-lab-001', label: 'Snowflake account acct-lab-001', cloud: 'saas', ou: null, reach: 'public', latent: false },
];
export const SCOPE = Object.fromEntries(SCOPES.map((s) => [s.id, s]));
export const SCOPE_IDS = SCOPES.map((s) => s.id);
export const OUS = [
  { id: 'ou-lab-prod', label: 'Production OU' },
  { id: 'ou-lab-sandbox', label: 'Sandbox OU' },
];
export const OU_IDS = OUS.map((o) => o.id);
export const DEFAULT_ONBOARDED_OUS = ['ou-lab-prod'];
export const ORG_ID = 'o-lab0000001';

// Models are generic lab names (no real model or vendor). deprecated is the lab's own list for the LF-08 finding.
export const MODELS = {
  'lab-model-large-2': { deprecated: false },
  'lab-model-small-3': { deprecated: false },
  'lab-model-large-1': { deprecated: true, retired: '2026-06-30' },
  'lab-model-small-1': { deprecated: true, retired: '2026-03-31' },
};
export const PERMISSION_CLASSES = ['normal', 'admin', 'impersonate', 'read-secret'];
export const TAG_KEYS = ['environment', 'cost-center', 'data-class'];
export const RECONFIGURE_FIELDS = { publicAccess: [true, false], logging: [true, false], authentication: ['none', 'iam', 'oauth'], guardrail: ['gr-default', null] };
export const DEFAULT_GUARDRAIL = 'gr-default';

const P = (id, grant, o = {}) => ({ id, grant, action: o.action || grant, write: false, class: 'normal', usedBy: null, viaCredential: null, target: null, ...o });
const T = (id, name, o = {}) => ({ id, name, write: false, egress: false, ...o });
const KB = (id, name, sensitivity = 'internal') => ({ id, name, sensitivity });
const CR = (id, name, rotatedDaysAgo, o = {}) => ({ id, name, rotatedDaysAgo, enabled: true, ...o });

const base = (id, source, scope, name, o = {}) => ({
  id, source, scope, name, model: 'lab-model-large-2',
  config: { authentication: 'iam', publicAccess: false, logging: true, guardrail: 'gr-default' },
  identity: { name: `${source}-exec-${id.slice(-2)}`, kind: 'role', permissions: [] },
  tools: [], knowledgeBases: [], credentials: [], bindings: [], subAgents: [], flows: [], tags: { environment: 'production' },
  custodianHint: null, card: null, latent: false, rev: 1, ...o,
});

// The seeded agents (26 present at the first scan, 3 that appear at the second). {{castDomainN}} tokens are filled per vertical.
// Each rule in findings.js fires on at least one of these (a test checks it) and has a near-miss in the rule tests.
export function seedAgents(cast) {
  const d = (n) => `{{castDomain${n}}}`;
  const list = [
    base('ag-bedrock-01', 'bedrock', '000000000001', `${d(1)}-assistant`, { custodianHint: 'castCustodian', tools: [T('t1', 'lookup-order'), T('t2', 'summarise-case')], knowledgeBases: [KB('kb1', `${d(1)}-faq`)],
      identity: { name: 'role-lab-bedrock-01', kind: 'AWS IAM role', permissions: [P('p1', 'iam:policy BedrockInvokeOnly', { action: 'bedrock:InvokeModel', usedBy: 't1' })] } }),
    base('ag-bedrock-02', 'bedrock', '000000000001', `${d(2)}-reconciler`, { custodianHint: 'castCustodian', tools: [T('t1', 'post-journal', { write: true })], config: { authentication: 'iam', publicAccess: false, logging: true, guardrail: null },
      identity: { name: 'role-lab-admin-ops', kind: 'AWS IAM role', permissions: [P('p1', 'iam:policy AdministratorAccess', { action: '*:*', write: true, class: 'admin', usedBy: 't1' })] } }),
    base('ag-agentcore-01', 'agentcore', '000000000001', `${d(3)}-scorer`, { custodianHint: 'castCustodian2', config: { authentication: 'none', publicAccess: true, logging: false, guardrail: 'gr-default' },
      tools: [T('t1', 'score-transaction')], identity: { name: 'role-lab-agentcore-01', kind: 'AWS IAM role', permissions: [P('p1', 'iam:policy AgentCoreInvoke', { action: 'bedrock-agentcore:InvokeAgentRuntime', usedBy: 't1' })] } }),
    base('ag-agentcore-02', 'agentcore', '000000000002', `${d(4)}-collector`, { custodianHint: 'castCustodian2', tools: [T('t1', 'send-statement', { write: true, egress: true })], config: { authentication: 'iam', publicAccess: false, logging: true, guardrail: 'gr-default' },
      credentials: [CR('c1', 'vault-reader-key', 140)],
      identity: { name: 'role-lab-agentcore-02', kind: 'AWS IAM role', permissions: [P('p1', 'iam:policy SecretsRead', { action: 'secretsmanager:GetSecretValue', class: 'read-secret', usedBy: 't1' })] } }),
    base('ag-lex-01', 'lex', '000000000001', `${d(6)}-bot`, { model: 'lab-model-small-1', custodianHint: null, tools: [T('t1', 'collect-details')],
      identity: { name: 'role-lab-lex-01', kind: 'AWS IAM role', permissions: [P('p1', 'iam:policy LexRuntime', { action: 'lex:RecognizeText', usedBy: 't1' })] } }),
    base('ag-lex-02', 'lex', '000000000002', `${d(1)}-voice-bot`, { custodianHint: 'castCustodian3', tools: [T('t1', 'transfer-call')],
      identity: { name: 'role-lab-lex-02', kind: 'AWS IAM role', permissions: [P('p1', 'iam:policy PassToBotRole', { action: 'iam:PassRole', class: 'impersonate', target: 'role-lab-lex-01', usedBy: 't1' })] } }),
    base('ag-bedrockflow-01', 'bedrockflow', '000000000001', `${d(2)}-pipeline`, { custodianHint: 'castCustodian3', tools: [T('t1', 'read-ledger')],
      identity: { name: 'role-lab-flow-01', kind: 'AWS IAM role', permissions: [P('p1', 'iam:policy LedgerRead', { action: 's3:GetObject', usedBy: 't1' }), P('p2', 'iam:policy BucketWriteAll', { action: 's3:PutObject', write: true }), P('p3', 'iam:policy QueueDeleteAll', { action: 'sqs:DeleteMessage', write: true })] } }),
    base('ag-bedrockflow-02', 'bedrockflow', '000000000003', `${d(5)}-sandbox-flow`, { custodianHint: 'castCustodian', tools: [T('t1', 'run-step')],
      identity: { name: 'role-lab-flow-02', kind: 'AWS IAM role', permissions: [P('p1', 'iam:policy AssumeOpsRole', { action: 'sts:AssumeRole', class: 'impersonate', target: 'role-lab-admin-ops', usedBy: 't1' })] } }),
    base('ag-vertexai-01', 'vertexai', 'proj-lab-001', `${d(3)}-reviewer`, { custodianHint: 'castCustodian2', tools: [T('t1', 'fetch-case')],
      bindings: [{ id: 'b1', role: 'roles/lab.legacyViewer', roleExists: false }, { id: 'b2', role: 'roles/aiplatform.user', roleExists: true }],
      identity: { name: 'sa-vertex-01.proj-lab-001', kind: 'Google service account', permissions: [P('p1', 'projects/proj-lab-001 roles/aiplatform.user', { action: 'aiplatform.endpoints.predict', usedBy: 't1' })] } }),
    base('ag-vertexai-02', 'vertexai', 'proj-lab-001', `${d(4)}-planner`, { custodianHint: 'castCustodian', tools: [T('t1', 'plan-visit')],
      identity: { name: 'sa-shared-agents.proj-lab-001', kind: 'Google service account', permissions: [P('p1', 'projects/proj-lab-001 roles/aiplatform.user', { action: 'aiplatform.endpoints.predict', usedBy: 't1' })] } }),
    base('ag-agentbuilder-01', 'agentbuilder', 'proj-lab-001', `${d(5)}-search-agent`, { custodianHint: 'castCustodian3', tools: [T('t1', 'search-docs')], subAgents: ['ag-ghost-99'],
      identity: { name: 'sa-shared-agents.proj-lab-001', kind: 'Google service account', permissions: [P('p1', 'projects/proj-lab-001 roles/discoveryengine.viewer', { action: 'discoveryengine.search', usedBy: 't1' })] } }),
    base('ag-agentbuilder-02', 'agentbuilder', 'proj-lab-002', `${d(6)}-guide`, { custodianHint: 'castCustodian2', tools: [T('t1', 'show-steps')],
      identity: { name: 'sa-builder-02.proj-lab-002', kind: 'Google service account', permissions: [P('p1', 'projects/proj-lab-002 roles/discoveryengine.viewer', { action: 'discoveryengine.search', usedBy: 't1' })] } }),
    base('ag-agentregistry-01', 'agentregistry', 'proj-lab-001', `${d(1)}-a2a-agent`, { custodianHint: 'castCustodian3', tools: [T('t1', 'answer-question')],
      card: { name: `${d(1)}-a2a-agent`, url: 'https://agents.example/a2a/refunds', skills: ['answer-question'], auth: 'oauth2' },
      identity: { name: 'sa-registry-01.proj-lab-001', kind: 'Google service account', permissions: [P('p1', 'projects/proj-lab-001 roles/aiplatform.user', { action: 'aiplatform.endpoints.predict', usedBy: 't1' })] } }),
    base('ag-agentregistry-02', 'agentregistry', 'proj-lab-002', `${d(2)}-a2a-router`, { custodianHint: 'castCustodian', tools: [T('t1', 'route-task')], subAgents: ['ag-agentregistry-01'],
      card: { name: `${d(2)}-a2a-router`, url: 'https://agents.example/a2a/router', skills: ['route-task'], auth: 'oauth2' },
      identity: { name: 'sa-registry-02.proj-lab-002', kind: 'Google service account', permissions: [P('p1', 'projects/proj-lab-002 roles/aiplatform.user', { action: 'aiplatform.endpoints.predict', usedBy: 't1' })] } }),
    base('ag-dialogflowcx-01', 'dialogflowcx', 'proj-lab-001', `${d(4)}-chat`, { custodianHint: 'castCustodian2', config: { authentication: 'iam', publicAccess: false, logging: true, guardrail: null }, tools: [T('t1', 'create-ticket', { write: true })],
      identity: { name: 'sa-cx-01.proj-lab-001', kind: 'Google service account', permissions: [P('p1', 'projects/proj-lab-001 roles/dialogflow.client', { action: 'dialogflow.sessions.detectIntent', usedBy: 't1' })] } }),
    base('ag-dialogflowcx-02', 'dialogflowcx', 'proj-lab-002', `${d(6)}-faq-bot`, { custodianHint: 'castCustodian3', tools: [T('t1', 'create-ticket', { write: true })],
      identity: { name: 'sa-cx-02.proj-lab-002', kind: 'Google service account', permissions: [P('p1', 'projects/proj-lab-002 roles/dialogflow.client', { action: 'dialogflow.sessions.detectIntent', usedBy: 't1' })] } }),
    base('ag-aifoundry-01', 'aifoundry', 'sub-lab-001', `${d(3)}-investigator`, { custodianHint: 'castCustodian', tools: [T('t1', 'open-case', { write: true })],
      identity: { name: 'mi-foundry-01.sub-lab-001', kind: 'Azure managed identity', permissions: [P('p1', 'ARM role assignment Owner at /subscriptions/sub-lab-001', { action: '*', write: true, class: 'admin', usedBy: 't1' })] } }),
    base('ag-aifoundry-02', 'aifoundry', 'sub-lab-001', `${d(5)}-forecaster`, { custodianHint: 'castCustodian3', tools: [T('t1', 'read-metrics')], knowledgeBases: [KB('kb1', `${d(5)}-history`, 'restricted')],
      identity: { name: 'mi-foundry-02.sub-lab-001', kind: 'Azure managed identity', permissions: [P('p1', 'ARM role assignment Reader at /subscriptions/sub-lab-001', { action: 'Microsoft.Resources/subscriptions/read', usedBy: 't1' })] } }),
    base('ag-copilot-01', 'copilot', 'env-lab-001', `${d(2)}-helper`, { custodianHint: 'castCustodian2', tools: [T('t1', 'approve-request', { write: true })],
      flows: [{ id: 'f1', name: 'bulk-approve-flow', privileged: true, running: true }, { id: 'f2', name: 'notify-flow', privileged: false, running: true }],
      identity: { name: 'conn-copilot-01.env-lab-001', kind: 'Power Platform connection', permissions: [] } }),
    base('ag-copilot-02', 'copilot', 'env-lab-001', `${d(4)}-scheduler`, { custodianHint: 'castCustodian', tools: [T('t1', 'book-slot')],
      flows: [{ id: 'f1', name: 'reminder-flow', privileged: false, running: true }],
      identity: { name: 'conn-copilot-02.env-lab-001', kind: 'Power Platform connection', permissions: [] } }),
    base('ag-agentforce-01', 'agentforce', 'org-lab-001', `${d(1)}-case-agent`, { custodianHint: 'castCustodian3', tools: [T('t1', 'update-case', { write: true })],
      credentials: [CR('nc1', 'nc-admin-api', 45)],
      identity: { name: 'nc-owner-01.org-lab-001', kind: 'Named credential', permissions: [P('p1', 'named credential nc-admin-api (system administrator scope)', { action: 'api:full', write: true, class: 'admin', usedBy: 't1', viaCredential: 'nc1' })] } }),
    base('ag-agentforce-02', 'agentforce', 'org-lab-001', `${d(6)}-onboarding-agent`, { custodianHint: 'castCustodian', config: { authentication: 'oauth', publicAccess: true, logging: true, guardrail: 'gr-default' }, tools: [T('t1', 'create-contact')],
      identity: { name: 'nc-owner-02.org-lab-001', kind: 'Named credential', permissions: [P('p1', 'named credential nc-contacts (contacts read/write)', { action: 'contacts:write', usedBy: 't1' })] } }),
    base('ag-databricks-01', 'databricks', 'ws-lab-001', `${d(3)}-notebook-agent`, { model: 'lab-model-large-1', custodianHint: null, tools: [T('t1', 'run-notebook')],
      identity: { name: 'sp-dbx-01.ws-lab-001', kind: 'Service principal', permissions: [P('p1', 'workspace grant CAN_MANAGE on all clusters', { action: 'clusters:manage', write: true, usedBy: 't1' }), P('p2', 'workspace grant CAN_MANAGE on all jobs', { action: 'jobs:manage', write: true }), P('p3', 'workspace grant CAN_MANAGE on all pipelines', { action: 'pipelines:manage', write: true })] } }),
    base('ag-databricks-02', 'databricks', 'ws-lab-001', `${d(5)}-model-agent`, { custodianHint: 'castCustodian2', tools: [T('t1', 'score-batch')],
      identity: { name: 'sp-dbx-02.ws-lab-001', kind: 'Service principal', permissions: [P('p1', 'workspace grant CAN_VIEW on the model registry', { action: 'models:read', usedBy: 't1' })] } }),
    base('ag-snowflake-01', 'snowflake', 'acct-lab-001', `${d(4)}-analyst`, { custodianHint: 'castCustodian3', tools: [T('t1', 'run-query')],
      identity: { name: 'role-sf-analyst-01', kind: 'Role grant', permissions: [P('p1', 'role grant READ_SECRETS on SECRETS_DB', { action: 'secrets_db.select', class: 'read-secret', usedBy: 't1' })] } }),
    base('ag-snowflake-02', 'snowflake', 'acct-lab-001', `${d(6)}-search-agent`, { custodianHint: 'castCustodian', tools: [T('t1', 'cortex-search')], credentials: [CR('c1', 'search-key', 92)],
      identity: { name: 'role-sf-search-02', kind: 'Role grant', permissions: [P('p1', 'role grant USAGE on CORTEX_SEARCH', { action: 'cortex:search', usedBy: 't1' })] } }),
    // appear at the second scan (the lab's "created in a cloud console since the last scan")
    base('ag-bedrock-03', 'bedrock', '000000000004', `${d(3)}-trial-agent`, { latent: true, custodianHint: null, config: { authentication: 'none', publicAccess: true, logging: true, guardrail: null }, tools: [T('t1', 'run-trial', { write: true })],
      identity: { name: 'role-lab-bedrock-03', kind: 'AWS IAM role', permissions: [P('p1', 'iam:policy BedrockInvokeOnly', { action: 'bedrock:InvokeModel', usedBy: 't1' })] } }),
    base('ag-vertexai-03', 'vertexai', 'proj-lab-002', `${d(2)}-summariser`, { latent: true, custodianHint: 'castCustodian2', tools: [T('t1', 'summarise')],
      identity: { name: 'sa-vertex-03.proj-lab-002', kind: 'Google service account', permissions: [P('p1', 'projects/proj-lab-002 roles/aiplatform.user', { action: 'aiplatform.endpoints.predict', usedBy: 't1' })] } }),
    base('ag-copilot-03', 'copilot', 'env-lab-001', `${d(5)}-expense-agent`, { latent: true, custodianHint: 'castCustodian3', tools: [T('t1', 'submit-expense', { write: true })],
      flows: [{ id: 'f1', name: 'expense-flow', privileged: false, running: true }],
      identity: { name: 'conn-copilot-03.env-lab-001', kind: 'Power Platform connection', permissions: [] } }),
  ];
  return list.map((a) => JSON.parse(fill(JSON.stringify(a), cast)));
}
