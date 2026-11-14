import { installNetguard, setAllowedHosts } from './netguard.js';
import { startHttpServer, createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { assertBindAllowed, bindHost, labProxyHosts, resolvePort } from './safety.js';
import { modeFrom } from './config.js';
import { applySharedSettings } from './settings.js';
import { privilegeConfig } from './privilegeConfig.js';

installNetguard(); // before anything else can open a socket

// The one shared settings file (rulebook): ~/Development/.env, or STANDALONE_ENV. Optional; only this lab's own key is taken; never printed.
applySharedSettings();

const checks = await runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[agent-governance-lab] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const mode = modeFrom(process.env); // refuses anything but mock, live or privilege
// Privilege (Real) mode may reach exactly one host: the configured console. Everything else stays blocked. The allowlist is set
// whenever the settings are usable (the page can switch to Real at any time), and is empty otherwise.
{
  const cfg = privilegeConfig(process.env);
  if (!cfg.ok && mode === 'privilege') throw new Error(`AGL_LAB_MODE=privilege requested but the Real settings are missing or not usable: ${cfg.problem}`);
  setAllowedHosts(cfg.ok ? [cfg.host] : []);
}
const host = assertBindAllowed(bindHost(), process.env);
const port = resolvePort();
// LAB_ALLOWED_HOSTS (the family lab-proxy's name for this lab) is parsed before the server starts.
const proxyHosts = labProxyHosts(process.env, port);
const { url } = await startHttpServer({ port, host, app: createApp({ proxyHosts }) });
console.log(`[agent-governance-lab] lab at ${url} (opens in ${mode} mode${mode === 'privilege' ? ': live Privilege console, single-host allowlist' : '; loopback, no outbound network'})`);
console.log(`[agent-governance-lab] health: ${url}api/health`);
