import { useState } from "react";
import { visible } from "../safeText";
import { ClaimTag, FieldSources, Outcome, SourceTag, StatusTag } from "./Bits";

const KIND_HINT = { "aws-account": "000000000009", "azure-subscription": "00000000-0000-0000-0000-000000000000", "gcp-project": "lab-project-001" };

// Private-network discovery (slides 35 and 45): a workload connector and scanner reach agents inside your own network and cloud accounts (Bedrock, AgentCore, Lex), polling
// OUTBOUND through your proxy. Swagger names: modelPrivateNetworkTenantConfig{Enabled}, modelPrivateNetworkConfig{Enabled, ScannerRunsIn} (schema only).
export default function PrivateTab({ story, lab, actor }) {
  const s = lab.state; const ro = lab.readOnly; const pn = s.privateNetwork;
  const [name, setName] = useState("prod-private");
  const [sources, setSources] = useState(["bedrock", "agentcore", "lex"]);
  const [scope, setScope] = useState(pn.privateScopes[0]?.id || "");
  const [enabled, setEnabled] = useState(true);
  const [scannerId, setScannerId] = useState("scanner-1");
  const [kind, setKind] = useState("aws-account");
  const [where, setWhere] = useState(KIND_HINT["aws-account"]);
  const toggleSource = (x) => setSources((l) => (l.includes(x) ? l.filter((y) => y !== x) : [...l, x]));
  const tenant = (v) => lab.act("PUT", "/api/private-network/tenant", { tenant: { actor, enabled: v } });
  const add = () => lab.act("POST", "/api/private-network/connections", { connection: { actor, name, sources, scopeIds: [scope], enabled, scannerId, scannerRunsIn: { kind, id: where } } });
  const tryChange = (c) => lab.act("PUT", `/api/private-network/connections/${encodeURIComponent(c.id)}`, { connection: { actor, enabled: !c.enabled } });
  const poll = () => lab.act("POST", "/api/private-network/connector/poll", { poll: { actor } });
  const sync = () => lab.act("POST", "/api/sync", { sync: { actor } });
  return (
    <div className="stack">
      {ro && <p className="muted" data-testid="read-only-note">Mock only reads tables: switch to Live to add a connection.</p>}
      <section className="panel">
        <h2 className="panel__title">Private-network discovery <ClaimTag /> <span className="tag" data-state="ok" data-testid="avail-tag">NEW (slides 35 and 45)</span></h2>
        <p className="muted">A workload connector and scanner reach agents inside your own network and cloud accounts (Bedrock, AgentCore and Lex), polling outbound through your proxy. The controller alone cannot see a private network. Nothing here makes a network call: the connector and the scanner are simulated.</p>
        <h3 className="panel__sub">Tenant setting <SourceTag source="swagger" label="modelPrivateNetworkTenantConfig { Enabled } (console swagger name, schema only)" /></h3>
        <p>Private network is <strong data-testid="tenant-state">{pn.tenantEnabled ? "enabled" : "disabled"}</strong> for this tenant. A tenant that has not enabled it cannot add a connection or run a Workload Connector.</p>
        <button type="button" disabled={ro || lab.busy} onClick={() => tenant(!pn.tenantEnabled)} data-testid="tenant-toggle">{pn.tenantEnabled ? "Disable Private network" : "Enable Private network"}</button>
        <Outcome last={lab.last} prefix="/private-network/tenant" />
      </section>

      <section className="panel" aria-label="Add a connection" data-testid="add-connection">
        <h3 className="panel__sub">Add a connection <SourceTag source="swagger" label="modelPrivateNetworkConfig { Enabled, ScannerRunsIn } (console swagger name, schema only)" /></h3>
        <p className="muted">Enabled scans the connection through the Workload Scanner and is <strong>fixed once the connection is added</strong>. ScannerRunsIn is where the Scanner runs (an AWS account, Azure subscription or GCP project); every connection one Scanner serves has the same. The { "{ kind, id }" } form, the scanner id and the scope and source lists are lab-invented.</p>
        <div className="filters">
          <label>Name<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoComplete="off" data-testid="c-name" /></label>
          <label>Private account to scan<select value={scope} onChange={(e) => setScope(e.target.value)} data-testid="c-scope">{pn.privateScopes.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
          <label>Scanner id<input value={scannerId} maxLength={30} onChange={(e) => setScannerId(e.target.value)} autoComplete="off" data-testid="c-scanner" /></label>
          <label>Scanner runs in<select value={kind} onChange={(e) => { setKind(e.target.value); setWhere(KIND_HINT[e.target.value]); }} data-testid="c-kind">{story.scannerKinds.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
          <label>Where (account, subscription or project id)<input value={where} onChange={(e) => setWhere(e.target.value)} autoComplete="off" data-testid="c-where" /></label>
        </div>
        <div className="chips" role="group" aria-label="Sources">{story.privateNetworkSources.map((x) => <button key={x} type="button" aria-pressed={sources.includes(x)} onClick={() => toggleSource(x)} data-testid={`c-src-${x}`}>{x}</button>)}</div>
        <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} data-testid="c-enabled" /> Enabled (scan through the Workload Scanner; fixed once added)</label>
        <button type="button" className="primary" disabled={ro || lab.busy} onClick={add} data-testid="c-add">Add the connection</button>
        <Outcome last={lab.last} prefix="/private-network/connections" />
      </section>

      <section className="panel" aria-label="Connections" data-testid="connections">
        <h3 className="panel__sub">Connections ({pn.connections.length})</h3>
        <div className="scroll"><table className="tbl tbl--wide"><thead><tr><th>Connection</th><th>Name</th><th>Sources</th><th>Scope</th><th>Enabled</th><th>Scanner runs in</th><th><span className="sr-only">Action</span></th></tr></thead>
          <tbody>{pn.connections.map((c) => (
            <tr key={c.id} data-testid={`conn-${c.id}`}><td>{c.id}</td><td>{visible(c.name)}</td><td>{c.sources.join(", ")}</td><td>{c.scopeIds.join(", ")}</td><td>{c.enabled ? "yes" : "no"} (fixed)</td><td>{c.scannerRunsIn.kind} {visible(c.scannerRunsIn.id)} (scanner {visible(c.scannerId)})</td>
              <td><button type="button" disabled={ro || lab.busy} onClick={() => tryChange(c)} data-testid={`flip-${c.id}`}>Try to flip Enabled</button></td></tr>))}
            {pn.connections.length === 0 && <tr><td colSpan={7}>No connection yet.</td></tr>}</tbody></table></div>
      </section>

      <section className="panel" aria-label="Connector" data-testid="connector">
        <h3 className="panel__sub">The connector only ever dials out <SourceTag source="deck" /></h3>
        <p>Poll log: <strong data-testid="outbound">{pn.connector.outbound}</strong> outbound, <strong data-testid="inbound">{pn.connector.inbound}</strong> inbound. <span className="muted">Counted from the simulated log below. The log is outbound by construction in the lab's model, so this illustrates the deck's claim; it is not proof about the product.</span></p>
        <div className="seg">
          <button type="button" disabled={ro || lab.busy} onClick={poll} data-testid="poll">Run a connector poll</button>
          <button type="button" className="primary" disabled={ro || lab.busy} onClick={sync} data-testid="scan">Run a sync (the scanner scans)</button>
        </div>
        <Outcome last={lab.last} prefix="/connector" />
        <div className="scroll"><table className="tbl tbl--wide" data-testid="polls"><thead><tr><th>#</th><th>Connection</th><th>Direction</th><th>Through</th><th>To</th><th>Scanner runs in</th></tr></thead>
          <tbody>{pn.polls.slice(-10).reverse().map((p) => <tr key={p.n}><td>{p.n}</td><td>{p.connection}</td><td><StatusTag status={p.direction} /></td><td>{p.via}</td><td>{p.to}</td><td>{p.scannerRunsIn.kind} {visible(p.scannerRunsIn.id)}</td></tr>)}
            {pn.polls.length === 0 && <tr><td colSpan={6}>No poll yet.</td></tr>}</tbody></table></div>
      </section>

      <section className="panel" aria-label="Found by the scanner" data-testid="scanner-found">
        <h3 className="panel__sub">Agents found by the Workload Scanner ({pn.discovered.length})</h3>
        <p className="muted">Each finding carries where the scanner runs.</p>
        <div className="scroll"><table className="tbl"><thead><tr><th>Agent</th><th>Source</th><th>Account</th><th>Scanner runs in</th><th>Findings</th></tr></thead>
          <tbody>{pn.discovered.map((d) => <tr key={d.id} data-testid={`found-${d.id}`}><td><code>{visible(d.name)}</code></td><td>{d.source}</td><td>{d.scope}</td><td>{d.scannerRunsIn.kind} {visible(d.scannerRunsIn.id)}</td><td>{d.findings}</td></tr>)}
            {pn.discovered.length === 0 && <tr><td colSpan={5}>None yet: the private account is invisible to the controller until a connection is added and enabled.</td></tr>}</tbody></table></div>
      </section>
      <FieldSources fields={story.fieldSources.filter((f) => /Private|private|Connector/.test(f.field))} />
    </div>
  );
}
