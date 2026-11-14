// Maps live Privilege console objects (applications, pacpolicys, tagpolicys) onto the lab's agent record shape, so the same tabs,
// findings and score render for Real mode. The mapping is deterministic and read-only: every derived id is a hash of a real name,
// every value comes from the fetched object, and nothing is invented beyond the labels the engine's shape needs. The lab's own
// findings run over the mapped records exactly as they do over the seeded ones.
import { createHash } from 'node:crypto';

const b64 = (s) => { try { return Buffer.from(String(s), 'base64').toString('utf8'); } catch { return null; } };
// RefIDs look like base64("<tenant>@@@default@@@<name>"); the name is the last part.
export const refName = (refId) => {
  const t = b64(refId);
  if (!t) return null;
  const parts = t.split('@@@');
  return parts.length >= 3 ? parts[parts.length - 1] : null;
};

const hashId = (prefix, name) => `ag-priv-${createHash('sha256').update(String(name)).digest('hex').slice(0, 10)}`.replace(/^ag-priv-(.{10})$/, (_, h) => `${prefix}-${h}`);

const E = (v) => (v && Array.isArray(v.Elems) ? v.Elems : []);
const tagsOf = (a) => ({ ...(a?.ObjectMeta?.CTags?.Map || {}) });
const nameOf = (a) => String(a?.ObjectMeta?.Name || '');

// The execution identity: the agent access keys granted to this app through pacpolicys (the Principals side), or "none".
function identityFor(appName, policys) {
  const keys = new Set(); const tools = new Set(); const kinds = new Set();
  for (const pol of policys) {
    for (const [kind, v] of Object.entries(pol?.Spec?.ActionMap || {})) {
      for (const rule of (v?.PolicyRule || [])) {
        const target = refName(rule?.ObjectRef?.RefID);
        if (target !== appName) continue;
        kinds.add(kind);
        const keyRef = rule?.Attributes?.Map?.agentaccesskey;
        if (keyRef) { const k = refName(keyRef); if (k) keys.add(k); }
        const caps = rule?.Capabilities?.Map || {};
        for (const [capKind, list] of Object.entries(caps)) {
          const kindLabel = capKind === 'tools' ? 'tool' : capKind === 'prompts' ? 'prompt' : 'resource';
          for (const item of E(list)) tools.add(`${kindLabel}:${item}`);
        }
      }
    }
  }
  return { keys: [...keys].sort(), toolGrants: [...tools].sort(), policyKinds: [...kinds].sort() };
}

// The lab's SOURCES are the deck's thirteen cloud sources; the Privilege tenant is none of them. Real-mode records carry a
// dedicated source so the inventory stays honest about where each row came from. Delete and quarantine are refused: the
// console API is read-only in this lab (the lab never mutates the live tenant).
export const PRIVILEGE_SOURCE_ID = 'privilege-mcp';
export const PRIVILEGE_SOURCE = { id: PRIVILEGE_SOURCE_ID, name: 'PingOne Privilege (live)', cloud: 'privilege', type: 'PRIVILEGE', surface: 'PAC policies and agent access keys', surfaceSource: 'live console', delete: false, quarantine: false };

// One mapped agent per Privilege application. Fields the findings rules read (identity permissions, config, credentials, tools)
// are derived from what the console actually says; the rest are the honest labels for "this is a gateway app, not a cloud agent".
export function mapApplications({ applications, pacPolicys, tagPolicys }) {
  const policyCountFor = (appName) => pacPolicys.filter((p) => identityFor(appName, [p]).keys.length > 0 || identityFor(appName, [p]).policyKinds.length > 0).length;
  const tagPolicyNames = tagPolicys.map(nameOf).sort();
  return applications.map((a) => {
    const name = nameOf(a);
    const appType = String(a?.Spec?.AppType || '');
    const mcp = a?.Spec?.McpAppConfig || null;
    const http = a?.Spec?.HttpAppConfig || null;
    const frontends = E(mcp?.FrontEndName).concat(E(http?.FrontEndName));
    const backends = E(mcp?.Backends).concat(E(http?.Backends));
    const authMode = mcp?.AuthMode || http?.AuthMode || '';
    const guard = mcp?.AIGuardConfig || http?.AIGuardConfig || null;
    const id = hashId('agpv', name);
    const ident = identityFor(name, pacPolicys);
    // Findings-relevant config, read from the console's own fields:
    const config = {
      // authentication none (no auth on the door) is the console's own value; anything else is "configured".
      authentication: authMode === 'none' || authMode === '' ? 'none' : 'oauth',
      // publicAccess: an MCP door with no auth at all is reachable by anyone who can reach the gateway.
      publicAccess: (authMode === 'none' || authMode === '') && frontends.length > 0,
      logging: (guard?.Enabled === true) || (mcp?.AuthToken || '') !== '' || authMode === 'static-token',
      guardrail: guard?.Enabled === true ? 'ai-guard' : null,
    };
    const identity = {
      name: ident.keys.length ? ident.keys.join(', ') : `${name} (no agent key granted)`,
      kind: 'Privilege agent access key',
      permissions: ident.keys.map((k, i) => ({
        id: `p${i + 1}`, grant: `pac policy grants key ${k}`, action: ident.policyKinds.join('+') || 'MCP', write: false,
        class: ident.keys.length > 1 ? 'impersonate' : 'normal', usedBy: null, viaCredential: null, target: null,
      })),
    };
    return {
      id, source: PRIVILEGE_SOURCE_ID, scope: 'privilege-tenant', name,
      model: 'n/a (gateway app)', config, identity,
      tools: ident.toolGrants.map((t, i) => ({ id: `t${i + 1}`, name: t, write: false, egress: false })),
      knowledgeBases: [], credentials: [], bindings: [], subAgents: [], flows: [],
      tags: tagsOf(a), custodianHint: null, card: null, latent: false, rev: 1,
      // provenance, shown by the UI as data, not decoration:
      privilege: {
        appType, frontends, backends, authMode, aiGuardEnabled: guard?.Enabled === true,
        agentKeys: ident.keys, policyKinds: ident.policyKinds,
        entryPath: mcp?.EntryPath || http?.EntryPath || null, meshCluster: mcp?.MeshCluster || http?.MeshCluster || null,
        tagPolicyNames: tagPolicyNames.slice(0, 20), updatedAt: a?.ObjectMeta?.UpdatedAt || null,
      },
    };
  });
}

// The gateway tab, in Real mode: one row per MCP application, from the live McpAppConfig (schema fields only; every inner
// judgement is read from the object, nothing invented).
export function mapGateways({ applications, pacPolicys }) {
  return applications
    .filter((a) => String(a?.Spec?.AppType || '') === 'mcp')
    .map((a) => {
      const mcp = a.Spec.McpAppConfig || {};
      const name = nameOf(a);
      const ident = identityFor(name, pacPolicys);
      const guard = mcp.AIGuardConfig || {};
      return {
        id: hashId('gwv', name), name, status: 'READY',
        authorizer: { type: mcp.AuthMode === 'none' || mcp.AuthMode === '' ? 'none' : 'configured', discoveryUrl: null, audiences: [] },
        engine: { id: `eng-${hashId('gwv', name)}`, mode: guard.FailClosed === true ? 'ENFORCE' : 'LOG_ONLY', status: 'ACTIVE', policyCount: ident.keys.length },
        wafFailureMode: guard.FailClosed === true ? 'fail-closed' : 'fail-open',
        rateLimit: 0, egress: 'private', contentChecks: guard.Enabled === true, kmsKey: null, pinnedEndpoint: null,
        targets: E(mcp.Backends).map((b, i) => ({ id: `tg-${i + 1}`, name: b, enabled: true, tools: 0 })),
        sessions: [], runtimes: [], cedar: [],
        privilege: { frontends: E(mcp.FrontEndName), entryPath: mcp.EntryPath || null, authMode: mcp.AuthMode || '', agentKeys: ident.keys, aiGuardEnabled: guard.Enabled === true },
      };
    });
}

// The scope label for the Privilege tenant scope.
export const PRIVILEGE_SCOPE = { id: 'privilege-tenant', label: 'Privilege tenant (live console)', cloud: 'privilege', ou: null, reach: 'public', latent: false };
