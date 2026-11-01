import { useState } from "react";
import { visible } from "../safeText";
import { ClaimTag, FieldSources, Outcome, SourceTag, StatusTag } from "./Bits";

// Safe sync (slide 45): discovery distinguishes "this agent is gone" from "the provider did not answer". If any part of a sync fails, nothing is deleted and
// agents not seen are marked unknown, not gone. The slide's line about what the run does after a partial failure is partly cut off in the PDF: this is a LAB READING.
export default function SyncTab({ story, lab, actor }) {
  const s = lab.state; const ro = lab.readOnly;
  const [failing, setFailing] = useState([]);
  const [kind, setKind] = useState(story.failureKinds[0]);
  const [pick, setPick] = useState("");
  const runs = s.sync.runs.slice().reverse(); const last = s.sync.last;
  const toggle = (id) => setFailing((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const run = () => lab.act("POST", "/api/sync", { sync: { actor, failures: failing.map((source) => ({ source, kind })) } });
  const present = new Set(s.provider.present);
  const candidates = s.agents.filter((a) => a.status === "active" || a.status === "unknown");
  const agentId = candidates.some((a) => a.id === pick) ? pick : candidates[0]?.id || "";
  const flip = () => lab.act("POST", "/api/provider/change", { change: { agentId, present: !present.has(agentId) } });
  return (
    <div className="stack">
      {ro && <p className="muted" data-testid="read-only-note">Mock only reads tables: switch to Live to run a sync.</p>}
      <section className="panel">
        <h2 className="panel__title">Safe sync <ClaimTag /> <SourceTag source="reading" label="lab reading of a partly-cut-off deck line" /></h2>
        <p className="muted">A sync has one part per provider and scope. A run is <strong>complete</strong> only when every part answered and no agent was left unknown; if some of the estate was not scanned (a private network with no enabled connection, or an organizational unit that is not onboarded) it is <strong>not-fully-scanned</strong>. If every part answers, an agent that was not seen is marked <strong>gone</strong>. If any part fails, nothing is deleted and an agent that was not seen is marked <strong>unknown</strong>, never gone; a later complete run recovers or confirms it. The deck line about what a run does after a partial failure is cut off in the PDF, so this behaviour is the lab's reading, not the deck's words.</p>
        <p className="muted">The lab's world moves on between the first and second scan: three new agents appear in cloud consoles and a new AWS account appears. The first scan has run; the next sync finds them.</p>
        <h3 className="panel__sub">Make a provider not answer (injected failure)</h3>
        <div className="chips" role="group" aria-label="Providers that will not answer">
          {story.sources.map((x) => <button key={x.id} type="button" aria-pressed={failing.includes(x.id)} disabled={ro} onClick={() => toggle(x.id)} data-testid={`fail-${x.id}`}>{x.name}</button>)}
        </div>
        <label className="inline">Failure kind{" "}<select value={kind} onChange={(e) => setKind(e.target.value)} disabled={ro} data-testid="fail-kind">{story.failureKinds.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
        <p><button type="button" className="primary" disabled={ro || lab.busy} onClick={run} data-testid="run-sync">Run a sync{failing.length ? ` (${failing.length} provider${failing.length > 1 ? "s" : ""} will not answer)` : ""}</button></p>
        <Outcome last={lab.last} prefix="/api/sync" />
        <h3 className="panel__sub">Play the cloud console</h3>
        <p className="muted">Delete an agent at the provider (or bring it back) without telling the governance console. A complete sync marks it gone; a partial one marks it unknown.</p>
        <div className="filters">
          <label>Agent<select value={agentId} onChange={(e) => setPick(e.target.value)} data-testid="console-agent">{candidates.map((a) => <option key={a.id} value={a.id}>{visible(a.name)} ({a.sourceName}) {present.has(a.id) ? "present" : "removed at the provider"}</option>)}</select></label>
        </div>
        <button type="button" disabled={ro || !agentId || lab.busy} onClick={flip} data-testid="console-flip">{present.has(agentId) ? "Delete it in the console" : "Bring it back in the console"}</button>
        <Outcome last={lab.last} prefix="/provider" />
      </section>

      {last && (
        <section className="panel" aria-label="Run result" data-testid="run-result" data-state={last.outcome === "complete" ? "ok" : "warn"}>
          <h3 className="panel__sub">Run result: {last.id} <StatusTag status={last.outcome} /></h3>
          <ul className="plain" data-testid="run-counts">
            <li>Discovered: {last.discovered.length}; recovered: {last.recovered.length}; marked <strong>gone</strong>: {last.gone.length}; marked <strong>unknown</strong>: {last.unknown.length}</li>
            <li>Accounts enumerated and onboarded: {last.enumerated.length ? last.enumerated.join(", ") : "none"}</li>
            <li>Removed from the provider by this run: {last.removedFromProvider}; inventory records removed: {last.inventoryRecordsRemoved} (both measured before and after the run)</li>
            {last.outcome === "partial" && <li data-testid="partial-note">Partial run: nothing was deleted, and every agent not seen is unknown, not gone.</li>}
            {last.outcome === "not-fully-scanned" && <li data-testid="not-scanned-note">Not fully scanned: {last.parts.filter((p) => p.status === "not-scanned").length} part(s) were not scanned (a private network with no enabled connection) and {last.unknown.length} agent(s) are unknown because their part or organizational unit was not scanned. The parts that were scanned still mark what they no longer see as gone. This is not a complete run.</li>}
          </ul>
          {(last.gone.length > 0 || last.unknown.length > 0) && <p className="muted">Gone: {last.gone.map(visible).join(", ") || "none"}. Unknown: {last.unknown.map(visible).join(", ") || "none"}.</p>}
          <div className="scroll"><table className="tbl tbl--wide" data-testid="parts">
            <thead><tr><th>Source</th><th>Scope</th><th>Via</th><th>Part</th><th>Seen</th><th>New</th><th>Note</th></tr></thead>
            <tbody>{last.parts.map((p) => <tr key={`${p.source}|${p.scope}`}><td>{p.source}</td><td>{p.scope}</td><td>{p.via}</td><td><StatusTag status={p.status} /></td><td>{p.seen}</td><td>{p.discovered}</td><td>{p.reason ? visible(p.reason) : ""}</td></tr>)}</tbody>
          </table></div>
        </section>
      )}

      <section className="panel" aria-label="Run history">
        <h3 className="panel__sub">Runs ({runs.length})</h3>
        <p className="muted" data-testid="runs-note">The list keeps the newest {story.limits.runs} runs; {s.auditInfo.runsDropped} older ones have been dropped from it (the audit log keeps one entry per sync).</p>
        <div className="scroll"><table className="tbl" data-testid="runs">
          <thead><tr><th>Run</th><th>By</th><th>Outcome</th><th>New</th><th>Gone</th><th>Unknown</th></tr></thead>
          <tbody>{runs.map((r) => <tr key={r.id}><td>{r.id}</td><td>{visible(r.by)}</td><td><StatusTag status={r.outcome} /></td><td>{r.discovered.length}</td><td>{r.gone.length}</td><td>{r.unknown.length}</td></tr>)}</tbody>
        </table></div>
      </section>
      <FieldSources fields={story.fieldSources.filter((f) => /sync|Injected/i.test(f.field))} />
    </div>
  );
}
