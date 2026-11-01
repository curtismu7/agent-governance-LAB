# Agent Governance LAB

A simulation of Ping's AI Platform Agents release claims: a cross-cloud inventory of agents across thirteen sources, a permission review with a five-level risk score, a named custodian for every agent with administrator approval before any custodian action runs, remediation, a sync that never mistakes silence for deletion, governance of the AgentCore gateway itself, and private-network discovery.

Tier: Demo
Repo: https://github.com/ping-sandbox/agent-governance-LAB
Catalog: D105

**Tier: Demo.** Source: the Ping ID4AI Workforce H2 2026 deck, slides 18, 19, 21, 35, 45 and 58, release 2026-11-02. **Every product claim is a Ping release claim, UNVERIFIED on our tenant.** Nothing here calls a real cloud, provider API, gateway, identity provider or tenant, and nothing leaves your machine.

## What is simulated

**Mock mode (default).** Everything runs offline in one process and is read-only. Eight scripted scenarios (the first scan, a second scan that finds new agents and a new account, a custodian proposal with approval and its refusals, targeted fixes, a partial sync failure, governing the gateway, private-network discovery, succession with a certification campaign) were run through the lab's own engine, and the tables the pages show are generated from that run (`server/src/mockTable.json`; a doctor check and a test fail if it drifts, and another test replays every scenario through the HTTP API and compares). Every write is refused with 409.

**Live mode (owner-run, still local).** The same engine acts on your own proposals, approvals, syncs and gateway changes. The provider world (what exists in the clouds), the inventory, the proposals, the audit log, the sync runs, the campaign, the private-network connections and the two gateways all hold real state in this process, per workspace. The banner says which mode you are in. Live never leaves loopback and never touches a cloud, a provider or a tenant.

What it shows:

1. **Inventory (AI Platform Agents, slide 45, ENHANCED and GA).** Thirteen sources, 23 agents at the first scan (29 once everything is found), fake ids and `.example` hosts. A dashboard (recently discovered, action required, orphaned, platform filters) and per-agent detail ("deep agent anatomy": identity, model, configuration, tools, knowledge bases, guardrails, credentials, bindings, sub-agents; A2A agent cards on Google Agent Registry agents). AWS Organizations accounts are enumerated and onboarded by organizational unit. The slide 21 availability table is here, with every GA, Roadmap (Q4 2026) and Planned item tagged.
2. **Permission review.** Each execution identity is read against its provider's permission surface. A five-level score is built from the lab's own 13 findings. The deck says Ping builds it from 46 findings: those are Ping's, not claimed, and the deck itself lists Risk Scoring as Planned on slide 21: the discrepancy is shown, not resolved.
3. **Ownership.** Custodians, orphans, and every custodian action as a three-step machine: for a custodian's action: propose, a tenant administrator approves or denies (never the proposer, never a custodian), then execute; an administrator's own action runs immediately, audited with the acting user (slide 45: only administrators act immediately). A transfer triggered by a custodian's departure waits for an administrator: a lab reading, not the deck. Self-approval, approve-after-deny, double approval, execute before approval and stale approvals are refused, and the audit log names the acting user. Remediation (delete on twelve of thirteen sources, quarantine on the seven sources the deck names, strip a role, stop a flow, disable a credential, retag, reconfigure), succession and a certification campaign.
4. **Safe sync.** A sync has one part per provider and scope. A partial failure deletes nothing and marks unseen agents unknown, never gone; you can inject failures and play the cloud console. The run outcome is `complete` only when every part answered and no agent was left unknown; `partial` when a provider did not answer; `not-fully-scanned` when nothing failed but part of the estate was not scanned (a private network with no enabled connection, or an organizational unit that is not onboarded). The Safe sync tab shows green only for `complete`. A fresh workspace starts `not-fully-scanned` on purpose: the private account has no connection yet.
5. **AgentCore gateway.** Enable or disable a tool target, switch the WAF failure mode, close a bypass route (with a before and after bypass diff), pin an endpoint, end a session, flip log-only to enforcing behind a typed confirmation. A twelve-check scorecard. The nine newly added `modelAgentCoreAccountMetadata` fields.
6. **Private network.** Tenant setting, connections (Enabled is fixed once added), a connector that only dials out, and findings that carry where the scanner runs.
7. **Diagram.** ReactFlow, drawn from diagram-studio/1 data loaded by name: movable boxes, Simulate, speed, Reset (restores box positions). Three diagrams.
8. **Talk track,** with a "Why it matters" entry (challenge, technical and business lines, marked as Ping claims). Also in `docs/talk-track.md`. Three vertical packs (finance, health, retail) change every name.

### What is lab-invented, lab reading, deck claim

Each field is tagged in the app as "deck claim", "console swagger name (schema only)", "lab reading" or "lab-invented". The main ones:

- **The deck's numbers are the deck's.** 13 sources, 46 findings, 5 levels (slide 45). The lab ships 13 sources, **its own 13 illustrative findings** (`LF-01` to `LF-13`, each a real rule over the seeded data with a test that it fires and a near-miss that does not), and **a lab-invented scoring rule** (points summed, capped at 100, mapped to five levels).
- **Quarantine on "nine".** Slide 45 says nine (deck claim) and names seven (Bedrock Agents and AgentCore, Lex, Vertex AI, Copilot Studio, Agentforce, Snowflake Cortex). The deck says nine but names seven; the other two are not named, so the lab models seven (lab reading). Quarantine is refused, with that reason, on every other source, including Google Agent Builder and Azure AI Foundry. Delete stays on twelve of thirteen (Databricks excluded).
- **Safe sync.** The slide 45 line about what a run does after a partial failure is partly cut off in the PDF. The lab's rule (nothing deleted, unseen agents unknown) is a **lab reading of a partly-cut-off deck line**, not the deck's words.
- **The custodian approval machine** (propose, approve or deny, execute; the roles; stale approvals) is the lab's reading of "every custodian action requires approval from a tenant administrator before it executes".
- **Succession and certification campaigns** are described on slides 18, 19 and 58 without an availability tag: "described in the deck, availability not stated".
- **Roadmap (Q4 2026) and Planned items** (Shadow AI Discovery, Agent Lifecycle Management, Agent Classification, rule-based Custodian Management, Agent Events, Access Visualization, Risk Scoring) carry their tags and an explicit statement that no behaviour is claimed.
- **Gateway.** The nine newly added metadata field names (the 2026-10-26 to 2026-10-31 diff added them; the definition has 30 fields in all, and the 21 others are not modelled) (`GatewayBypassPostureJSON`, `GatewayCallerAccessJSON`, `GatewayDetailJSON`, `GatewayEnginesJSON`, `GatewayScorecardJSON`, `BypassDiffJSON`, `RuntimeCallerAccessJSON`, `TargetCallerAccessJSON`, `Truncated`) are console swagger names (schema only, 2026-10-31); every inner shape is **lab-invented (the schema gives only the field name)**. The twelve scorecard checks are the ones the swagger description lists; each rule is the lab's. A typed confirmation on fail-closed is the lab's reading (the deck names it for the enforcing flip). Only an administrator may change a gateway: lab reading.
- **Private network.** `modelPrivateNetworkTenantConfig { Enabled }` and `modelPrivateNetworkConfig { Enabled, ScannerRunsIn }` are swagger names (schema only). The `{ kind, id }` form of ScannerRunsIn, the scanner id, the scope and source lists on a connection and the poll log are lab-invented. The "inbound: 0" count comes from the simulated log, which is outbound by construction: an illustration, not proof about the product.
- **Everything about the agents, accounts, ids, roster, audit format and logical time** is synthetic and lab-invented.

### Known limits of the model

- A reason is at most 300 characters and a comment 200 (credential-shaped and personal-looking values are masked: a lab-written heuristic, not every secret has a recognisable shape, so do not type a real one; percent-encoded text is decoded up to three rounds before matching, so `my%20password%20is%20x` is found, but a fourth layer is not, and a bare password with no keyword before it, such as `login with hunter2hunter2 please`, is not recognisable and is not masked). A workspace keeps at most 200 proposals (an agent at most 5 open), 5 campaigns and 10 private-network connections: a full workspace refuses new work (Reset). **The audit log keeps every entry**: it holds 500, and new work is refused with 409 once fewer than 40 slots are free; refused attempts (not administrator, self-approval, and so on) go to a separate ring of 200 that drops its oldest and counts them, so a flood of refusals cannot push out what was decided or executed. The sync-run list (newest 30) and the connector poll log (newest 50) are lists: older entries drop off and the UI says how many; the audit log keeps one entry per sync. The acting user is self-declared (no sign-in), so "audited" here does not mean authenticated. A sync takes at most 20 injected failures. An agent carries at most 6 tags. One answer shows at most 40 hops. A request that would break a limit is refused whole.
- There is no clock: audit times are logical (one minute per entry from a fixed start), and a campaign closes when an administrator closes it.
- Activity Collectors, Shadow AI Discovery, lifecycle management, rule-based classification, Agent Events and access visualization are not modelled.
- State is per `X-Workspace` id, 500 workspaces and one hour of idle time at most: a new workspace is refused (429) at the cap, and an idle one expires after an hour, so a flood of made-up ids cannot evict another visitor's lab. The price of that choice: 500 distinct `X-Workspace` ids exhaust the store for an hour (every new visitor then gets 429 `too_many_workspaces` with a short `detail`, until the idle ones expire or the process restarts). Refusing instead of evicting is by design; this is a local lab, not a hosted service. An id that looks like a credential is refused, never echoed. The lab has no sign-in: you choose who acts, so you can try the wrong person.

## Run from a clone

Prerequisites: Node 26 or newer. Docker only if you use the Docker form. Mock mode works with no setup at all: no tenant, no credentials, no settings file.

```
git clone https://github.com/ping-sandbox/agent-governance-LAB.git
cd agent-governance-LAB
npm ci
npm run build
npm start
```

Open http://localhost:7300/. Or in one step: `./scripts/run.sh` (installs and builds if needed, runs the doctor, starts).

## Settings file

All standalone apps read one settings file, `~/Development/.env`, which must be mode 600. `STANDALONE_ENV` overrides its path. This lab needs none of it. It parses the file (`util.parseEnv`) and takes exactly one optional key; no other key from the file ever enters the server's environment:

- `AGL_LAB_MODE` (optional): `mock` (default) or `live`, the mode the page opens in. The header toggle switches per visit. A bare `MODE` in the shared file is ignored, because it may belong to another app.

The shared file holds no `PORT`: the lab keeps its port default in code. Admin or worker credentials never belong in that file (they live in `~/.config/demo-kit/provisioning.json`), and this lab uses none. It holds no credential for any cloud either. The doctor reports whether the file exists and its mode, and never prints a value.

## Ports, and what to do if the port is taken

```
Ports: agent-governance-LAB listens on 7300 (set with PORT, default 7300).
Port range for this app: 7300-7349.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:7300 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, stop it, or start this app on another port:
   PORT=<other port> npm start
4. Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090.
```

Other variables: `VITE_PORT` (Vite dev server, default 7301, `npm run dev -w web`), `HOST_PORT` (Docker host port, default 7300). Keep all of them inside 7300-7349.

## Mock and live modes

The header has a **Mock / Live** toggle on every page, and the banner and the mode chip show the same mode. Mock reads tables generated from the engine (eight scripted scenarios per vertical; a scenario picker on the Inventory tab) and is read-only: every write control is off and the API answers 409. Live drives this workspace's engine (one per vertical) and adds an "Act as" picker (two administrators, three custodians, one member): the lab has no sign-in, so try the wrong person.

## Health, doctor and reset

```
npm run doctor   # 20 checks, including one real sync-propose-approve-execute cycle through the HTTP API; PORT=7309 npm run doctor to use a spare port
npm run reset    # clears the default workspace (inventory, proposals, audit, sync runs, campaign, private network, gateways); the UI Reset also restores the diagram
```

`GET /api/health` returns `demo-health/1`. **Honest status codes.** Every write answers with the whole fresh state and the raw hops. A refusal (self-approval, a custodian approving, an unsupported delete, a wrong typed confirmation, Enabled being fixed) is HTTP 400, 403, 404 or 409 with `ok: false` and an error code; there is no flag that turns refusals into 200. A known route called with the wrong method answers 405 with an `Allow` header; an unknown API path or a missing file (`/assets/nope.js`, `/favicon.ico`) is a fixed JSON 404 (the page is served only for paths without a file extension). The page reads a refusal as data and shows it. A browser logs a non-2xx answer in its console, so deliberately triggering a refusal in the UI leaves a console line; nothing else does. The workspace id comes in `X-Workspace`; every hop carries a W3C `traceparent`, and every write answers with the raw hops, including the simulated provider calls. Presenter mode: press `P` (Esc leaves); the simulation banner stays. `npm run mock-table`, `npm run talk-track` and `npm run content-pack` regenerate the generated files. See `docs/safety.md`.

## Docker (optional)

```
HOST_PORT=7300 docker compose up --build -d
```

The container publishes to 127.0.0.1 only (a test pins it), runs as a non-root user with a read-only file system and no capabilities. Use OrbStack, not Docker Desktop. `AGL_LAB_MODE=live` opens the page in Live mode.

## Tests

```
npm test    # server (node --test), web (vitest, drives the UI against the real server), scripts
```

The shared checks are run by hand, because the scripts are not shipped into this repo's CI: `bash <AI-DEMO-Standalone>/scripts/check-drift.sh .`, `bash <AI-DEMO-Standalone>/scripts/check-css.sh .` and `node <demo-kit-base>/scripts/conformance.mjs . --new`. Conformance warns on rule 18 on purpose: the deferred SE k8s manifests.

On Node 26: 276 tests pass (219 server, 34 web, 23 scripts).

## Troubleshooting

- **The page says "Could not load the lab".** The server is not running, or it is on another port. Start it (`npm start`) and check `PORT`.
- **Port is taken.** See "Ports, and what to do if the port is taken" above.
- **`npm start` refuses to start.** Run `npm run doctor`; the first failing line says why (Node older than 26, a port outside 7300-7349, a drifting mock table).
- **A button is greyed out.** Mock is read-only. Switch to Live in the header.
- **An action is refused.** The message names the reason (you are not an administrator, the proposer cannot approve, the source does not support delete). Nothing changes on a refusal.
- **The mock table is out of date after an engine change.** Run `npm run mock-table`; the doctor and a test tell you when it drifts.

## Ownership

- Owner: the Ping demo family owner (Demo tier).
- License: MIT (see `LICENSE`).
- Found a problem? Open an issue on the repo.

## Not done

No SE k8s build (deferred by the owner, 2026-10-31). Every product claim stays UNVERIFIED until it is measured on a tenant that has the release. The two unnamed quarantine sources (the lab models seven, not nine), the cut-off safe-sync line, the Risk Scoring discrepancy and the gateway JSON shapes remain open questions the deck and the schema do not answer.
