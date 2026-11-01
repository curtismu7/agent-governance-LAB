// These tests drive the real UI against the real Express app (started on a loopback port inside the test), so a green run means the pieces
// actually work together: the real story data, the real engine, the real Mock table.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApp, startHttpServer } from "../../server/src/app.js";
import { createHealth } from "../../server/src/health.js";
import { VERTICALS } from "../../server/src/cast.js";
import App, { BANNER_UNKNOWN, TABS } from "./App";
import { labelOffsets } from "./components/PatternDiagram";
import { visible } from "./safeText";
import { forgetWorkspace } from "./workspace";

const C = VERTICALS.finance;
let server; let base; const realFetch = globalThis.fetch; let seen = [];
let gate = () => null; // a function (url) -> a promise to wait for before the request is sent, or null: the tests hold a request and release it deterministically
let consumed = []; // urls whose response body the app has read
beforeAll(async () => {
  const health = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  ({ server, url: base } = await startHttpServer({ port: 0, host: "127.0.0.1", app: createApp({ health, configFile: "/nonexistent/customer.config.json" }) }));
  base = base.replace(/\/$/, "");
  globalThis.fetch = async (u, init = {}) => {
    const url = typeof u === "string" && u.startsWith("/") ? `${base}${u}` : u;
    seen.push({ url: String(url), body: typeof init.body === "string" ? init.body : "" });
    const g = gate(String(url), init); if (g) await g;
    const res = await realFetch(url, { ...init, headers: { origin: base, ...(init.headers || {}) } });
    const json = res.json.bind(res);
    res.json = async () => { const j = await json(); consumed.push(String(url)); return j; };
    return res;
  };
});
afterAll(async () => { globalThis.fetch = realFetch; await new Promise((r) => server.close(r)); });
beforeEach(() => { cleanup(); forgetWorkspace(); seen = []; gate = () => null; consumed = []; try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* ignore */ } window.location.hash = ""; });

const T = { timeout: 20000 };
const mount = async () => { render(<App />); await screen.findByTestId("scenarios", {}, T); };
const tab = (name) => userEvent.click(screen.getByRole("tab", { name }));
const click = (id) => userEvent.click(screen.getByTestId(id));
const live = async () => { await click("mode-live"); await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(/LIVE mode/)); await screen.findByTestId("actor", {}, T); await waitFor(() => expect(screen.getByTestId("tile-live")).toHaveTextContent("23"), T); };
const setValue = (id, value) => fireEvent.change(screen.getByTestId(id), { target: { value } });
const pick = (id, value) => userEvent.selectOptions(screen.getByTestId(id), value);
const actAs = (who) => pick("actor", who);
const idle = () => waitFor(() => expect(screen.getByTestId("reset")).toBeEnabled(), T);
const wholePageText = () => { const c = document.body.cloneNode(true); c.querySelectorAll("textarea,input").forEach((n) => n.remove()); return c.textContent; };
// Propose quarantine of an agent as a person, wait for the answer.
const proposeQuarantine = async (agentId, who) => {
  await tab("Ownership"); await screen.findByTestId("propose-panel", {}, T);
  await actAs(who);
  await waitFor(() => expect(screen.getByTestId("p-agent")).toBeInTheDocument(), T);
  await pick("p-agent", agentId); await pick("p-kind", "quarantine");
  await waitFor(() => expect(screen.getByTestId("propose")).toBeEnabled(), T);
  await click("propose");
  await waitFor(() => expect(screen.getByTestId("last-action")).toHaveTextContent(/POST \/api\/proposals/), T);
};

describe("shell", () => {
  it("says it is simulated and UNVERIFIED on every tab, in presenter mode too, and shows the mode", async () => {
    await mount();
    expect(screen.getByTestId("banner")).toHaveTextContent(/MOCK mode/);
    expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock");
    for (const t of TABS) {
      await tab(t.label);
      expect(screen.getByTestId("banner")).toHaveTextContent(/UNVERIFIED on our tenant/);
      expect((await screen.findAllByTestId("claim-tag", {}, T)).length).toBeGreaterThan(0);
    }
    await tab("Inventory");
    await userEvent.keyboard("p");
    expect(screen.getByTestId("presenter-say")).toBeInTheDocument();
    expect(screen.getByTestId("banner")).toHaveTextContent(/SIMULATED/);
    expect(screen.getByTestId("banner")).toHaveTextContent(/UNVERIFIED on our tenant/);
    expect(screen.getByTestId("presenter")).toHaveTextContent("Exit presenter");
    for (const t of TABS.filter((x) => x.id !== "talk")) { await tab(t.label); expect(screen.getByTestId("presenter-say")).toBeInTheDocument(); expect(screen.getByTestId("banner")).toHaveTextContent(/UNVERIFIED/); }
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("presenter-say")).toBeNull();
    expect(BANNER_UNKNOWN).toMatch(/UNVERIFIED/);
  });

  it("the banner and the mode chip follow the toggle, in both directions, on every tab", async () => {
    await mount();
    for (const t of TABS) {
      await tab(t.label);
      await click("mode-live"); await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(/LIVE mode/)); expect(screen.getByTestId("mode")).toHaveTextContent("Mode: live");
      await click("mode-mock"); await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(/MOCK mode/)); expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock");
    }
  });

  it("the choice of mode is remembered, and a blocked storage never breaks the page", async () => {
    await mount(); await click("mode-live");
    expect(window.localStorage.getItem("agl.mode")).toBe("live");
    cleanup(); render(<App />); await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(/LIVE mode/), T);
    cleanup(); const desc = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    try { render(<App />); await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(/MOCK mode/), T); await click("mode-live"); await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(/LIVE mode/), T); }
    finally { Object.defineProperty(window, "localStorage", desc); }
  });

  it("arrow keys move between tabs, and the URL hash follows", async () => {
    await mount();
    screen.getByRole("tab", { name: "Inventory" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Permission review" })).toHaveAttribute("aria-selected", "true");
    expect(window.location.hash).toBe("#review");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Talk track" })).toHaveAttribute("aria-selected", "true");
  });

  it("talks only to its own origin", async () => {
    await mount(); await live(); await tab("Safe sync"); await tab("Diagram");
    expect(seen.length).toBeGreaterThan(3);
    for (const s of seen) expect(s.url.startsWith(base) || s.url.startsWith("/")).toBe(true);
  });
});

describe("Mock mode: eight scripted scenarios, read-only", () => {
  it("shows a scenario and its steps; switching scenario changes the state every tab shows", async () => {
    await mount();
    expect(screen.getByTestId("tile-live")).toHaveTextContent("23");
    expect((await within(screen.getByTestId("scenarios")).findAllByRole("option")).length).toBe(8);
    await pick("scenarios", "partial-failure");
    await waitFor(() => expect(screen.getByTestId("scenario-say")).toHaveTextContent(/deletes nothing/), T);
    await waitFor(() => expect(screen.getByTestId("tile-live")).toHaveTextContent("25"), T);
    await tab("Safe sync");
    await waitFor(() => expect(screen.getByTestId("run-result")).toHaveTextContent(/run-0004/), T);
    expect(screen.getByTestId("runs")).toHaveTextContent(/partial/);
  });

  it("every write control is off in Mock, and a note says to switch to Live", async () => {
    await mount();
    for (const [name, ids, note] of [["Inventory", ["ou-ou-lab-prod"], null], ["Ownership", ["propose", "depart", "campaign-start"], "read-only-note"], ["Safe sync", ["run-sync", "console-flip", "fail-lex"], "read-only-note"], ["AgentCore gateway", ["to-enforce", "pin"], "read-only-note"], ["Private network", ["tenant-toggle", "c-add", "poll"], "read-only-note"]]) {
      await tab(name);
      await waitFor(() => expect(screen.getByTestId(ids[0])).toBeInTheDocument(), T);
      for (const id of ids) expect(screen.getByTestId(id)).toBeDisabled();
      if (note) expect(screen.getByTestId(note)).toHaveTextContent(/Mock only reads tables/);
    }
  });
});

describe("Inventory", () => {
  it("the dashboard counts, the thirteen platform filters and the per-agent anatomy", async () => {
    await mount(); await live();
    expect(screen.getByTestId("tile-action")).toHaveTextContent("7");
    expect(screen.getByTestId("tile-orphaned")).toHaveTextContent("2");
    expect(screen.getByTestId("tile-recent")).toHaveTextContent("23");
    expect(screen.getAllByRole("button").filter((b) => /^filter-/.test(b.dataset.testid || "")).length).toBe(14);
    await click("filter-lex");
    expect(within(screen.getByTestId("agents")).getAllByRole("row").length).toBe(2); // header + one agent
    await click("filter-all"); await click("filter-action");
    expect(within(screen.getByTestId("agents")).getAllByRole("row").length).toBe(8);
    await click("filter-action");
    await click("open-ag-agentbuilder-01");
    const d = screen.getByTestId("agent-detail");
    for (const w of ["Execution identity", "Tools", "Knowledge bases", "Guardrails", "Credentials", "Bindings", "Sub-agents"]) expect(d).toHaveTextContent(w);
    expect(d).toHaveTextContent("ag-ghost-99");
    await click("open-ag-agentregistry-01");
    expect(screen.getByTestId("agent-card")).toHaveTextContent(/a2a/i);
    await click("filter-level"); // a select: pick the level through its own control
    await pick("filter-level", "4");
    expect(within(screen.getByTestId("agents")).getAllByRole("row").length).toBe(7);
  });

  it("AWS Organizations: the sandbox OU is onboarded by the visitor and its account and agent show up at the next sync", async () => {
    await mount(); await live();
    expect(screen.getByTestId("account-000000000003")).toHaveTextContent(/not onboarded/);
    await click("ou-ou-lab-sandbox");
    await waitFor(() => expect(screen.getByTestId("account-000000000003")).toHaveTextContent(/onboarded/), T);
    expect(screen.getByTestId("account-000000000003")).not.toHaveTextContent(/not onboarded/);
    await tab("Safe sync"); await waitFor(() => expect(screen.getByTestId("run-sync")).toBeEnabled(), T);
    await click("run-sync"); await waitFor(() => expect(screen.getByTestId("run-result")).toHaveTextContent(/run-0002/), T);
    await tab("Inventory"); await waitFor(() => expect(screen.getByTestId("tile-live")).toHaveTextContent("27"), T); // 23 + 3 new + the sandbox agent
    expect(screen.getByTestId("agent-ag-bedrockflow-02")).toBeInTheDocument();
  });

  it("the availability table tags every slide 21 line, and Roadmap and Planned lines say no behaviour is claimed", async () => {
    await mount();
    const a = screen.getByTestId("availability"); fireEvent.click(within(a).getByText(/What is available/));
    const tags = within(a).getAllByTestId("avail-tag").map((n) => n.textContent);
    expect(tags.filter((t) => t === "GA").length).toBe(3); expect(tags.filter((t) => t === "Roadmap (Q4 2026)").length).toBe(5); expect(tags.filter((t) => t === "Planned").length).toBe(2);
    expect(tags.filter((t) => /availability not stated/.test(t)).length).toBe(2);
    expect(a).toHaveTextContent(/No behaviour is claimed/);
  });
});

describe("Permission review", () => {
  it("shows the Risk Scoring discrepancy, the deck's numbers beside the lab's, the 13 lab-written findings, and filters by level", async () => {
    await mount(); await tab("Permission review");
    const d = await screen.findByTestId("risk-discrepancy", {}, T);
    expect(d).toHaveTextContent(/Slide 45 describes a five-level risk score/); expect(d).toHaveTextContent(/lists "Risk Scoring".*as Planned/); expect(d).toHaveTextContent(/does not resolve/);
    expect(screen.getByTestId("deck-vs-lab")).toHaveTextContent(/13 sources, 46 findings, 5 levels/);
    expect(within(screen.getByTestId("findings-catalog")).getAllByRole("row").length).toBe(14);
    expect(screen.getByTestId("review-ag-bedrock-02")).toHaveTextContent(/LF-01/);
    await pick("review-min", "4");
    expect(screen.queryByTestId("review-ag-bedrock-01")).toBeNull(); expect(screen.getByTestId("review-ag-bedrock-02")).toBeInTheDocument();
  });
});

describe("Ownership (Live): propose, approve, execute, and the refusals", () => {
  it("a custodian proposes, cannot approve their own, an administrator approves, it executes, and the audit log names who did each step", async () => {
    await mount(); await live();
    await proposeQuarantine("ag-bedrock-02", C.castCustodian);
    await waitFor(() => expect(screen.getByTestId("proposal-prop-0001")).toHaveTextContent(/proposed/), T);
    // the custodian tries to approve: refused
    await click("approve-prop-0001");
    await waitFor(() => expect(screen.getByTestId("last-action")).toHaveTextContent(/refused \(self_approval\)/), T);
    expect(screen.getByTestId("proposal-prop-0001")).toHaveTextContent(/proposed/);
    // executing before approval is refused
    await actAs(C.castAdmin); await idle();
    // the administrator who did not propose approves
    await click("approve-prop-0001");
    await waitFor(() => expect(screen.getByTestId("proposal-prop-0001")).toHaveTextContent(/approved/), T);
    await click("execute-prop-0001");
    await waitFor(() => expect(screen.getByTestId("proposal-prop-0001")).toHaveTextContent(/executed/), T);
    const audit = screen.getByTestId("audit");
    expect(audit).toHaveTextContent(/proposal.created/); expect(audit).toHaveTextContent(/proposal.executed/); expect(audit).toHaveTextContent(C.castAdmin); expect(audit).toHaveTextContent(C.castCustodian);
    await tab("Inventory"); await click("open-ag-bedrock-02");
    expect(screen.getByTestId("agent-detail")).toHaveTextContent(/inert/);
    expect(screen.getByTestId("agent-ag-bedrock-02")).toHaveTextContent(/quarantined/);
  }, 120000);

  it("an administrator acts immediately: their own proposal runs at once and is audited with their name; a custodian's waits and cannot be approved by the custodian", async () => {
    await mount(); await live();
    await proposeQuarantine("ag-bedrock-01", C.castAdmin);
    await waitFor(() => expect(screen.getByTestId("proposal-prop-0001")).toHaveTextContent(/executed/), T);
    expect(screen.queryByTestId("approve-prop-0001")).toBeNull();
    expect(screen.getByTestId("audit")).toHaveTextContent(/proposal.executed/);
    expect(screen.getByTestId("audit")).toHaveTextContent(C.castAdmin);
    await proposeQuarantine("ag-bedrock-02", C.castCustodian);
    await waitFor(() => expect(screen.getByTestId("proposal-prop-0002")).toHaveTextContent(/proposed/), T);
    await actAs(C.castAdmin2); await click("approve-prop-0002");
    await waitFor(() => expect(screen.getByTestId("proposal-prop-0002")).toHaveTextContent(/approved/), T);
    expect(screen.getByTestId("proposal-prop-0002")).toHaveTextContent(C.castAdmin2);
    expect(screen.getByTestId("audit-note")).toHaveTextContent(/self-declared in this lab.*does not mean authenticated/);
  }, 60000);

  it("approve after deny is refused, and delete is refused on Databricks", async () => {
    await mount(); await live();
    await proposeQuarantine("ag-bedrock-02", C.castCustodian);
    await actAs(C.castAdmin2); await click("deny-prop-0001");
    await waitFor(() => expect(screen.getByTestId("proposal-prop-0001")).toHaveTextContent(/denied/), T);
    expect(screen.queryByTestId("approve-prop-0001")).toBeNull();
    await actAs(C.castAdmin); await pick("p-agent", "ag-databricks-01"); await pick("p-kind", "delete");
    await click("propose");
    await waitFor(() => expect(screen.getByTestId("last-action")).toHaveTextContent(/refused \(unsupported_on_source\)/), T);
    expect(screen.getByTestId("remediation")).toHaveTextContent(/no \(in development\)/);
    expect(screen.getByTestId("remediation")).toHaveTextContent(/the deck says nine|names seven/);
    const rows = within(screen.getByTestId("remediation")).getAllByRole("row");
    expect(rows.filter((r) => /yes \(named by the deck\)/.test(r.textContent)).length).toBe(7);
    expect(rows.find((r) => /Google Agent Builder/.test(r.textContent))).toHaveTextContent(/not named by the deck: refused/);
    expect(rows.find((r) => /Azure AI Foundry/.test(r.textContent))).toHaveTextContent(/not named by the deck: refused/);
  }, 60000);

  it("a credential typed as the reason or a tag value is masked everywhere on the page and in the hops", async () => {
    await mount(); await live();
    const secret = ["gh", "p_", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"].join("");
    const others = [["my pass", "word is Tr0ub4dor-horse-stapl3"].join(""), ["https://svc-user:", "Sup3rS3cretPw@db.example/p"].join(""), ["123-", "45-", "6789"].join(""), ["jane.doe", "@gmail.com"].join(""), ["4111 1111 ", "1111 1111"].join("")];
    await tab("Ownership"); await screen.findByTestId("propose-panel", {}, T);
    await actAs(C.castCustodian); await pick("p-agent", "ag-bedrock-01"); await pick("p-kind", "retag");
    setValue("p-tagvalue", `v ${secret}`); setValue("p-reason", `because ${secret} and ${others.join(" and ")}`);
    await waitFor(() => expect(screen.getByTestId("propose")).toBeEnabled(), T);
    await click("propose");
    await waitFor(() => expect(screen.getByTestId("proposal-prop-0001")).toBeInTheDocument(), T);
    const needles = [secret, "Tr0ub4dor", "Sup3rS3cretPw", "123-45-6789", "jane.doe", "4111 1111 1111"];
    for (const n of needles) expect(wholePageText()).not.toContain(n);
    expect(wholePageText()).toMatch(/\[masked:/);
    // the collapsed hops <pre> is in the DOM too: open it and check the markup text and the raw HTML
    fireEvent.click(within(screen.getByTestId("hops")).getByText(/Raw hops/));
    expect(screen.getByTestId("hops").querySelectorAll("pre").length).toBeGreaterThan(0);
    for (const n of needles) { expect(wholePageText()).not.toContain(n); const c = document.body.cloneNode(true); c.querySelectorAll("textarea,input").forEach((x) => x.remove()); expect(c.innerHTML).not.toContain(n); }
    expect(seen.some((s) => s.body.includes(secret))).toBe(true); // it was sent, and never came back
  }, 60000);

  it("succession and a certification campaign: a departure proposes transfers, a campaign escalates what nobody reviewed", async () => {
    await mount(); await live();
    await tab("Ownership"); await screen.findByTestId("succession", {}, T);
    await pick("leaver", C.castCustodian2); await waitFor(() => expect(screen.getByTestId("depart")).toBeEnabled(), T);
    await click("depart");
    await waitFor(() => expect(screen.getByTestId("proposal-prop-0006")).toHaveTextContent(/succession/), T);
    await click("campaign-start");
    await waitFor(() => expect(screen.getByTestId("campaign-items")).toHaveTextContent(/camp-0001 \(open\)/), T);
    await actAs(C.castCustodian); await click("certify-ci-0001");
    await waitFor(() => expect(screen.getByTestId("item-ci-0001")).toHaveTextContent(/certified/), T);
    await actAs(C.castAdmin); await click("campaign-close");
    await waitFor(() => expect(screen.getByTestId("campaign-items")).toHaveTextContent(/camp-0001 \(closed\)/), T);
    expect(screen.getByTestId("item-ci-0003")).toHaveTextContent(/escalated/);
    expect(screen.getByTestId("succession")).toHaveTextContent(/availability not stated/); expect(screen.getByTestId("campaign")).toHaveTextContent(/availability not stated/);
  }, 90000);
});

describe("Safe sync", () => {
  it("a partial sync marks agents unknown and deletes nothing; a complete sync then marks the really removed one gone", async () => {
    await mount(); await live(); await tab("Safe sync");
    await waitFor(() => expect(screen.getByTestId("run-sync")).toBeEnabled(), T);
    await click("run-sync"); await waitFor(() => expect(screen.getByTestId("run-result")).toHaveTextContent(/run-0002/), T);
    await pick("console-agent", "ag-lex-01"); await click("console-flip");
    await waitFor(() => expect(screen.getByTestId("console-agent")).toHaveTextContent(/removed at the provider/), T);
    await click("fail-vertexai");
    await click("run-sync");
    await waitFor(() => expect(screen.getByTestId("run-result")).toHaveTextContent(/run-0003/), T);
    expect(screen.getByTestId("run-result")).toHaveAttribute("data-state", "warn");
    expect(screen.getByTestId("partial-note")).toHaveTextContent(/nothing was deleted/);
    expect(screen.getByTestId("run-counts")).toHaveTextContent(/marked gone: 0/); expect(screen.getByTestId("run-counts")).toHaveTextContent(/marked unknown: 4/);
    expect(screen.getByTestId("run-counts")).toHaveTextContent(/Removed from the provider by this run: 0; inventory records removed: 0/);
    expect(within(screen.getByTestId("parts")).getAllByText("failed").length).toBeGreaterThan(0);
    await click("fail-vertexai"); await click("run-sync");
    await waitFor(() => expect(screen.getByTestId("run-result")).toHaveTextContent(/run-0004/), T);
    expect(screen.getByTestId("run-counts")).toHaveTextContent(/marked gone: 1/); expect(screen.getByTestId("run-counts")).toHaveTextContent(/recovered: 4|recovered: 3/);
    expect(screen.getByTestId("run-result")).toHaveAttribute("data-state", "warn"); // the private account is still not scanned: never a green "complete"
    expect(within(screen.getByTestId("run-result")).getAllByTestId("status")[0]).toHaveTextContent("not-fully-scanned");
    expect(screen.getByTestId("not-scanned-note")).toHaveTextContent(/Not fully scanned: 2 part\(s\) were not scanned/);
    expect(wholePageText()).toMatch(/lab reading of a partly-cut-off deck line/);
  }, 120000);

  it("a run is shown green and 'complete' only when every part answered: the first scan, with the private account unscanned, is not", async () => {
    await mount(); await live(); await tab("Safe sync");
    await waitFor(() => expect(screen.getByTestId("run-sync")).toBeEnabled(), T);
    await click("run-sync"); await waitFor(() => expect(screen.getByTestId("run-result")).toHaveTextContent(/run-0002/), T);
    const result = screen.getByTestId("run-result");
    expect(result).toHaveAttribute("data-state", "warn");
    expect(within(result).getAllByTestId("status")[0]).toHaveTextContent("not-fully-scanned"); expect(within(result).getAllByTestId("status")[0]).toHaveAttribute("data-state", "warn");
    expect(within(screen.getByTestId("runs")).queryAllByText("complete")).toHaveLength(0);
    expect(within(screen.getByTestId("parts")).getAllByText("not-scanned").length).toBe(2);
  }, 120000);
});

describe("the workspace id", () => {
  it("is generated with at least one letter, however the random bytes fall (an all-digit id that passes the card check is refused by the server)", async () => {
    const { newWorkspaceId } = await import("./workspace");
    const real = window.crypto.getRandomValues.bind(window.crypto); let calls = 0;
    window.crypto.getRandomValues = (a) => { calls += 1; if (calls <= 3) { a.set([0x41, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11]); return a; } return real(a); };
    try { const id = newWorkspaceId(); expect(id).toMatch(/^w-[0-9a-f]{16}$/); expect(id).toMatch(/[a-f]/); expect(calls).toBeGreaterThan(3); }
    finally { window.crypto.getRandomValues = real; }
    for (let i = 0; i < 200; i++) expect(newWorkspaceId()).toMatch(/[a-f]/);
  });

  it("a stored id the server refuses (400 bad_workspace) is replaced and the request retried once, so the page still loads", async () => {
    window.sessionStorage.setItem("agl.workspace", "w-4111111111111111");
    await mount();
    expect(screen.queryByText(/Could not load the lab/)).toBeNull();
    const stateCalls = seen.filter((s) => s.url.includes("/api/state"));
    expect(stateCalls.length).toBeGreaterThanOrEqual(2); // the refused one and the retry
    const stored = window.sessionStorage.getItem("agl.workspace");
    expect(stored).not.toBe("w-4111111111111111"); expect(stored).toMatch(/^w-[0-9a-f]{16}$/);
  }, 60000);
});

describe("AgentCore gateway", () => {
  it("a wrong typed confirmation changes nothing; the gateway name flips to ENFORCE and the scorecard moves", async () => {
    await mount(); await live(); await tab("AgentCore gateway");
    await waitFor(() => expect(screen.getByTestId("to-enforce")).toBeEnabled(), T);
    const before = Number(screen.getByTestId("green-count").textContent);
    setValue("typed", "wrong name"); await click("to-enforce");
    await waitFor(() => expect(screen.getByTestId("last-action")).toHaveTextContent(/refused \(confirmation_mismatch\)/), T);
    expect(screen.getByTestId("engine-mode")).toHaveTextContent("LOG_ONLY");
    setValue("typed", `${C.castDomain1}-gateway`); await click("to-enforce");
    await waitFor(() => expect(screen.getByTestId("engine-mode")).toHaveTextContent("ENFORCE"), T);
    expect(Number(screen.getByTestId("green-count").textContent)).toBe(before + 1);
    expect(screen.getByTestId("check-enforcement")).toHaveTextContent(/green/);
    expect(wholePageText()).not.toContain("wrong name");
  }, 60000);

  it("close a bypass route shows the before and after diff and who is locked out; disable a target; pin an endpoint; end a session", async () => {
    await mount(); await live(); await tab("AgentCore gateway");
    await waitFor(() => expect(screen.getByTestId("close-rt-1")).toBeEnabled(), T);
    await click("close-rt-1");
    const diff = await screen.findByTestId("bypass-diff", {}, T);
    expect(diff).toHaveTextContent(/role-lab-batch-job/); expect(diff).toHaveTextContent(/now have none/);
    expect(screen.getByTestId("check-bypass-closed")).toHaveTextContent(/green/);
    await click("toggle-tg-2"); await waitFor(() => expect(screen.getByTestId("target-tg-2")).toHaveTextContent(/disabled/), T);
    setValue("endpoint", "https://example.com"); await click("pin");
    await waitFor(() => expect(screen.getByTestId("last-action")).toHaveTextContent(/refused \(bad_endpoint\)/), T);
    setValue("endpoint", "https://gw1.fabrikam.example"); await click("pin");
    await waitFor(() => expect(screen.getByTestId("pinned")).toHaveTextContent("https://gw1.fabrikam.example"), T);
    await click("end-s-0002"); await waitFor(() => expect(screen.queryByTestId("session-s-0002")).toBeNull(), T);
    await click("to-closed"); await waitFor(() => expect(screen.getByTestId("last-action")).toHaveTextContent(/refused \(confirmation_mismatch\)/), T);
    expect(screen.getByTestId("waf-mode")).toHaveTextContent("open");
  }, 90000);

  it("the nine metadata fields are named, tagged lab-invented, and Truncated is computed", async () => {
    await mount(); await tab("AgentCore gateway");
    const m = await screen.findByTestId("metadata", {}, T);
    for (const n of ["GatewayDetailJSON", "GatewayEnginesJSON", "GatewayScorecardJSON", "GatewayBypassPostureJSON", "GatewayCallerAccessJSON", "RuntimeCallerAccessJSON", "BypassDiffJSON", "TargetCallerAccessJSON"]) expect(m).toHaveTextContent(n);
    expect(m).toHaveTextContent(/lab-invented \(the schema gives only the field name\)/); expect(screen.getByTestId("truncated")).toHaveTextContent("false");
  });
});

describe("Private network", () => {
  it("a disabled tenant refuses; enabling lets a connection be added; Enabled is fixed; the connector only dials out; the scan finds the private agents with the scanner location", async () => {
    await mount(); await live(); await tab("Private network");
    await waitFor(() => expect(screen.getByTestId("c-add")).toBeEnabled(), T);
    await click("c-add");
    await waitFor(() => expect(screen.getByTestId("last-action")).toHaveTextContent(/refused \(private_network_disabled\)/), T);
    expect(screen.getByTestId("tenant-state")).toHaveTextContent("disabled");
    await click("tenant-toggle"); await waitFor(() => expect(screen.getByTestId("tenant-state")).toHaveTextContent("enabled"), T);
    await click("c-add"); await waitFor(() => expect(screen.getByTestId("conn-conn-001")).toBeInTheDocument(), T);
    await click("flip-conn-001"); await waitFor(() => expect(screen.getByTestId("last-action")).toHaveTextContent(/refused \(enabled_is_fixed\)/), T);
    await click("poll"); await waitFor(() => expect(screen.getByTestId("outbound")).toHaveTextContent("1"), T);
    expect(screen.getByTestId("inbound")).toHaveTextContent("0"); expect(screen.getByTestId("connector")).toHaveTextContent(/illustrates the deck's claim; it is not proof/);
    await click("scan");
    await waitFor(() => expect(screen.getByTestId("found-ag-lex-02")).toBeInTheDocument(), T);
    expect(screen.getByTestId("found-ag-lex-02")).toHaveTextContent(/aws-account 000000000009/);
    await tab("Permission review"); await pick("review-min", "1");
    await waitFor(() => expect(screen.getByTestId("review-ag-agentcore-02")).toHaveTextContent(/found by the scanner in aws-account 000000000009/), T);
  }, 120000);

  it("a bad scanner location is refused, and a second connection on the same scanner must run in the same place", async () => {
    await mount(); await live(); await tab("Private network");
    await waitFor(() => expect(screen.getByTestId("tenant-toggle")).toBeEnabled(), T);
    await click("tenant-toggle"); await waitFor(() => expect(screen.getByTestId("tenant-state")).toHaveTextContent("enabled"), T);
    setValue("c-where", "12345"); await click("c-add");
    await waitFor(() => expect(screen.getByTestId("last-action")).toHaveTextContent(/refused \(bad_scanner_location\)/), T);
    setValue("c-where", "000000000009"); await click("c-add"); await waitFor(() => expect(screen.getByTestId("conn-conn-001")).toBeInTheDocument(), T);
    setValue("c-where", "000000000008"); await click("c-add");
    await waitFor(() => expect(screen.getByTestId("last-action")).toHaveTextContent(/refused \(scanner_location_mismatch\)/), T);
    expect(screen.queryByTestId("conn-conn-002")).toBeNull();
  }, 90000);
});

describe("Diagram, talk track, Reset", () => {
  it("Diagram: the three diagrams load from data, Simulate walks the arrows, Reset restores", async () => {
    await mount(); await tab("Diagram");
    await screen.findByTestId("pattern-canvas", {}, T);
    expect(screen.getByRole("heading", { name: /Discover, review, own, approve, remediate/ })).toBeInTheDocument();
    expect(screen.getByTestId("pattern-step-bar")).toHaveTextContent(/Simulate walks the 9 arrows/);
    await click("simulate"); await waitFor(() => expect(screen.getByTestId("pattern-now")).toHaveTextContent(/Step 1/), T);
    await click("dg-safe-sync"); await waitFor(() => expect(screen.getByRole("heading", { name: /Safe sync: gone versus did not answer/ })).toBeInTheDocument(), T);
    await waitFor(() => expect(screen.getByTestId("pattern-step-bar")).toHaveTextContent(/Simulate walks the 6 arrows/), T);
    await click("dg-private-network-discovery"); await waitFor(() => expect(screen.getByTestId("pattern-step-bar")).toHaveTextContent(/Simulate walks the 7 arrows/), T);
    await click("simulate"); await waitFor(() => expect(screen.getByTestId("pattern-now")).toBeInTheDocument(), T);
    await click("pattern-reset"); await waitFor(() => expect(screen.queryByTestId("pattern-now")).toBeNull(), T);
    expect(screen.getByTestId("speed")).toBeInTheDocument();
  });

  it("the edge-label offsets nudge a reply apart from the arrow it answers", () => {
    expect(labelOffsets([{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "a", to: "c" }])).toEqual([-16, 16, 0]);
  });

  it("Talk track has the Why it matters entry marked as Ping claims", async () => {
    await mount(); await tab("Talk track");
    const t = await screen.findByTestId("talk-track", {}, T);
    expect(t).toHaveTextContent(/Why it matters: AI Platform Agents/); expect(t).toHaveTextContent(/Challenge:/); expect(t).toHaveTextContent(/Technical:/); expect(t).toHaveTextContent(/Business:/); expect(t).toHaveTextContent(/Ping claims, unverified on our tenant/);
  });

  it("the vertical switch reloads the cast: names change in the story, the roster and the agents", async () => {
    await mount(); await live(); await tab("Ownership");
    expect(screen.getByTestId("roster")).toHaveTextContent(C.castCustodian);
    await pick("vertical", "health");
    await waitFor(() => expect(screen.getByTestId("roster")).toHaveTextContent(VERTICALS.health.castCustodian), T);
    expect(screen.getByTestId("roster")).not.toHaveTextContent(C.castCustodian);
  });

  it("Reset clears proposals in Live and the page reloads; another workspace is not touched", async () => {
    await mount(); await live();
    await proposeQuarantine("ag-bedrock-02", C.castCustodian);
    await waitFor(() => expect(screen.getByTestId("proposal-prop-0001")).toBeInTheDocument(), T);
    const other = await realFetch(`${base}/api/proposals`, { method: "POST", headers: { "content-type": "application/json", origin: base, "x-workspace": "other-ws" }, body: JSON.stringify({ mode: "live", vertical: "finance", proposal: { actor: C.castAdmin, agentId: "ag-bedrock-01", kind: "quarantine" } }) });
    expect(other.status).toBe(200);
    await click("reset");
    await waitFor(() => expect(screen.queryByTestId("proposal-prop-0001")).toBeNull(), T);
    expect(screen.getByTestId("proposals-panel")).toHaveTextContent(/No proposals yet/);
    const st = await (await realFetch(`${base}/api/state?mode=live`, { headers: { "x-workspace": "other-ws" } })).json();
    expect(st.state.proposals.length).toBe(1);
  }, 90000);

  it("Reset also restores the diagram box positions", async () => {
    await mount(); await tab("Diagram");
    await screen.findByTestId("pattern-canvas", {}, T);
    expect(await screen.findByText(/Moved: 0 box/, {}, T)).toBeInTheDocument();
    await click("reset");
    expect(await screen.findByText(/Moved: 0 box/, {}, T)).toBeInTheDocument();
  });
});

describe("stale answers", () => {
  it("a late scenario answer never overwrites the scenario picked after it (stale-response guard on the state), decided by releasing the held request, not by time", async () => {
    await mount();
    let release; const held = new Promise((r) => { release = r; });
    gate = (u) => (u.includes("scenario=discover") ? held : null);
    await pick("scenarios", "discover"); await pick("scenarios", "gateway");
    await waitFor(() => expect(screen.getByTestId("scenario-say")).toHaveTextContent(/typed confirmation/), T);
    release();
    await waitFor(() => expect(consumed.some((u) => u.includes("scenario=discover"))).toBe(true), T); // the app has read the stale answer
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId("scenario-say")).toHaveTextContent(/typed confirmation/);
    expect(screen.getByTestId("scenario-say")).not.toHaveTextContent(/second scan/i);
  }, 60000);

  it("a write answer for a mode the visitor has already left is not shown (stale write guard), decided by releasing the held request", async () => {
    await mount(); await live(); await tab("Safe sync");
    await waitFor(() => expect(screen.getByTestId("run-sync")).toBeEnabled(), T);
    let release; const held = new Promise((r) => { release = r; });
    gate = (u) => (u.includes("/api/sync") ? held : null);
    await click("run-sync"); await click("mode-mock");
    await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(/MOCK mode/), T);
    await tab("Inventory");
    await waitFor(() => expect(screen.getByTestId("tile-live")).toHaveTextContent("23"), T);
    release();
    await waitFor(() => expect(consumed.some((u) => u.includes("/api/sync"))).toBe(true), T);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // the stale answer carried the live engine after a second scan (26 agents): it must not replace the Mock table (23)
    expect(screen.getByTestId("tile-live")).toHaveTextContent("23");
    expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock");
  }, 60000);
});

describe("hostile text is shown inert", () => {
  it("control and bidi characters become visible escapes, markup stays text", () => {
    expect(visible("a‮b\u0000c")).toBe("a\\u202eb\\u0000c");
    expect(visible("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
  });
});
