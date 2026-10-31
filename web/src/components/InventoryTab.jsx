import { useMemo, useState } from "react";
import { visible } from "../safeText";
import { AvailTag, ClaimTag, FieldSources, LevelTag, SourceTag, StatusTag } from "./Bits";

// Inventory / AI Platform Agents (slides 45 and 58): a cross-cloud inventory across thirteen sources, a dashboard (recently discovered, action required, platform filters)
// and per-agent detail ("deep agent anatomy"). Mock reads a generated table; Live reads the workspace engine.
export default function InventoryTab({ story, mode, lab, actor, scenarioId, setScenarioId }) {
  const s = lab.state;
  const [source, setSource] = useState("all");
  const [level, setLevel] = useState("all");
  const [needsAction, setNeedsAction] = useState(false);
  const [recent, setRecent] = useState(false);
  const [open, setOpen] = useState(null);
  const rows = useMemo(() => s.agents.filter((a) => (source === "all" || a.source === source) && (level === "all" || a.assessment.level >= Number(level)) && (!needsAction || a.actionRequired.length > 0) && (!recent || s.summary.recentlyDiscovered.includes(a.id))), [s, source, level, needsAction, recent]);
  const detail = s.agents.find((a) => a.id === open) || null;
  const sum = s.summary;
  const readOnly = lab.readOnly;
  const toggleOu = (ou) => {
    const next = s.org.onboardedOus.includes(ou) ? s.org.onboardedOus.filter((o) => o !== ou) : [...s.org.onboardedOus, ou];
    lab.act("PUT", "/api/org/onboarding", { onboarding: { actor, ous: next } });
  };
  return (
    <div className="stack">
      <section className="panel" data-testid="intro-panel">
        <h2 className="panel__title">Inventory: AI Platform Agents <ClaimTag /> <span className="tag" data-state="ok" data-testid="avail-tag">ENHANCED, GA (slide 45)</span></h2>
        <p className="muted">Thirteen sources, one inventory: every agent with its identity, model, configuration and owner. {story.deckNumbers.text}</p>
        {mode === "mock" && (
          <label className="inline">Scripted scenario{" "}
            <select value={scenarioId || lab.scenario?.id || ""} onChange={(e) => setScenarioId(e.target.value)} data-testid="scenarios">
              {lab.scenarios.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
            </select>
          </label>
        )}
        {mode === "mock" && lab.scenario && <p className="muted" data-testid="scenario-say">{lab.scenario.say}</p>}
      </section>

      <section className="panel" aria-label="Dashboard" data-testid="dashboard">
        <h3 className="panel__sub">Dashboard</h3>
        <div className="tiles">
          <div className="tile"><div className="tile__n" data-testid="tile-live">{sum.live}</div><div className="tile__t">agents in the inventory</div></div>
          <div className="tile"><div className="tile__n" data-testid="tile-action">{sum.actionRequired}</div><div className="tile__t">action required</div></div>
          <div className="tile"><div className="tile__n" data-testid="tile-recent">{sum.recentlyDiscovered.length}</div><div className="tile__t">recently discovered (run {sum.newestRun})</div></div>
          <div className="tile"><div className="tile__n" data-testid="tile-orphaned">{sum.orphaned}</div><div className="tile__t">orphaned (no custodian)</div></div>
          <div className="tile"><div className="tile__n" data-testid="tile-open">{sum.openProposals}</div><div className="tile__t">proposals waiting</div></div>
        </div>
        <p className="muted">By status: {Object.entries(sum.byStatus).map(([k, v]) => `${k} ${v}`).join(", ")}. By risk level (lab-invented score): {Object.entries(sum.byLevel).map(([k, v]) => `L${k} ${v}`).join(", ")}.</p>
        <div className="chips" role="group" aria-label="Platform filter">
          <button type="button" aria-pressed={source === "all"} onClick={() => setSource("all")} data-testid="filter-all">All ({sum.live})</button>
          {sum.bySource.map((x) => <button key={x.source} type="button" aria-pressed={source === x.source} onClick={() => setSource(x.source)} data-testid={`filter-${x.source}`}>{x.name} ({x.count})</button>)}
        </div>
        <div className="filters">
          <label>Minimum risk level
            <select value={level} onChange={(e) => setLevel(e.target.value)} data-testid="filter-level"><option value="all">any</option>{story.levels.map((l) => <option key={l.level} value={l.level}>L{l.level} {l.name} and above</option>)}</select>
          </label>
          <label className="check"><input type="checkbox" checked={needsAction} onChange={(e) => setNeedsAction(e.target.checked)} data-testid="filter-action" /> Action required only</label>
          <label className="check"><input type="checkbox" checked={recent} onChange={(e) => setRecent(e.target.checked)} data-testid="filter-recent" /> Recently discovered only</label>
        </div>
      </section>

      <section className="panel" aria-label="Agents">
        <h3 className="panel__sub">Agents ({rows.length})</h3>
        <div className="scroll"><table className="tbl tbl--wide" data-testid="agents">
          <thead><tr><th>Agent</th><th>Source</th><th>Scope</th><th>Model</th><th>Custodian</th><th>Status</th><th>Risk</th><th>Needs</th><th><span className="sr-only">Detail</span></th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} data-testid={`agent-${a.id}`}>
                <td><code>{visible(a.name)}</code></td><td>{a.sourceName}</td><td>{a.scope}</td><td>{a.model}{a.modelDeprecated ? " (deprecated)" : ""}</td>
                <td>{a.custodian ? visible(a.custodian) : <span className="tag" data-state="bad">orphaned</span>}{a.custodianDeparted ? <span className="tag" data-state="bad">custodian left</span> : null}</td>
                <td><StatusTag status={a.status} />{a.quarantined ? <span className="tag" data-state="warn">quarantined</span> : null}{a.revoked ? <span className="tag" data-state="warn">access revoked</span> : null}</td>
                <td><LevelTag level={a.assessment.level} name={a.assessment.levelName} /> <span className="muted">{a.assessment.score}</span></td>
                <td>{a.actionRequired.length ? a.actionRequired.join(", ") : "-"}</td>
                <td><button type="button" aria-pressed={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)} data-testid={`open-${a.id}`}>Detail</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9}>No agent matches the filters.</td></tr>}
          </tbody>
        </table></div>
      </section>

      {detail && <AgentDetail a={detail} />}

      <section className="panel" aria-label="AWS Organizations" data-testid="org-panel">
        <h3 className="panel__sub">AWS Organizations: accounts enumerated and onboarded by organizational unit <SourceTag source="deck" /></h3>
        <p className="muted">Organization {s.org.id} (fake). A new account in an onboarded unit is picked up at the next sync. {s.provider.released ? "The new account has appeared." : "A new account will appear before the second scan."}</p>
        <div className="seg" role="group" aria-label="Organizational units">
          {s.org.ous.map((o) => <button key={o.id} type="button" aria-pressed={s.org.onboardedOus.includes(o.id)} disabled={readOnly} onClick={() => toggleOu(o.id)} data-testid={`ou-${o.id}`}>{o.label}{s.org.onboardedOus.includes(o.id) ? ": onboarded" : ": not onboarded"}</button>)}
        </div>
        {readOnly && <p className="muted">Mock only reads tables: switch to Live to change the scope.</p>}
        <div className="scroll"><table className="tbl">
          <thead><tr><th>Account</th><th>Unit</th><th>Status</th><th>Reach</th></tr></thead>
          <tbody>{s.org.accounts.map((c) => <tr key={c.id} data-testid={`account-${c.id}`}><td>{c.id}</td><td>{c.ou}</td><td><StatusTag status={c.status === "onboarded" ? "onboarded" : "not onboarded"} /></td><td>{c.reach}</td></tr>)}</tbody>
        </table></div>
      </section>

      <details data-testid="availability">
        <summary>What is available, what is roadmap (slide 21)</summary>
        <div className="scroll"><table className="tbl tbl--wide">
          <thead><tr><th>Capability</th><th>Availability</th><th>What the lab does</th></tr></thead>
          <tbody>{story.availability.map((x) => <tr key={x.capability}><td>{x.capability}</td><td><AvailTag value={x.availability} /></td><td>{x.lab}</td></tr>)}</tbody>
        </table></div>
      </details>
      <FieldSources fields={story.fieldSources} />
    </div>
  );
}

function AgentDetail({ a }) {
  const list = (items, render) => (items.length ? <ul className="plain">{items.map(render)}</ul> : <p className="muted">none</p>);
  return (
    <section className="panel" aria-label={`Detail of ${a.name}`} data-testid="agent-detail">
      <h3 className="panel__sub">Deep agent anatomy: <code>{visible(a.name)}</code> <SourceTag source="deck" label="deck claim (slides 45 and 58); record shape lab-invented" /></h3>
      <div className="cols">
        <div>
          <h4>Identity and configuration</h4>
          <ul className="plain">
            <li>Source: {a.sourceName} ({a.id})</li><li>Scope: {a.scopeLabel}</li><li>Model: {a.model}{a.modelDeprecated ? " (deprecated)" : ""}</li>
            <li>Execution identity: <code>{visible(a.identity.name)}</code> ({a.identity.kind}); permission surface: {a.identity.surface}</li>
            <li>Authentication: {a.config.authentication}; public access: {String(a.config.publicAccess)}; logging: {String(a.config.logging)}</li>
            <li>Custodian: {a.custodian ? visible(a.custodian) : "none (orphaned)"}</li>
            <li>Discovered in run {a.discoveredAtRun} via {a.discoveredVia.path === "workload-scanner" ? `the Workload Scanner running in ${a.discoveredVia.scannerRunsIn.kind} ${a.discoveredVia.scannerRunsIn.id}` : "the controller"}</li>
            <li>Classification: {a.classification.result} ({a.classification.basis})</li>
          </ul>
          <h4>Tags</h4>{list(Object.entries(a.tags), ([k, v]) => <li key={k}>{k}: {visible(v)}</li>)}
        </div>
        <div>
          <h4>Permissions (execution identity)</h4>
          {list(a.identity.permissions, (p) => <li key={p.id}>{visible(p.grant)}{p.class !== "normal" ? ` [${p.class}]` : ""}{p.inert ? " (inert: detached, revoked or its credential is off)" : ""}</li>)}
          <h4>Tools</h4>{list(a.tools, (t) => <li key={t.id}>{t.name}{t.write ? " (writes)" : ""}{t.egress ? " (sends data out)" : ""}</li>)}
          <h4>Knowledge bases</h4>{list(a.knowledgeBases, (k) => <li key={k.id}>{visible(k.name)} ({k.sensitivity})</li>)}
          <h4>Guardrails</h4>{list(a.guardrails, (g) => <li key={g}>{g}</li>)}
        </div>
        <div>
          <h4>Credentials</h4>{list(a.credentials, (c) => <li key={c.id}>{c.name}: rotated {c.rotatedDaysAgo} days ago, {c.enabled ? "enabled" : "disabled"}</li>)}
          <h4>Bindings</h4>{list(a.bindings, (b) => <li key={b.id}>{b.role}{b.roleExists ? "" : " (role missing)"}</li>)}
          <h4>Sub-agents</h4>{list(a.subAgents, (x) => <li key={x}>{x}</li>)}
          {a.flows.length > 0 && (<><h4>Flows</h4>{list(a.flows, (f) => <li key={f.id}>{f.name}{f.privileged ? " (privileged)" : ""}: {f.running ? "running" : "stopped"}</li>)}</>)}
          {a.card && (<><h4>A2A agent card (Google Agent Registry)</h4><pre className="json" tabIndex={0} data-testid="agent-card">{visible(JSON.stringify(a.card, null, 2))}</pre></>)}
        </div>
      </div>
    </section>
  );
}
