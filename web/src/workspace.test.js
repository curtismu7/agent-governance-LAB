// The workspace id: the page's rule and the server's rule agree; a saved id the rule refuses is replaced at once; a 400 bad_workspace makes one new id and ONE retry.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validWorkspaceId as serverValid } from "../../server/src/workspaces.js";
import { forgetWorkspace, newWorkspaceId, validWorkspaceId, workspaceFetch, workspaceId } from "./workspace";

const GOOD = ["default", "w-0123456789abcdef", "abc-1", "w-b1-hook", "a", "ab-".repeat(13) + "a", "a".repeat(23), "0".repeat(23), "w-sweep-hook", "my-tokens", "tokens-1", "passwords", "w-ab-12-cd"];
const BAD = ["", "A", "a b", "a/b", "ab-".repeat(13) + "ab", "sk-abcdefghijklmnop1234", "pw-hunter2xyz", "pw-x", "token-abc", "a-password-b", "ghp-abcdefghijkl", "glpat-xxxxxxxx", "xoxb-1234-abcd", "akia-abc", "eyjhbgcioijiuzi1nij9", "eyjx", "a".repeat(24), "0".repeat(24), "w-0123456789abcdef01234567", "hunter2xyz\n", "sk", "x-sk-y", "pwd-1", "secret-1", "bearer-abc"];

describe("workspace id rule", () => {
  it("the page's rule and the server's rule agree on a table of ids (23 hex in a row is fine, 24 is not; 40 characters is fine, 41 is not)", () => {
    for (const id of GOOD) { expect(validWorkspaceId(id), id).toBe(true); expect(serverValid(id), id).toBe(true); }
    for (const id of BAD) { expect(validWorkspaceId(id), JSON.stringify(id)).toBe(false); expect(serverValid(id), JSON.stringify(id)).toBe(false); }
    expect(GOOD.length).toBe(13); expect(BAD.length).toBe(25);
    for (const nonString of [undefined, null, 5, ["a"], {}]) { expect(validWorkspaceId(nonString)).toBe(false); expect(serverValid(nonString)).toBe(false); }
  });

  it("1000 generated ids all hold a letter, are 18 characters, and pass the server's rule", () => {
    for (let i = 0; i < 1000; i += 1) {
      const id = newWorkspaceId();
      expect(id).toMatch(/[a-z]/); expect(id).toHaveLength(18); expect(id).toMatch(/^w-[0-9a-f]{16}$/); expect(id.slice(2)).toMatch(/[a-f]/);
      expect(serverValid(id)).toBe(true);
    }
  });
});

describe("workspaceFetch", () => {
  const realFetch = globalThis.fetch;
  let calls;
  const answer = (list) => { let i = 0; globalThis.fetch = async (_u, init) => { calls.push(init.headers["x-workspace"]); return list[Math.min(i++, list.length - 1)](); }; };
  const refuse = () => new Response(JSON.stringify({ error: "bad_workspace" }), { status: 400, headers: { "content-type": "application/json" } });
  const ok = () => new Response("{}", { status: 200 });
  beforeEach(() => { calls = []; forgetWorkspace(); window.sessionStorage.clear(); });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("a saved id the page's rule refuses is replaced at once, and the replacement is saved under agl.workspace; a good saved id is kept", () => {
    window.sessionStorage.setItem("agl.workspace", "pw-hunter2xyz");
    const id = workspaceId();
    expect(id).not.toBe("pw-hunter2xyz"); expect(validWorkspaceId(id)).toBe(true);
    expect(window.sessionStorage.getItem("agl.workspace")).toBe(id);
    forgetWorkspace(); window.sessionStorage.setItem("agl.workspace", "w-0123456789abcdef");
    expect(workspaceId()).toBe("w-0123456789abcdef");
  });

  it("a 400 bad_workspace makes a new id and asks once more; a second refusal, another 400 and a non-JSON 400 are returned as they are", async () => {
    answer([refuse, ok]);
    const first = workspaceId();
    const r = await workspaceFetch("/api/reset", { method: "POST", body: "{}" });
    expect(r.status).toBe(200); expect(calls).toHaveLength(2); expect(calls[0]).toBe(first); expect(calls[1]).not.toBe(first);
    expect(window.sessionStorage.getItem("agl.workspace")).toBe(calls[1]);
    calls = []; answer([refuse, refuse, ok]);
    expect((await workspaceFetch("/api/state")).status).toBe(400); expect(calls).toHaveLength(2); // one retry, never a loop
    calls = []; answer([() => new Response(JSON.stringify({ error: "bad_mode" }), { status: 400 }), ok]);
    expect((await workspaceFetch("/api/state")).status).toBe(400); expect(calls).toHaveLength(1);
    calls = []; answer([() => new Response("not json", { status: 400 }), ok]);
    expect((await workspaceFetch("/api/state")).status).toBe(400); expect(calls).toHaveLength(1);
    calls = []; answer([ok]);
    expect((await workspaceFetch("/api/state")).status).toBe(200); expect(calls).toHaveLength(1);
  });
});
