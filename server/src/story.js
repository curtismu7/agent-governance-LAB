import { fillDeep, VERTICALS } from './cast.js';
import { BANNER, CLAIMS, CLAIM_LABEL, DECK_NUMBERS_TEXT, DISCREPANCIES, AVAILABILITY, FIELD_SOURCES, FIELD_SOURCE_NAMES, INTRO, LIMITS_TEXT, NOT_DEMONSTRATED, PRESENTER_TALK, RELEASE, TALK_TRACK, TITLE, WHY } from './data.js';
import { SOURCES, SCOPES, OUS, TAG_KEYS, RECONFIGURE_FIELDS, MODELS, QUARANTINE_NAMED_BY_DECK, PRIVATE_NETWORK_SOURCES } from './catalog.js';
import { DECK_NUMBERS, FINDINGS, LEVELS, SCORE_CAP, STALE_CREDENTIAL_DAYS } from './findings.js';
import { CHECKS, GATEWAY_ACTIONS } from './gateway.js';
import { LIMITS, PROPOSAL_KINDS, FAILURE_KINDS, SCANNER_KINDS } from './engine.js';
import { scenarioList } from './scenarios.js';

export const rawStory = () => ({ title: TITLE, intro: INTRO, banner: BANNER, claims: CLAIMS, talkTrack: TALK_TRACK, why: WHY, discrepancies: DISCREPANCIES, availability: AVAILABILITY });

// The story with the cast filled in.
export function buildStory(cast, vertical) {
  const s = fillDeep(rawStory(), cast);
  return {
    title: s.title, intro: s.intro, release: RELEASE, claimLabel: CLAIM_LABEL, banner: s.banner, claims: s.claims, why: s.why, deckNumbers: { ...DECK_NUMBERS, text: DECK_NUMBERS_TEXT },
    discrepancies: s.discrepancies, availability: s.availability, notDemonstrated: NOT_DEMONSTRATED,
    fieldSources: FIELD_SOURCES.map((f) => ({ ...f, sourceLabel: FIELD_SOURCE_NAMES[f.source] })), limitsText: LIMITS_TEXT, limits: LIMITS,
    sources: SOURCES.map((x) => ({ ...x, quarantineNamedByDeck: QUARANTINE_NAMED_BY_DECK.includes(x.id) })), scopes: SCOPES, ous: OUS, privateNetworkSources: PRIVATE_NETWORK_SOURCES,
    findings: FINDINGS.map((f) => ({ id: f.id, name: f.name, category: f.category, points: f.points, says: f.says })), levels: LEVELS, scoreCap: SCORE_CAP, staleCredentialDays: STALE_CREDENTIAL_DAYS, models: MODELS,
    proposalKinds: PROPOSAL_KINDS, failureKinds: FAILURE_KINDS, scannerKinds: SCANNER_KINDS, tagKeys: TAG_KEYS, reconfigureFields: RECONFIGURE_FIELDS, gatewayActions: GATEWAY_ACTIONS, scorecardChecks: CHECKS.map(([id, name]) => ({ id, name })),
    scenarios: scenarioList(cast).map((sc) => ({ id: sc.id, title: sc.title, say: sc.say })),
    talkTrack: s.talkTrack, presenterTalk: PRESENTER_TALK, cast, vertical, verticals: Object.keys(VERTICALS),
  };
}

// docs/talk-track.md is generated from the same data the UI reads (`npm run talk-track`); a test fails if they drift.
export function renderTalkTrackMarkdown(cast) {
  const s = buildStory(cast, 'finance');
  const parts = ['# Talk track', '', '<!-- Generated from server/src/data.js by `npm run talk-track`. Do not edit by hand. -->', '', `> ${s.claimLabel}: every product claim here comes from the Ping ID4AI Workforce H2 2026 deck, slides 18, 19, 21, 35, 45 and 58 (release ${s.release}). Nothing here ran against a real cloud, provider or tenant.`, '', `> ${s.deckNumbers.text}`, ''];
  for (const t of s.talkTrack) parts.push(`## ${t.title}`, '', t.say, '');
  parts.push('## What the deck leaves unresolved (shown, not resolved)', '');
  for (const d of s.discrepancies) parts.push(`- **${d.title}.** ${d.text}`);
  parts.push('', '## Availability (slide 21, and what the lab models)', '');
  for (const a of s.availability) parts.push(`- **${a.capability}** (${a.availability}): ${a.lab}`);
  parts.push('', '## The scripted scenarios (Mock mode)', '');
  s.scenarios.forEach((sc, i) => parts.push(`${i + 1}. **${sc.title}.** ${sc.say}`));
  parts.push('', '## Not demonstrated', '');
  for (const n of s.notDemonstrated) parts.push(`- ${n}`);
  return `${parts.join('\n')}\n`;
}
