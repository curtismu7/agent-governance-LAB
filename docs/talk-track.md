# Talk track

<!-- Generated from server/src/data.js by `npm run talk-track`. Do not edit by hand. -->

> Ping release claim, UNVERIFIED on our tenant: every product claim here comes from the Ping ID4AI Workforce H2 2026 deck, slides 18, 19, 21, 35, 45 and 58 (release 2026-11-02). Nothing here ran against a real cloud, provider or tenant.

> The deck's numbers: 13 sources, 46 findings, 5 levels (slide 45). The lab ships 13 sources, its own 13 illustrative findings and its own 5-level score.

## Start with the problem

Agents created in cloud consoles sit outside identity processes: nobody inventoried them and nobody knows what they reach. Each over-privileged agent is a silent breach path that no current review covers. (Ping's challenge text, slide 45. Fabrikam Bank has agents in AWS, Google, Azure and three SaaS platforms.)

## One inventory across thirteen sources

The dashboard shows what was recently discovered, what needs action and a filter per platform. Open refunds-assistant: its identity, model, configuration, tools, knowledge bases, guardrails, credentials, bindings and sub-agents are all on one page. Agents from the Google Agent Registry carry their A2A agent cards, and AWS member accounts are onboarded by organizational unit.

## Permission review and a risk score

Each agent's execution identity is read against its provider. The deck says Ping builds a five-level score from 46 findings; the lab ships 13 of its own and says so. Notice the deck itself lists Risk Scoring as Planned on slide 21: we show the score, tag it, and do not pretend to resolve that.

## Every agent has a custodian, and every action is approved

An orphaned agent is flagged. maya.chen proposes quarantining an agent. Nobody approves their own proposal and a custodian cannot approve at all: only a tenant administrator can, and never the proposer. priya.nair approves, then it runs, and the audit log names who did each step. Stale approvals are refused if the agent changed in between.

## Remediation that follows the source

Delete works on twelve sources and not on Databricks, which the deck says is in development. Quarantine works on nine. Beside them are targeted fixes: strip a role, stop a privileged flow, disable a named credential, retag or reconfigure, and the score drops because the rule no longer fires.

## Succession and certification

When a custodian leaves, a transfer is proposed for each agent and an administrator approves each one. A certification campaign asks each custodian to certify or revoke; unreviewed items escalate. Both appear in the deck without an availability tag, and the lab says so.

## A sync that never mistakes silence for deletion

Run a sync with one provider failing. The lab deletes nothing and marks the agents it could not see as unknown, not gone. Run it again without the failure and an agent really removed in the console is marked gone. The deck line about what a run does after a partial failure is cut off, so this is our reading, labelled.

## The gateway is itself an object of policy

On the AgentCore tab, enable or disable a tool target, switch the WAF between fail-open and fail-closed, close a bypass route and see who was only reachable through it, pin an endpoint, end a session, and flip log-only to enforcing, which needs the gateway name typed in. The scorecard of twelve checks moves with each change.

## Agents inside your own network

A workload connector and scanner reach agents inside your network and cloud accounts, polling outbound through your proxy: nothing dials in. A tenant that has not enabled Private network cannot add a connection, Enabled is fixed once a connection is added, and every finding carries where the scanner runs.

## Why it matters: AI Platform Agents (slide 45)

Challenge: Agents created in cloud consoles sit outside identity processes: nobody inventoried them and nobody knows what they reach. Each over-privileged agent is a silent breach path that no current review covers. Technical: Cross-cloud inventory, permission review, 46-finding risk scores and one console to fix or delete. Business: Cuts agent-audit effort sharply and closes exfiltration paths before they are exploited. (Ping claims, unverified on our tenant. Per the deck, slide 45.)

## What the deck leaves unresolved (shown, not resolved)

- **Risk scoring: slide 45 vs slide 21.** Slide 45 describes a five-level risk score built from 46 findings as part of AI Platform Agents (ENHANCED, GA). Slide 21 lists "Risk Scoring" (outlier detection based on risky access and anomalous behaviour) as Planned. The deck does not say how the two relate: they may be different things (a finding-based score versus outlier detection), or the score may be only partly shipped. The lab does not resolve this: it shows a finding-based score, tags it, and claims nothing about outlier detection.
- **Quarantine: "nine" sources, seven names.** Slide 45 says quarantine works on nine sources and names seven (Bedrock Agents and AgentCore, Lex, Vertex AI, Copilot Studio, Agentforce, Snowflake Cortex). The other two are not named. The lab supports quarantine on the seven named and, as a placeholder lab reading, on Google Agent Builder and Azure AI Foundry to make nine; those two are tagged lab reading.
- **Safe sync: the line is cut off in the PDF.** The slide 45 sentence about what a run does after a partial failure is partly hidden in the PDF. The lab implements the safe behaviour (nothing is deleted; agents not seen are marked unknown, never gone) and labels it "lab reading of a partly-cut-off deck line", not the deck's words.
- **Slide 35 vs 57 naming.** Slide 35 retires "Workload Agent Discovery & Control" in favour of "AI Platform Agents"; this lab follows slide 35.

## Availability (slide 21, and what the lab models)

- **Platform Agent Discovery** (GA): Modelled: the thirteen-source inventory and the safe sync.
- **Activity Collectors** (GA): Not modelled.
- **Agent Delegated Administration** (GA): Modelled as a lab reading: custodian operations limited to administrators and the agent's custodian, with approval by a different administrator.
- **Shadow AI Discovery with Agent Privilege** (Roadmap (Q4 2026)): Not modelled. No behaviour is claimed.
- **Agent Lifecycle Management** (Roadmap (Q4 2026)): Not modelled. No behaviour is claimed. (Delete and quarantine here are the slide 45 remediation, not lifecycle management.)
- **Agent Classification** (Roadmap (Q4 2026)): No behaviour is claimed. The lab only reads an owner hint at discovery to name a custodian (lab reading of slide 19, not rule-based classification).
- **Custodian Management (rule-based assignment)** (Roadmap (Q4 2026)): No behaviour is claimed. Custodians here come from an owner hint or are assigned by hand through an approved transfer.
- **Agent Events** (Roadmap (Q4 2026)): Not modelled. No behaviour is claimed.
- **Access Visualization** (Planned): Not modelled. No behaviour is claimed.
- **Risk Scoring (outlier detection on risky access and anomalous behaviour)** (Planned): The lab shows a finding-based five-level score (slide 45) and tags it Planned; it claims nothing about outlier detection. See the discrepancy note.
- **Certification campaigns (slides 18 and 58)** (described in the deck, availability not stated): Modelled as a clock-free state machine (lab reading).
- **Succession management (slide 19)** (described in the deck, availability not stated): Modelled as proposed transfers that an administrator approves (lab reading).

## The scripted scenarios (Mock mode)

1. **The first scan: one inventory across thirteen sources.** Twenty-three agents are discovered across AWS, Google, Azure and three SaaS platforms (three more sit behind a private network or in an organizational unit that is not onboarded yet). Some have no custodian, some are public and unauthenticated, some hold administrator grants.
2. **A second scan finds new agents and a new account.** Between scans, agents are created in cloud consoles and a new AWS account appears in an onboarded organizational unit. The next sync discovers them. Onboarding the sandbox OU brings its account in at the following sync.
3. **A custodian proposes, an administrator approves, then it runs.** Every custodian action needs approval from a tenant administrator before it executes. Self-approval, a custodian approving, approving too early and an unsupported delete are all refused, and the audit log names the acting user each time.
4. **Targeted fixes bring the score down.** Strip an unused write role, stop a privileged flow, disable a named credential, close a public endpoint. Each is proposed by the custodian, approved by an administrator and executed; the finding that fired stops firing.
5. **A provider does not answer: nothing is deleted.** An agent is really deleted in a console while one provider is down. The partial run deletes nothing and marks every agent it could not see as unknown, never gone. A clean run afterwards marks the really removed agent as gone and recovers the rest.
6. **Governing the gateway itself.** Flip log-only to enforcing: a wrong typed confirmation changes nothing, the gateway name does. Close a bypass route and see who was reachable only through it. Disable a target, fail the WAF closed, pin the endpoint, end a session. The scorecard of twelve checks moves each time.
7. **Agents inside your own network.** A tenant that has not enabled Private network cannot add a connection. Enable it, add a connection whose scanner runs in an AWS account, find that Enabled is fixed once added, let the connector poll outbound, and the next sync discovers the private agents, each carrying where the scanner runs.
8. **A custodian leaves; a certification campaign runs.** When a custodian leaves, a transfer is proposed for each agent and an administrator approves each. A campaign asks each custodian to certify or revoke; a revoke goes through approval; unreviewed items escalate to an administrator.

## Not demonstrated

- Anything about how the real console, a real cloud, a real provider API or a Workload Connector behaves: nothing here ran against one. The provider calls shown are illustrations on .example hosts that are never sent.
- Ping's 46 findings: the deck does not list them. The lab's 13 findings and its scoring rule are its own.
- How the deck's five-level score is computed, and whether it is the same thing as the Planned "Risk Scoring" on slide 21.
- Which two sources besides the seven named make up the "nine" that support quarantine (placeholders here).
- What the product does after a partial sync failure (the slide line is cut off); the lab's safe behaviour is a lab reading.
- Activity Collectors, Shadow AI Discovery, Agent Lifecycle Management, rule-based classification and custodian assignment, Agent Events and Access Visualization: not modelled.
- Slide 58's "policies flag conflicting access with preventative and detective scans" and "activity monitoring": not modelled.
- The inner shapes of the AgentCore gateway JSON blobs (the schema gives only the field names), the product's real scorecard rules, its approval rules and its audit format.
- Real authentication to any provider: the lab holds no credential for any of them; anything credential-shaped you type is masked and never kept.
