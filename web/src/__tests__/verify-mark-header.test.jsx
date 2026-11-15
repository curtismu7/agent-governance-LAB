// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy that
// call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
// Like App.test.jsx, the UI runs against the real Express app on a loopback port started inside the test; only /api/shelf is replaced.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { createApp, startHttpServer } from "../../../server/src/app.js";
import { createHealth } from "../../../server/src/health.js";
import App from "../App";

const ID = "agent-governance-lab";
let server; let base; const realFetch = globalThis.fetch;
let shelf = null; // the payload GET /api/shelf answers in the current test
const shelfCalls = [];
beforeAll(async () => {
  const health = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  ({ server, url: base } = await startHttpServer({ port: 0, host: "127.0.0.1", app: createApp({ health, configFile: "/nonexistent/customer.config.json" }) }));
  base = base.replace(/\/$/, "");
  globalThis.fetch = (u, init = {}) => {
    if (u === "/api/shelf" && shelf) { shelfCalls.push(init); return Promise.resolve(new Response(JSON.stringify(shelf), { headers: { "content-type": "application/json" } })); }
    return realFetch(typeof u === "string" && u.startsWith("/") ? `${base}${u}` : u, { ...init, headers: { origin: base, ...(init.headers || {}) } });
  };
});
afterAll(async () => { globalThis.fetch = realFetch; await new Promise((r) => server.close(r)); });
afterEach(() => { cleanup(); shelf = null; shelfCalls.length = 0; window.history.replaceState(null, "", "/"); });
const T = { timeout: 20000 };
const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
const topMenu = async () => within(await screen.findByTestId("top-menu", {}, T));

describe("verification mark in the header", () => {
  it("shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
    shelf = { shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: ID, verification: mark("verified", "Verified", { note: "Every claim run on the mock" }) }] };
    render(<App />);
    const bar = await topMenu();
    expect(await bar.findByText("Verified", {}, T)).toBeInTheDocument();
    expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every claim run on the mock"));
    expect(shelfCalls.every((c) => c.credentials === "omit")).toBe(true);
  });

  it("shows nothing when the lab is opened on its own port (its /api/shelf has no demos), the shelf has no mark for it, or the mark is none", async () => {
    for (const payload of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: ID, verification: null }] }, { shelfUrl: "http://shelf.example", demos: [{ id: ID, verification: mark("none", "None") }] }]) {
      shelf = payload;
      const { unmount } = render(<App />);
      const bar = await topMenu();
      expect(await bar.findByRole("link", { name: "Shelf" }, T)).toBeInTheDocument(); // the shelf answered, and still no badge
      await waitFor(() => expect(shelfCalls.length).toBeGreaterThanOrEqual(2)); // both the Shelf link and the mark asked
      expect(document.querySelector(".verify")).toBeNull();
      unmount(); shelfCalls.length = 0;
    }
  });
});
