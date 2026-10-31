// One dispatch for everything that changes an engine, used by the API, the scripted scenarios and the tests, so they cannot drift apart.
// A refusal from the engine is data ({ ok: false, status, code, detail }), never an exception; anything else is a bug and propagates.
import { InputError, refuse } from './errors.js';
import { AUDIT_MARGIN } from './engine.js';

const OPS = {
  sync: (e, p) => { const r = e.sync(p); return { run: r.id, outcome: r.outcome, discovered: r.discovered.length, recovered: r.recovered.length, gone: r.gone.length, unknown: r.unknown.length, failedParts: r.parts.filter((x) => x.status === 'failed').length, removedFromProvider: r.removedFromProvider, inventoryRecordsRemoved: r.inventoryRecordsRemoved }; },
  propose: (e, p) => e.propose(p),
  decide: (e, p) => e.decide(p),
  execute: (e, p) => e.execute(p),
  campaign: (e, p) => e.startCampaign(p),
  itemDecision: (e, p) => e.decideItem(p),
  depart: (e, p) => e.depart(p),
  providerChange: (e, p) => e.providerChange(p),
  onboarding: (e, p) => e.setOnboarding(p),
  privateTenant: (e, p) => e.setPrivateTenant(p),
  addConnection: (e, p) => e.addConnection(p),
  updateConnection: (e, p) => e.updateConnection(p),
  poll: (e, p) => e.connectorPoll(p),
  gateway: (e, p) => e.gateway(p?.gatewayId, p?.action),
};
export const OP_NAMES = Object.keys(OPS);

export function perform(engine, op, params) {
  if (!Object.hasOwn(OPS, op)) throw new Error(`unknown op ${op}`);
  try {
    // The audit log never drops an entry: once it is nearly full, new work is refused (Reset), so nobody can push the record of an execution out.
    if (engine.auditRoom() < AUDIT_MARGIN) throw refuse('workspace_full', `the audit log is nearly full (${engine.s.audit.length} of ${engine.s.audit.length + engine.auditRoom()} entries): Reset`, 409);
    return { ok: true, result: OPS[op](engine, params) };
  }
  catch (e) { if (e instanceof InputError) return { ok: false, status: e.status, code: e.code, detail: e.message }; throw e; }
}
