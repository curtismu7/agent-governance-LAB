import { useEffect, useState } from "react";
import { visible } from "../safeText";
import { AvailTag, ClaimTag, FieldSources, Outcome, SourceTag, StatusTag } from "./Bits";

const KIND_TEXT = {
  delete: "Delete the agent at the provider", quarantine: "Quarantine (detach the identity)", "strip-role": "Strip an over-privileged role", "stop-flow": "Stop a privileged flow", "disable-credential": "Disable a named credential",
  retag: "Retag", reconfigure: "Reconfigure", transfer: "Transfer to another custodian", "revoke-access": "Revoke the agent's access",
};
const VALUES = { publicAccess: [["false", "off"], ["true", "on"]], logging: [["true", "on"], ["false", "off"]], authentication: [["none", "none"], ["iam", "iam"], ["oauth", "oauth"]], guardrail: [["gr-default", "attach the default guardrail"], ["null", "remove the guardrail"]] };

// Ownership, custodians and remediation (slides 18, 19, 45, 58). Every custodian action is a three-step machine: propose, a tenant administrator approves or denies, then it executes.
export default function OwnershipTab({ story, lab, actor }) {
  const s = lab.state; const ro = lab.readOnly;
  const live = s.agents.filter((a) => a.status === "active" || a.status === "unknown");
  const [agentId, setAgentId] = useState("");
  const [kind, setKind] = useState("quarantine");
  const [pid, setPid] = useState(""); const [fid, setFid] = useState(""); const [cid, setCid] = useState("");
  const [tagKey, setTagKey] = useState(story.tagKeys[0]); const [tagValue, setTagValue] = useState("");
  const [field, setField] = useState("publicAccess"); const [fieldValue, setFieldValue] = useState("false");
  const [to, setTo] = useState(""); const [reason, setReason] = useState("");
  const [leaver, setLeaver] = useState(""); const [successor, setSuccessor] = useState("");
  const custodians = s.roster.filter((p) => p.role === "custodian" && !p.departed);
  useEffect(() => { if (!live.some((a) => a.id === agentId) && live[0]) setAgentId(live[0].id); }, [live, agentId]);
  useEffect(() => { if (!custodians.some((c) => c.id === to) && custodians[0]) setTo(custodians[0].id); }, [custodians, to]);
  useEffect(() => { if (!custodians.some((c) => c.id === leaver) && custodians[0]) setLeaver(custodians[0].id); }, [custodians, leaver]);
  useEffect(() => { if (!custodians.some((c) => c.id === successor && c.id !== leaver)) { const o = custodians.find((c) => c.id !== leaver); if (o) setSuccessor(o.id); } }, [custodians, successor, leaver]);
  const agent = s.agents.find((a) => a.id === agentId);
  const src = story.sources.find((x) => x.id === agent?.source);
  const params = () => {
    if (kind === "strip-role") return { permissionId: pid || agent?.identity.permissions[0]?.id };
    if (kind === "stop-flow") return { flowId: fid || agent?.flows[0]?.id };
    if (kind === "disable-credential") return { credentialId: cid || agent?.credentials[0]?.id };
    if (kind === "retag") return { key: tagKey, value: tagValue };
    if (kind === "reconfigure") return { field, value: JSON.parse(fieldValue) };
    if (kind === "transfer") return { to };
    return {};
  };
  const propose = () => lab.act("POST", "/api/proposals", { proposal: { actor, agentId, kind, params: params(), reason } });
  const decide = (id, decision) => lab.act("POST", `/api/proposals/${encodeURIComponent(id)}/decision`, { decision: { actor, decision } });
  const execute = (id) => lab.act("POST", `/api/proposals/${encodeURIComponent(id)}/execute`, { execute: { actor } });
  const campaign = (action) => lab.act("POST", "/api/campaign", { campaign: { actor, action } });
  const item = (id, decision) => lab.act("POST", `/api/campaign/items/${encodeURIComponent(id)}/decision`, { decision: { actor, decision } });
  const depart = () => lab.act("POST", "/api/custodians/depart", { depart: { actor, person: leaver, successor } });
  const camp = s.campaign;
  const byId = Object.fromEntries(s.agents.map((a) => [a.id, a]));
  const unsupported = (k) => (k === "delete" && src && !src.delete) || (k === "quarantine" && src && !src.quarantine);
  return (
    <div className="stack">
      {ro && <p className="muted" data-testid="read-only-note">Mock only reads tables: switch to Live to propose, approve and execute.</p>}
      <section className="panel" aria-label="Ownership">
        <h2 className="panel__title">Ownership, custodians and remediation <ClaimTag /> <AvailTag value="GA" /></h2>
        <p className="muted">Every agent has a named custodian; an orphaned agent has none and is flagged. Custodian operations are restricted to administrators and each agent's assigned custodian, are written to the audit log with the acting user, and a custodian's action needs a tenant administrator's approval BEFORE it executes, and only administrators act immediately (slide 45): an administrator's own action runs at once, audited. The three-step machine for a custodian's action, the roles and the rules for self-approval and stale approvals are the lab's reading. Classification and rule-based custodian assignment are <AvailTag value="Roadmap (Q4 2026)" />: no behaviour is claimed; the lab only reads an owner hint at discovery.</p>
        <h3 className="panel__sub">Roster</h3>
        <div className="scroll"><table className="tbl" data-testid="roster"><thead><tr><th>Person</th><th>Role</th><th>Agents held</th><th>Status</th></tr></thead>
          <tbody>{s.roster.map((p) => <tr key={p.id}><td>{visible(p.id)}</td><td>{p.role}</td><td>{p.agents}</td><td>{p.departed ? "left" : "here"}</td></tr>)}</tbody></table></div>
      </section>

      <section className="panel" aria-label="Propose an action" data-testid="propose-panel">
        <h3 className="panel__sub">1. Propose an action (acting as {actor ? visible(actor) : "..."})</h3>
        <div className="filters">
          <label>Agent<select value={agentId} onChange={(e) => setAgentId(e.target.value)} data-testid="p-agent">{live.map((a) => <option key={a.id} value={a.id}>{visible(a.name)} ({a.sourceName})</option>)}</select></label>
          <label>Action<select value={kind} onChange={(e) => setKind(e.target.value)} data-testid="p-kind">{story.proposalKinds.map((k) => <option key={k} value={k}>{KIND_TEXT[k]}{unsupported(k) ? " (not supported on this source: will be refused)" : ""}</option>)}</select></label>
          {kind === "strip-role" && <label>Permission<select value={pid || agent?.identity.permissions[0]?.id || ""} onChange={(e) => setPid(e.target.value)} data-testid="p-perm">{(agent?.identity.permissions || []).map((p) => <option key={p.id} value={p.id}>{p.id}: {visible(p.grant)}</option>)}</select></label>}
          {kind === "stop-flow" && <label>Flow<select value={fid || agent?.flows[0]?.id || ""} onChange={(e) => setFid(e.target.value)} data-testid="p-flow">{(agent?.flows || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
          {kind === "disable-credential" && <label>Credential<select value={cid || agent?.credentials[0]?.id || ""} onChange={(e) => setCid(e.target.value)} data-testid="p-cred">{(agent?.credentials || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          {kind === "retag" && (<><label>Tag<select value={tagKey} onChange={(e) => setTagKey(e.target.value)} data-testid="p-tagkey">{story.tagKeys.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
            <label>Value<input value={tagValue} maxLength={40} onChange={(e) => setTagValue(e.target.value)} data-testid="p-tagvalue" autoComplete="off" /></label></>)}
          {kind === "reconfigure" && (<><label>Setting<select value={field} onChange={(e) => { setField(e.target.value); setFieldValue(VALUES[e.target.value][0][0]); }} data-testid="p-field">{Object.keys(VALUES).map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
            <label>To<select value={fieldValue} onChange={(e) => setFieldValue(e.target.value)} data-testid="p-fieldvalue">{VALUES[field].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label></>)}
          {kind === "transfer" && <label>New custodian<select value={to} onChange={(e) => setTo(e.target.value)} data-testid="p-to">{custodians.map((c) => <option key={c.id} value={c.id}>{visible(c.id)}</option>)}</select></label>}
          <label>Reason (credential-shaped text is masked)<input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="p-reason" autoComplete="off" /></label>
        </div>
        <button type="button" className="primary" disabled={ro || !agentId || lab.busy} onClick={propose} data-testid="propose">Propose</button>
        <Outcome last={lab.last} prefix="/api/proposals" />
      </section>

      <section className="panel" aria-label="Proposals" data-testid="proposals-panel">
        <h3 className="panel__sub">2. Approve or deny, then 3. execute ({s.proposals.length})</h3>
        <p className="muted">Only a tenant administrator approves, and nobody approves their own proposal. An administrator's own proposal runs immediately (it shows as executed). An approval goes stale if the agent changes before it runs.</p>
        <div className="scroll"><table className="tbl tbl--wide" data-testid="proposals">
          <thead><tr><th>Proposal</th><th>Agent</th><th>Action</th><th>By</th><th>Status</th><th>Decided by</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {s.proposals.slice().reverse().map((p) => (
              <tr key={p.id} data-testid={`proposal-${p.id}`}>
                <td>{p.id}{p.succession ? " (succession)" : ""}</td><td><code>{visible(byId[p.agentId]?.name || p.agentId)}</code></td><td>{p.kind}{Object.keys(p.params).length ? ` ${visible(JSON.stringify(p.params))}` : ""}</td>
                <td>{visible(p.proposedBy)}</td><td><StatusTag status={p.status} /></td><td>{p.decidedBy ? visible(p.decidedBy) : "-"}</td>
                <td>
                  {p.status === "proposed" && (<><button type="button" disabled={ro} onClick={() => decide(p.id, "approve")} data-testid={`approve-${p.id}`}>Approve</button> <button type="button" disabled={ro} onClick={() => decide(p.id, "deny")} data-testid={`deny-${p.id}`}>Deny</button></>)}
                  {p.status === "approved" && <button type="button" disabled={ro} onClick={() => execute(p.id)} data-testid={`execute-${p.id}`}>Execute</button>}
                </td>
              </tr>
            ))}
            {s.proposals.length === 0 && <tr><td colSpan={7}>No proposals yet.</td></tr>}
          </tbody>
        </table></div>
        <Outcome last={lab.last} prefix="/decision" /><Outcome last={lab.last} prefix="/execute" />
      </section>

      <section className="panel" aria-label="Remediation" data-testid="remediation">
        <h3 className="panel__sub">Remediation by source <SourceTag source="deck" label="deck claim: delete on 12, quarantine on nine" /> <SourceTag source="reading" label="lab reading: the deck names seven, the lab models seven" /></h3>
        <p className="muted">The deck says delete works on twelve of thirteen sources (Databricks is in development) and quarantine on nine (deck claim) but names seven: the other two are not named, so the lab models seven (lab reading), and refuses quarantine on every other source. Targeted fixes (strip a role, stop a flow, disable a credential, retag, reconfigure) are named on slide 45; their effect on the score is lab-invented.</p>
        <div className="scroll"><table className="tbl">
          <thead><tr><th>Source</th><th>Delete</th><th>Quarantine</th></tr></thead>
          <tbody>{story.sources.map((x) => <tr key={x.id}><td>{x.name}</td><td>{x.delete ? "yes" : "no (in development)"}</td><td>{x.quarantine ? "yes (named by the deck)" : "no (not named by the deck: refused)"}</td></tr>)}</tbody>
        </table></div>
      </section>

      <section className="panel" aria-label="Succession" data-testid="succession">
        <h3 className="panel__sub">Succession <AvailTag value="described in the deck, availability not stated" /></h3>
        <p className="muted">Slide 19: when a custodian leaves, agent transfer to a new custodian is triggered. The lab proposes one transfer per agent and any administrator approves each: needing approval at all is a lab reading, not the deck.</p>
        <div className="filters">
          <label>Custodian who leaves<select value={leaver} onChange={(e) => setLeaver(e.target.value)} data-testid="leaver">{custodians.map((c) => <option key={c.id} value={c.id}>{visible(c.id)}</option>)}</select></label>
          <label>Successor<select value={successor} onChange={(e) => setSuccessor(e.target.value)} data-testid="successor">{custodians.filter((c) => c.id !== leaver).map((c) => <option key={c.id} value={c.id}>{visible(c.id)}</option>)}</select></label>
        </div>
        <button type="button" disabled={ro || !leaver || !successor || lab.busy} onClick={depart} data-testid="depart">Record the departure</button>
        <Outcome last={lab.last} prefix="/custodians" />
      </section>

      <section className="panel" aria-label="Certification campaign" data-testid="campaign">
        <h3 className="panel__sub">Certification campaign <AvailTag value="described in the deck, availability not stated" /></h3>
        <p className="muted">Slides 18 and 58: periodic review and approval of agent access. A custodian certifies or revokes each agent; a revoke goes through the same approval; unreviewed items escalate when the campaign is closed. Clock-free: nothing expires by itself.</p>
        <div className="seg">
          <button type="button" disabled={ro || lab.busy || (camp && camp.status === "open")} onClick={() => campaign("start")} data-testid="campaign-start">Start a campaign</button>
          <button type="button" disabled={ro || lab.busy || !camp || camp.status !== "open"} onClick={() => campaign("close")} data-testid="campaign-close">Close it (unreviewed items escalate)</button>
        </div>
        <Outcome last={lab.last} prefix="/campaign" />
        {camp && (
          <div className="scroll"><table className="tbl tbl--wide" data-testid="campaign-items">
            <caption>{camp.id} ({camp.status})</caption>
            <thead><tr><th>Item</th><th>Agent</th><th>Custodian</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{camp.items.map((i) => (
              <tr key={i.id} data-testid={`item-${i.id}`}>
                <td>{i.id}</td><td><code>{visible(byId[i.agentId]?.name || i.agentId)}</code></td><td>{i.custodian ? visible(i.custodian) : "none (escalated)"}</td><td><StatusTag status={i.status} /></td>
                <td>{(i.status === "pending" || i.status === "escalated") && (<><button type="button" disabled={ro} onClick={() => item(i.id, "certify")} data-testid={`certify-${i.id}`}>Certify</button> <button type="button" disabled={ro} onClick={() => item(i.id, "revoke")} data-testid={`revoke-${i.id}`}>Revoke</button></>)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
        {!camp && <p className="muted">No campaign yet.</p>}
      </section>

      <section className="panel" aria-label="Audit log" data-testid="audit">
        <h3 className="panel__sub">Audit log (acting user on every entry)</h3>
        <p className="muted" data-testid="audit-note">The acting user is self-declared in this lab (there is no sign-in), so "audited" here does not mean authenticated. The log keeps every entry: {s.auditInfo.used} of {s.auditInfo.cap} used, and new work is refused (Reset) when fewer than {story.limits.auditMargin} are free. Refused attempts are kept in a separate ring of {s.auditInfo.refusalsCap}: {s.auditInfo.refusalsKept} kept, {s.auditInfo.refusalsDropped} dropped.</p>
        <div className="scroll"><table className="tbl tbl--wide">
          <thead><tr><th>#</th><th>Logical time</th><th>Kind</th><th>Acting user</th><th>Detail</th></tr></thead>
          <tbody>{s.audit.slice(-25).reverse().map((a) => { const { n, at, kind, actor: who, ...rest } = a; return <tr key={n}><td>{n}</td><td>{at.slice(11, 16)}</td><td>{kind}</td><td>{visible(who)}</td><td>{visible(JSON.stringify(rest))}</td></tr>; })}</tbody>
        </table></div>
      </section>
      <FieldSources fields={story.fieldSources.filter((f) => /custodian|Remediation|Succession|Certification|approval|Targeted/i.test(f.field))} />
    </div>
  );
}
