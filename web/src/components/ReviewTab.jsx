import { useMemo, useState } from "react";
import { visible } from "../safeText";
import { ClaimTag, LevelTag, SourceTag } from "./Bits";

// Permission review and risk (slide 45): each agent's execution identity is read against its provider, and a five-level score is built from findings.
// The deck's numbers are 13 sources, 46 findings, 5 levels; the findings and the scoring rule here are the LAB'S OWN. The deck itself lists Risk Scoring as Planned
// (slide 21): that discrepancy is shown, not resolved.
export default function ReviewTab({ story, lab }) {
  const s = lab.state;
  const [min, setMin] = useState(1);
  const live = useMemo(() => s.agents.filter((a) => (a.status === "active" || a.status === "unknown") && a.assessment.level >= min).sort((a, b) => b.assessment.score - a.assessment.score), [s, min]);
  const risk = story.discrepancies.find((d) => d.id === "risk-scoring");
  return (
    <div className="stack">
      <section className="panel" data-state="warn" data-testid="risk-discrepancy">
        <h2 className="panel__title">Permission review and risk score <ClaimTag /> <span className="tag" data-state="bad" data-testid="avail-tag">Risk Scoring: Planned (slide 21)</span></h2>
        <p><strong>{risk.title}.</strong> {risk.text}</p>
        <p className="muted" data-testid="deck-vs-lab">{story.deckNumbers.text} <SourceTag source="invented" label="scoring rule: lab-invented" /></p>
      </section>

      <section className="panel" aria-label="Agents by risk">
        <h3 className="panel__sub">Agents, highest risk first</h3>
        <label className="inline">Minimum level{" "}
          <select value={min} onChange={(e) => setMin(Number(e.target.value))} data-testid="review-min">{story.levels.map((l) => <option key={l.level} value={l.level}>L{l.level} {l.name} and above</option>)}</select>
        </label>
        <div className="scroll"><table className="tbl tbl--wide" data-testid="review-table">
          <thead><tr><th>Agent</th><th>Execution identity read against</th><th>Level</th><th>Score</th><th>Findings (lab-written)</th></tr></thead>
          <tbody>
            {live.map((a) => (
              <tr key={a.id} data-testid={`review-${a.id}`}>
                <td><code>{visible(a.name)}</code><br /><span className="muted">{a.sourceName}</span></td>
                <td>{a.identity.surface}<br /><span className="muted">{visible(a.identity.name)}</span></td>
                <td><LevelTag level={a.assessment.level} name={a.assessment.levelName} /></td>
                <td>{a.assessment.score}</td>
                <td>{a.assessment.findings.length === 0 ? "none" : <ul className="plain">{a.assessment.findings.map((f) => <li key={f.id}><strong>{f.id}</strong> {f.name}: {visible(f.detail)} ({f.points} points){f.scannerLocation ? <span className="tag" data-state="warn" data-testid="scanner-location">found by the scanner in {f.scannerLocation.kind} {f.scannerLocation.id}</span> : null}</li>)}</ul>}</td>
              </tr>
            ))}
            {live.length === 0 && <tr><td colSpan={5}>No agent at that level.</td></tr>}
          </tbody>
        </table></div>
      </section>

      <section className="panel" aria-label="The lab's findings">
        <h3 className="panel__sub">The lab's {story.findings.length} illustrative findings <SourceTag source="invented" label="lab-written illustrative findings" /></h3>
        <p className="muted">The deck says Ping builds the score from 46 findings; those are Ping's and are not claimed. Each finding below is a rule over the seeded data, with a test that it fires and a near-miss that does not. Points are summed (cap {story.scoreCap}) and mapped to a level: {story.levels.map((l) => `L${l.level} ${l.name} from ${l.min}`).join(", ")}.</p>
        <div className="scroll"><table className="tbl tbl--wide" data-testid="findings-catalog">
          <thead><tr><th>Id</th><th>Finding</th><th>Category</th><th>Points</th><th>What it checks</th></tr></thead>
          <tbody>{story.findings.map((f) => <tr key={f.id}><td>{f.id}</td><td>{f.name}</td><td>{f.category}</td><td>{f.points}</td><td>{f.says}</td></tr>)}</tbody>
        </table></div>
      </section>
    </div>
  );
}
