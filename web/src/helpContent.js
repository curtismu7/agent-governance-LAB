// What the Help dialog says. Plain, and as hedged as the rest of the lab (rule 2): what was measured, what is simulated, what is UNVERIFIED.
export const HELP_SECTIONS = [
  {
    heading: "What this lab is",
    body: [
      "A simulation of Ping's AI Platform Agents release claims: a cross-cloud inventory of agents across thirteen sources, a permission review with a five-level risk score, a named custodian with administrator approval before any custodian action runs, remediation, a sync that never mistakes silence for deletion, governance of the AgentCore gateway itself, and private-network discovery.",
      "Source: the Ping ID4AI Workforce H2 2026 deck (release 2026-11-02). Every product claim is a Ping release claim, UNVERIFIED on our tenant. Nothing here calls a real cloud, provider API, gateway or tenant."
    ]
  },
  {
    heading: "What was measured, and what was not",
    body: [
      "Nothing was measured on a product here. The deck's numbers are the deck's: the lab ships its own 13 illustrative findings (LF-01 to LF-13) and a lab-invented scoring rule, and shows the deck's 46-findings and Risk-Scoring discrepancy, not resolves it.",
      "Quarantine is modelled on the seven sources the deck names (the deck says nine but names two of them). The safe-sync rule (nothing deleted, unseen agents unknown) is a lab reading of a partly-cut-off deck line. Roadmap and Planned items carry their tags; no behaviour is claimed for them."
    ]
  },
  {
    heading: "Mock and Live",
    body: [
      "Mock (default): read-only tables generated from the lab's own engine running eight scripted scenarios (a doctor check and a test fail if the tables drift). Every write control is off and the API answers 409.",
      "Live (owner-run, still local): the same engine acts on your own proposals, approvals, syncs and gateway changes, as the person you pick in the Act as picker. The lab has no sign-in, so you can try the wrong person — self-approval and a custodian approving are refused, and the audit log names who acted. Live never leaves loopback and never touches a cloud.",
      "Real (Privilege): reads the live PingOne Privilege console REST API read-only with the settings file's key and secret. The banner says which mode you are in."
    ]
  },
  {
    heading: "How to use the page",
    body: [
      "Tabs: Inventory (the dashboard and per-agent deep anatomy), Permission review (the five-level score), Ownership (propose, approve or deny, execute — plus remediation, succession and the certification campaign), Safe sync (inject failures, watch a partial run mark unseen agents unknown, never gone), AgentCore gateway (disable a target, flip the WAF mode, close a bypass route, flip log-only to enforcing behind a typed confirmation), Private network, Diagram, Talk track.",
      "Diagram boxes can be dragged; Reset in the header restores them. Presenter is the P key (Esc leaves); the simulation banner stays. Vertical packs (finance, health, retail) change every name."
    ]
  },
  {
    heading: "Honest limits",
    body: [
      "Everything about the agents, accounts, ids and audit format is synthetic. Masking of credential-looking text is a heuristic, not a guarantee: do not type a real credential.",
      "Activity Collectors, Shadow AI Discovery, lifecycle management and access visualization are not modelled. State is per workspace and expires after an hour of idle time."
    ]
  }
];
