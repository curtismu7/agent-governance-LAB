import { useState } from "react";
import { visible } from "../safeText";
import { ClaimTag, FieldSources, Json, Outcome, SourceTag, StatusTag } from "./Bits";

const NINE = ["GatewayDetailJSON", "GatewayEnginesJSON", "GatewayScorecardJSON", "GatewayBypassPostureJSON", "GatewayCallerAccessJSON", "RuntimeCallerAccessJSON", "BypassDiffJSON", "TargetCallerAccessJSON", "Truncated"];

// Governing the AgentCore gateway itself (slides 35 and 45): the gateway is an object of policy, not just a route. Every change is an administrator action with an audit entry;
// the two risky flips need the gateway name typed. The inner shapes of the nine metadata fields are lab-invented (the schema gives only the field name).
export default function GatewayTab({ story, lab, actor }) {
  const s = lab.state; const ro = lab.readOnly;
  const [gid, setGid] = useState("");
  const gw = s.gateways.find((g) => g.id === gid) || s.gateways[0];
  const [typed, setTyped] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [bypass, setBypass] = useState(null);
  const go = async (action) => {
    const r = await lab.act("POST", `/api/gateways/${encodeURIComponent(gw.id)}/actions`, { action: { actor, ...action } });
    if (r.body?.result?.bypassDiff) setBypass(r.body.result);
    return r;
  };
  const card = gw.scorecard;
  return (
    <div className="stack">
      {ro && <p className="muted" data-testid="read-only-note">Mock only reads tables: switch to Live to change a gateway.</p>}
      <section className="panel">
        <h2 className="panel__title">Governing the AgentCore gateway itself <ClaimTag /> <span className="tag" data-state="ok" data-testid="avail-tag">NEW (slides 35 and 45)</span></h2>
        <p className="muted">The gateway is an object of policy, not just a route: enable or disable a tool target, switch the WAF between fail-open and fail-closed, close a bypass route, pin an endpoint, end a session, and flip log-only to enforcing, the last behind a typed confirmation. Only a tenant administrator may change a gateway (lab reading). Acting as <strong>{visible(actor)}</strong>.</p>
        <div className="seg" role="group" aria-label="Gateway">
          {s.gateways.map((g) => <button key={g.id} type="button" aria-pressed={g.id === gw.id} onClick={() => { setGid(g.id); setTyped(""); setBypass(null); }} data-testid={`gw-${g.id}`}>{visible(g.name)}</button>)}
        </div>
        <p className="muted">Gateway <code>{gw.id}</code>; authorizer {gw.authorizer.type}; policy engine {gw.engine.id} in <strong data-testid="engine-mode">{gw.engine.mode}</strong>; WAF fails <strong data-testid="waf-mode">{gw.wafFailureMode === "fail-closed" ? "closed" : "open"}</strong>; endpoint {gw.pinnedEndpoint ? <code data-testid="pinned">{visible(gw.pinnedEndpoint)}</code> : "not pinned"}.</p>
      </section>

      <section className="panel" aria-label="Scorecard" data-testid="scorecard">
        <h3 className="panel__sub">Scorecard: <span data-testid="green-count">{card.greenCount}</span> of {card.total} checks green <SourceTag source="invented" label="the twelve checks are the swagger description's; each rule is the lab's" /></h3>
        <div className="scroll"><table className="tbl"><thead><tr><th>Check</th><th>Result</th><th>Why</th></tr></thead>
          <tbody>{card.checks.map((c) => <tr key={c.id} data-testid={`check-${c.id}`}><td>{c.name}</td><td><StatusTag status={c.green ? "green" : "red"} /></td><td>{visible(c.why)}</td></tr>)}</tbody></table></div>
      </section>

      <section className="panel" aria-label="Policy engine and WAF" data-testid="engine-panel">
        <h3 className="panel__sub">Log-only to enforcing, and the WAF failure mode</h3>
        <p className="muted">Flipping the policy engine to ENFORCE, or the WAF to fail-closed, needs the gateway name typed exactly: <code>{visible(gw.name)}</code>. The deck names the typed confirmation for the enforcing flip; for fail-closed it is the lab's reading. A wrong text changes nothing.</p>
        <label>Type the gateway name to confirm<input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck="false" data-testid="typed" /></label>
        <div className="seg">
          <button type="button" disabled={ro || lab.busy} onClick={() => go({ kind: "set-enforcement", mode: "ENFORCE", confirm: typed })} data-testid="to-enforce">Flip to ENFORCE</button>
          <button type="button" disabled={ro || lab.busy} onClick={() => go({ kind: "set-enforcement", mode: "LOG_ONLY" })} data-testid="to-logonly">Back to LOG_ONLY</button>
          <button type="button" disabled={ro || lab.busy} onClick={() => go({ kind: "set-waf", mode: "fail-closed", confirm: typed })} data-testid="to-closed">WAF: fail closed</button>
          <button type="button" disabled={ro || lab.busy} onClick={() => go({ kind: "set-waf", mode: "fail-open" })} data-testid="to-open">WAF: fail open</button>
        </div>
      </section>

      <section className="panel" aria-label="Tool targets" data-testid="targets">
        <h3 className="panel__sub">Tool targets</h3>
        <div className="scroll"><table className="tbl"><thead><tr><th>Target</th><th>Tools</th><th>State</th><th><span className="sr-only">Action</span></th></tr></thead>
          <tbody>{gw.targets.map((t) => (
            <tr key={t.id} data-testid={`target-${t.id}`}><td>{t.name}</td><td>{t.tools}</td><td><StatusTag status={t.enabled ? "enabled" : "disabled"} /></td>
              <td><button type="button" disabled={ro || lab.busy} onClick={() => go({ kind: "set-target", target: t.id, enabled: !t.enabled })} data-testid={`toggle-${t.id}`}>{t.enabled ? "Disable" : "Enable"}</button></td></tr>))}</tbody></table></div>
      </section>

      <section className="panel" aria-label="Bypass routes" data-testid="runtimes">
        <h3 className="panel__sub">Bypass routes (runtimes callable around the gateway)</h3>
        <div className="scroll"><table className="tbl tbl--wide"><thead><tr><th>Runtime</th><th>Network</th><th>Resource policy</th><th>Direct callers</th><th><span className="sr-only">Action</span></th></tr></thead>
          <tbody>{gw.runtimes.map((r) => { const open = r.resourcePolicy !== "gateway-only" || r.callers.some((c) => c.direct); return (
            <tr key={r.id} data-testid={`runtime-${r.id}`}><td>{visible(r.name)}</td><td>{r.networkMode}</td><td>{r.resourcePolicy}</td>
              <td>{r.callers.filter((c) => c.direct).map((c) => `${visible(c.principal)}${c.viaGateway ? "" : " (bypass only)"}`).join(", ") || "none"}</td>
              <td><StatusTag status={open ? "open" : "closed"} /> <button type="button" disabled={ro || lab.busy} onClick={() => go({ kind: "close-bypass", runtime: r.id })} data-testid={`close-${r.id}`}>Close the bypass route</button></td></tr>); })}</tbody></table></div>
        {bypass && (
          <div data-testid="bypass-diff">
            <h4>Bypass diff for {bypass.runtime}: before and after</h4>
            <div className="cols"><div><p className="muted">Before</p><Json value={bypass.bypassDiff.before} label="bypass diff before" /></div><div><p className="muted">After</p><Json value={bypass.bypassDiff.after} label="bypass diff after" /></div></div>
            <p>Principals whose only path was the bypass route and who now have none: {bypass.lockedOut.length ? bypass.lockedOut.map(visible).join(", ") : "none"}.</p>
          </div>
        )}
      </section>

      <section className="panel" aria-label="Endpoint and sessions" data-testid="pin-sessions">
        <h3 className="panel__sub">Pin an endpoint</h3>
        <label>Endpoint (https, a .example or .invalid host, no path)<input value={endpoint} maxLength={120} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://gateway.example" autoComplete="off" data-testid="endpoint" /></label>
        <button type="button" disabled={ro || lab.busy || !endpoint} onClick={() => go({ kind: "pin-endpoint", endpoint })} data-testid="pin">Pin it</button>
        <h3 className="panel__sub">Sessions</h3>
        <div className="scroll"><table className="tbl"><thead><tr><th>Session</th><th>Principal</th><th><span className="sr-only">Action</span></th></tr></thead>
          <tbody>{gw.sessions.map((x) => <tr key={x.id} data-testid={`session-${x.id}`}><td>{x.id}</td><td>{visible(x.principal)}</td><td><button type="button" disabled={ro || lab.busy} onClick={() => go({ kind: "end-session", session: x.id })} data-testid={`end-${x.id}`}>End session</button></td></tr>)}
            {gw.sessions.length === 0 && <tr><td colSpan={3}>No sessions.</td></tr>}</tbody></table></div>
        <Outcome last={lab.last} prefix="/gateways" />
      </section>

      <section className="panel" aria-label="Account metadata" data-testid="metadata">
        <h3 className="panel__sub">modelAgentCoreAccountMetadata <SourceTag source="swagger" /> <SourceTag source="invented" label="inner shapes lab-invented (the schema gives only the field name)" /></h3>
        <p className="muted">The nine fields below are the ones the console swagger added between 2026-10-26 and 2026-10-31 (schema only); the definition has 30 fields in all, and the 21 others are not modelled. In the real schema each is a string of JSON text; the shapes shown here are the lab's own and are computed from the gateway state above. Truncated: <strong data-testid="truncated">{String(s.agentCore.Truncated)}</strong> (computed from the size of the snapshot against a lab-invented limit).</p>
        {NINE.filter((k) => k !== "Truncated").map((k) => <details key={k}><summary>{k}</summary><Json value={s.agentCore[k]} label={k} /></details>)}
      </section>
      <FieldSources fields={story.fieldSources.filter((f) => /Gateway|gateway/.test(f.field))} />
    </div>
  );
}
