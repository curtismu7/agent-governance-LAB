// Opened from Customer Agent LAB: the strip and the header Back button show; nothing is preselected.
// Like App.test.jsx, the UI runs against the real Express app on a loopback port started inside the test.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createApp, startHttpServer } from "../../../server/src/app.js";
import { createHealth } from "../../../server/src/health.js";
import { returnLinkFor } from "../return-link/returnTargets.js";
import App from "../App";

let server; let base; const realFetch = globalThis.fetch;
beforeAll(async () => {
  const health = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  ({ server, url: base } = await startHttpServer({ port: 0, host: "127.0.0.1", app: createApp({ health, configFile: "/nonexistent/customer.config.json" }) }));
  base = base.replace(/\/$/, "");
  globalThis.fetch = (u, init = {}) => realFetch(typeof u === "string" && u.startsWith("/") ? `${base}${u}` : u, { ...init, headers: { origin: base, ...(init.headers || {}) } });
});
afterAll(async () => { globalThis.fetch = realFetch; await new Promise((r) => server.close(r)); });
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });
const T = { timeout: 20000 };

const NOTE = { name: "Opened from Customer Agent LAB" };

describe("return link", () => {
  it("the vendored files match return-link.sha256, which names the parent commit", () => {
    const dir = path.join(process.cwd(), "src", "return-link");
    const text = fs.readFileSync(path.join(dir, "return-link.sha256"), "utf8");
    expect(text.split("\n")[0]).toMatch(/^# vendored byte for byte from curtismu7\/AI-DEMO-Standalone shared\/return-link at [0-9a-f]{7,40}/);
    const pins = text.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/));
    expect(pins.map(([, f]) => f).sort()).toEqual(["ReturnLink.jsx", "ReturnLink.test.jsx", "returnTargets.js"]);
    for (const [h, f] of pins) expect(createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex"), f).toBe(h);
  });

  it("?from=customer-agent: banner first, strip right below, header Back in the tools", async () => {
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC-NHI1&vertical=banking");
    render(<App />);
    const note = await screen.findByRole("note", NOTE);
    await screen.findByTestId("scenarios", {}, T);
    expect(note.textContent).toContain("UC-NHI1");
    expect(screen.getByTestId("banner").nextElementSibling).toBe(note);
    expect(document.querySelector(".head__tools > button.return-link--header")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /Back to Customer Agent LAB/ })).toHaveLength(2);
  });

  it("no from, an unknown from or a bad id: no strip, no button", async () => {
    for (const q of ["/", "/?from=elsewhere&uc=UC-NHI1", "/?from=customer-agent&uc=%3Cb%3E", "/?from=customer-agent&uc=UC-NHI1&vertical=a%20b"]) {
      window.history.replaceState(null, "", q);
      render(<App />);
      await screen.findByTestId("scenarios", {}, T);
      expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
      expect(screen.queryByRole("note", NOTE)).toBeNull();
      cleanup();
    }
  });

  it("Back goes to the proxy path behind the lab proxy, to the direct URL on the app's own port", () => {
    window.history.replaceState(null, "", "/agent-governance-lab/?from=customer-agent&uc=UC-NHI1");
    expect(returnLinkFor("agent-governance-lab").href).toBe("/customer-agent/?returned=agent-governance-lab&uc=UC-NHI1");
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC-NHI1");
    expect(returnLinkFor("agent-governance-lab").href).toBe("http://127.0.0.1:5603/?returned=agent-governance-lab&uc=UC-NHI1");
  });
});

  it("?from=ai-demo-standalone: strip names AI Demo Standalone, Back goes to its proxy path", () => {
    window.history.replaceState(null, "", "/agent-governance-lab/?from=ai-demo-standalone&uc=UC12");
    const ctx = returnLinkFor("agent-governance-lab");
    expect(ctx.label).toBe("AI Demo Standalone");
    expect(ctx.uc).toBe("UC12");
    expect(ctx.href).toBe("/ai-demo-standalone/?returned=agent-governance-lab&uc=UC12");
    window.history.replaceState(null, "", "/?from=ai-demo-standalone&uc=UC12");
    expect(returnLinkFor("agent-governance-lab").href).toBe("http://127.0.0.1:7810/?returned=agent-governance-lab&uc=UC12");
  });
