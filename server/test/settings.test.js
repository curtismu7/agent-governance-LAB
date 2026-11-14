import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETTINGS_KEYS, applySharedSettings, readSharedSettings } from '../src/settings.js';

const withFile = (text, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sal-set-'));
  const f = path.join(dir, '.env'); fs.writeFileSync(f, text, { mode: 0o600 });
  try { return fn(f); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('only this lab\'s own keys are taken from the shared settings file; every other key stays out', () => {
  assert.deepEqual(SETTINGS_KEYS, ['AGL_LAB_MODE', 'AGL_PRIV_CONSOLE_URL', 'AGL_PRIV_TENANT', 'AGL_PRIV_API_KEY', 'AGL_PRIV_API_SECRET', 'AGL_PRIV_CA']);
  withFile('PINGONE_CLIENT_SECRET=hunter2hunter2\nMODE=live\nPORT=9999\nAGL_LAB_MODE=live\n# a comment\nOTHER_APP_TOKEN="x y"\n', (f) => {
    assert.deepEqual(readSharedSettings(f), { AGL_LAB_MODE: 'live' });
    const env = { HOME: '/x' };
    applySharedSettings(env, f);
    assert.deepEqual(Object.keys(env).sort(), ['AGL_LAB_MODE', 'HOME']);
    assert.equal(env.AGL_LAB_MODE, 'live');
  });
  // The Real-mode keys are read only when present, and other apps' secrets stay out even when a value is named AGL_*
  withFile('AGL_PRIV_TENANT=0428ba4f-169c-436b-aff9-b230496e0e3b\nAGL_PRIV_UNRELATED=yes\n', (f) => {
    assert.deepEqual(readSharedSettings(f), { AGL_PRIV_TENANT: '0428ba4f-169c-436b-aff9-b230496e0e3b' });
  });
});

test('the environment wins over the file; a missing, empty or unreadable file is the defaults', () => {
  withFile('AGL_LAB_MODE=live\n', (f) => assert.equal(applySharedSettings({ AGL_LAB_MODE: 'mock' }, f).AGL_LAB_MODE, 'mock'));
  assert.deepEqual(readSharedSettings('/nonexistent/.env'), {});
  withFile('', (f) => assert.deepEqual(readSharedSettings(f), {}));
  withFile('AGL_LAB_MODE=\n', (f) => assert.deepEqual(readSharedSettings(f), {}));
  assert.deepEqual(readSharedSettings(os.tmpdir()), {}, 'a directory is not a settings file');
});
