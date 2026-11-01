// Defence in depth: every API response passes through maskDeep, so a credential-shaped value can never leave in any field, or in any object KEY, even if a code
// path forgot to clean its input. Iterative: a deep structure cannot overflow the stack. The generic long-run detectors are NOT applied here (ids, hashes and trace
// ids are long and legitimate); the specific token, key, bearer, userinfo, keyword and assignment detectors are, on the same normalised text (invisible characters
// deleted, percent-decoding up to three rounds) as the intake. Visitor text is already fully cleaned (long runs included) on the way in by cleanFree.
import { maskResponseText } from './credentials.js';

export { maskResponseText };
const OPAQUE = new Set(['hash', 'prevHash', 'traceparent', 'traceId', 'chainHead']);
// defineProperty, not assignment: a key called __proto__ stays an own key of the copy instead of changing its prototype
const put = (obj, key, value) => Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });

export function maskDeep(value) {
  const clone = (x) => (Array.isArray(x) ? [] : x && typeof x === 'object' ? {} : x);
  const root = { v: clone(value) };
  const work = [[value, root, 'v', false]];
  while (work.length) {
    const [src, dst, key, opaque] = work.pop();
    if (typeof src === 'string') { put(dst, key, opaque ? src : maskResponseText(src)); continue; }
    if (src === null || typeof src !== 'object') { put(dst, key, src); continue; }
    const copy = clone(src); put(dst, key, copy);
    const used = new Set();
    for (const k of Object.keys(src).reverse()) {
      // An object KEY can be text the visitor typed: masked like a value. Two keys that mask to the same text get a numeric suffix, nothing is dropped.
      let nk = Array.isArray(src) ? k : maskResponseText(k);
      for (let n = 2; used.has(nk); n++) nk = `${maskResponseText(k)}~${n}`;
      used.add(nk);
      work.push([src[k], copy, nk, OPAQUE.has(k)]);
    }
  }
  return root.v;
}
