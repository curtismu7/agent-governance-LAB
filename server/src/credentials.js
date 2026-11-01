// Credential-shaped and personal-looking text. Anything a visitor types that looks like a token, a key, a password or key material is masked on the way IN
// (reason, comment) so the raw value never enters state, a receipt, an outbox entry, a hop pane, a log line or an error.
// Lab-written detectors; linear patterns only (no nested quantifiers), run on input of at most MAX_SCAN characters (longer input is not scanned and not kept).
export const MAX_SCAN = 200000;

const D = (id, re) => ({ id, re });
// Lab-written, heuristic detectors: they catch the common shapes, plain-language passwords and keys of 20 characters or more. Not every secret has a
// recognisable shape (a short random password with no keyword before it is not found), and the page says so.
export const DETECTORS = [
  D('private-key', /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----[^]{0,4000}?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----|$)/g),
  // user:password@host after a scheme (the password may hold ":" or "@"), and WITHOUT a scheme ("bob:pw@host.example", "//bob:pw@host.example")
  D('url-userinfo', /\b[a-zA-Z][a-zA-Z0-9+.-]{1,20}:\/\/[^/\s:@]{1,100}:[^\s/?#]{1,200}@/g),
  D('userinfo-noscheme', /(?<![\w@.%+~-])[A-Za-z0-9._~%+-]{1,64}:[^\s/]{1,128}@(?=[A-Za-z0-9[])/g),
  D('github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{6,}|github_pat_[A-Za-z0-9_]{6,})/g),
  D('gitlab-token', /\bglpat-[A-Za-z0-9_-]{6,}/g),
  D('slack-token', /\bxox[abprs]-[A-Za-z0-9-]{6,}/g),
  D('aws-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g),
  D('google-token', /\b(?:ya29\.[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,})/g),
  D('api-key', /\bsk-[A-Za-z0-9_-]{8,}/g),
  D('jwt', /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g),
  D('bearer', /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{10,}/gi),
  // "token abcdef1234567890" (an Authorization header): the word needs a digit, so "token requirements" is left alone
  D('token-word', /\btoken\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{12,}/gi),
  // a passphrase is several words: take the next four
  D('passphrase', /\bpassphrase\s*(?:[:=]|\bis\b)\s*\S+(?:[ \t]+\S+){0,3}/gi),
  // "Authorization: Basic xxxx", "authorization = abc123..." (the whole header value)
  D('authorization', /\bauthorization\s*[:=]\s*\S{3,}(?:[ \t]+\S{6,})?/gi),
  // "my password is Tr0ub4dor", "the passcode was zebra-Quartz-77": plain-language password statements
  D('password-is', /\b(?:password|passwd|passcode|passkey|pwd|pw)s?\s+(?:is|are|was)\s+\S{3,}/gi),
  // "the secret is x1y2z3", "api key is ...": only when the value has a digit, so "the secret is stored in the vault" is left alone
  { id: 'secret-is', re: /\b(?:secret|token|api[ _-]{0,3}key|key|credential)s?\s+(?:is|are|was)\s+\S{4,}/gi, accept: (m) => /\d/.test(m.replace(/^\S+\s+\S+\s+/, '')) },
  D('pin', /\bpin(?:[ _-]?(?:code|number))?\s*(?:[:=]|\b(?:is|are|was)\b)\s*\d{3,8}\b/gi),
  D('assignment', /(?<![A-Za-z0-9])(?:password|passwd|passcode|passkey|pwd|pw|pass|secret(?:[ _-]?key)?|token|api[ _-]{0,3}key|apikey|client[ _-]{0,3}secret|private[ _-]{0,3}key|access[ _-]{0,3}key|account[ _-]{0,3}key|session[ _-]{0,3}id|sessionid|credential)s?["']?\s*(?:[:=]|=>)\s*\S{3,}/gi),
  // JSON text: {"password":"hunter 2"}, {'apiKey': 'x'}, {"my_token":"x"}: the key is quoted (and may be glued into a longer name), the value runs to its closing quote
  D('json-assignment', /\\{0,2}["'][\w .-]{0,40}?(?<![A-Za-z])(?:(?:password|passwd|passcode|passkey|passphrase|pwd|secret|token|api[ _-]{0,3}key|apikey|client[ _-]{0,3}secret|private[ _-]{0,3}key|access[ _-]{0,3}key|account[ _-]{0,3}key|session[ _-]{0,3}id|sessionid|credential|authorization|bearer)[\w .-]{0,40}|(?:pass|pw)(?![A-Za-z0-9]))\\{0,2}["']\s{0,20}(?::|=>|=)\s{0,20}(?:\\{0,2}"[^"]{1,300}"?|\\{0,2}'[^']{1,300}'?|[^\s,}\]]{1,300})/gi),
  // "password hunter2xyz", "api key hunter2xyz", "token hunter2xyz": a credential word, a plain space, then a run of 6 or more characters that holds a digit.
  // The digit is what keeps "password reset" and "token requirements" readable; the price is "token 2026-11-02" (a date after the word), which is masked. The look-ahead
  // keeps a skipped word ("password password hunter2xyz") from eating the match that follows it.
  D('keyword-space', /(?<![A-Za-z0-9])(?:password|passwd|passcode|passkey|passphrase|pwd|pw|pass|secret|token|credential|api[ _-]{0,3}key|apikey|client[ _-]{0,3}secret|private[ _-]{0,3}key|access[ _-]{0,3}key|account[ _-]{0,3}key|session[ _-]{0,3}id|sessionid)s?[ \t]{1,20}(?=\S{0,299}\d)\S{6,300}/gi),
  // "pwd - Kk99Jj88Hh": a dash as the separator; only when the value has a letter and a digit, so "password - see the handbook" is left alone
  { id: 'password-dash', re: /\b(?:password|passwd|passcode|passkey|pwd|pw|pass)s?[ \t]+[-\u2013\u2014]+[ \t]+\S{3,}/gi, accept: (m) => { const v = m.replace(/^\S+[ \t]+\S+[ \t]+/, ''); return /\d/.test(v) && /[A-Za-z]/.test(v); } },
  // Personal-looking data: a US social security number, an email address, a payment card number (Luhn checked) and a phone number
  D('ssn', /\b\d{3}-\d{2}-\d{4}\b/g),
  D('email', /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,5}/g),
  { id: 'card', re: /\b\d(?:[ -]?\d){12,18}\b/g, accept: (m) => { const d = m.replace(/\D/g, ''); if (d.length < 13 || d.length > 19) return false; let sum = 0; for (let i = 0; i < d.length; i++) { let n = Number(d[d.length - 1 - i]); if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } sum += n; } return sum % 10 === 0; } },
  D('phone', /(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)[ .-]?|\d{3}[ .-])\d{3}[ .-]\d{4}\b/g),
  D('phone-intl', /\+\d[\d ().-]{8,16}\d/g),
  // A long run of key characters. Two detectors, both checked in code rather than with a look-ahead (to stay linear): a run of 20 or more of
  // letters, digits, _ and - that has both a letter and a digit (or is 32 or more and is not just lowercase words joined by hyphens), and a run of 32 or
  // more that also uses + / = (base64) unless it is a lowercase path such as a URL path.
  { id: 'key-like', generic: true, re: /[A-Za-z0-9_-]{20,}/g, accept: (m) => (/\d/.test(m) && /[A-Za-z]/.test(m)) || (m.length >= 32 && !/^[a-z]+(?:-[a-z]+)+$/.test(m)) },
  { id: 'long-blob', generic: true, re: /[A-Za-z0-9+/_=-]{32,}/g, accept: (m) => !/^[a-z0-9._-]+(?:\/[a-z0-9._-]+)+$/.test(m) && !/^[a-z]+(?:-[a-z]+)+$/.test(m) },
];

// Spans { start, end, id } of every credential-shaped run in the text.
export function findCredentials(text, { generic = true } = {}) {
  const t = String(text).slice(0, MAX_SCAN);
  const spans = [];
  for (const d of DETECTORS) { if (d.generic && !generic) continue; d.re.lastIndex = 0; for (const m of t.matchAll(d.re)) if (!d.accept || d.accept(m[0])) spans.push({ start: m.index, end: m.index + m[0].length, id: d.id }); }
  return spans;
}

export function maskSpans(text, spans) {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start || b.end - a.end);
  let out = ''; let at = 0;
  for (const s of sorted) { if (s.start < at) { at = Math.max(at, s.end); continue; } out += `${text.slice(at, s.start)}[masked:${s.id}]`; at = s.end; }
  return out + text.slice(at);
}

export function maskText(input) {
  const text = String(input);
  return text ? maskSpans(text, findCredentials(text)) : text;
}

// Percent-decoding, bounded to PERCENT_ROUNDS rounds. A run of %XX escapes is decoded as UTF-8; a malformed run falls back to one byte per escape, so a bad
// escape never throws. The text of every round is returned (round 0 is the input), so a credential hidden under 1, 2 or 3 layers of encoding is found.
export const PERCENT_ROUNDS = 3;
const decodeRun = (run) => { try { return decodeURIComponent(run); } catch { return run.replace(/%([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))); } };
export function percentRounds(text) {
  const rounds = [text];
  for (let i = 0; i < PERCENT_ROUNDS; i++) {
    const cur = rounds[rounds.length - 1];
    const next = cur.replace(/(?:%[0-9a-fA-F]{2})+/g, decodeRun);
    if (next === cur) break;
    rounds.push(next);
  }
  return rounds;
}

// Invisible characters are DELETED, never turned into a space: a token cannot be hidden by interleaving them ("pass<NUL>word=x", "p<SOH>a<SOH>s<SOH>s...").
// That is every default-ignorable and format (Cf) character (zero-width, soft hyphen, word joiner, BOM, bidi marks, variation selectors), U+FFFD, and every C0 and C1
// control character EXCEPT tab, newline and carriage return, which act as separators (they become a space). NFKC first (fullwidth look-alikes become the ASCII they
// imitate), and the deletion runs again after it, because NFKC can produce either kind of character.
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}\uFFFD]/gu;
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const strip = (s) => s.replace(INVISIBLE, '').replace(CONTROLS, '');
export const flatten = (s) => strip(strip(s).normalize('NFKC')).replace(/[\t\n\r\u2028\u2029]/g, ' ');
// The same text with those separators DELETED, or with "+" read as a space: the second looks. A keyword split by a tab ("pass<TAB>word=x") or glued with plus signs
// ("password+is+x") is found in one of these; a look is used only when it finds MORE than the plain one, so ordinary multi-line text stays readable.
const squeeze = (s) => strip(strip(s).normalize('NFKC')).replace(/[\t\n\r\u2028\u2029]/g, '');
const plusAsSpace = (s) => flatten(s).replace(/\+/g, ' ');
const countCreds = (t, opts) => findCredentials(t, opts).length;

// Masks text that has already been through percentRounds: the plain look, then the two second looks (kept only if they find more).
function maskLooks(raw, opts) {
  let best = flatten(raw); let bestN = countCreds(best, opts);
  for (const alt of [squeeze(raw), plusAsSpace(raw)]) { const n = countCreds(alt, opts); if (n > bestN) { best = alt; bestN = n; } }
  return { text: best, n: bestN };
}

// Free text from the visitor, cleaned: percent-encoding undone (up to three rounds; the DEEPEST decoded form that holds a credential is the one kept, masked),
// invisible characters deleted, credential-shaped runs masked, whitespace collapsed. NEVER cut to length: the caller refuses an over-long input whole (see the
// engine's `free`), so a token that straddles a limit is masked or refused, never half shown, and nothing is silently dropped. Input over MAX_SCAN is not scanned
// and is not kept either: it comes back as one marker.
export const TOO_LONG = '[masked:too-long]';
export function cleanFree(value) {
  const raw = String(value ?? '');
  if (raw.length > MAX_SCAN) return TOO_LONG;
  const rounds = percentRounds(raw);
  let pick = null;
  for (let i = rounds.length - 1; i >= 0; i--) { const l = maskLooks(rounds[i]); if (l.n) { pick = l.text; break; } }
  return maskText(pick ?? flatten(rounds[0])).replace(/\s+/g, ' ').trim();
}

// The response-time mask: the specific detectors only (no generic long-run ones), on a text of any origin. Returns the text unchanged when nothing is found.
export function maskResponseText(text) {
  if (text.length > MAX_SCAN) return TOO_LONG;
  const rounds = percentRounds(text);
  for (let i = rounds.length - 1; i >= 0; i--) {
    const l = maskLooks(rounds[i], { generic: false });
    if (l.n) return maskSpans(l.text, findCredentials(l.text, { generic: false }));
  }
  return text;
}

// For an answer that echoes only an enumerated name: true when the value is credential-shaped (the caller then refuses without echoing it).
export const looksLikeCredential = (value) => { const raw = String(value ?? ''); return raw.length > MAX_SCAN || percentRounds(raw).some((r) => maskLooks(r).n > 0); };
