'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { deploymentFor, resolveMode } = require('../runtime-config.js');

test('new desktop configurations default to the DeepSeek runtime', () => {
  assert.equal(resolveMode({}), 'deepseek');
  assert.equal(resolveMode({ mode: 'unknown' }), 'deepseek');
  assert.deepEqual(deploymentFor({}), {
    mode: 'deepseek',
    dshHome: path.join(os.homedir(), '.dsh'),
    profile: 'web',
    defaultPort: 26100,
  });
});

test('the explicit Agent mode retains its isolated deployment', () => {
  assert.equal(resolveMode({ mode: 'claude-codex' }), 'claude-codex');
  assert.deepEqual(deploymentFor({ mode: 'claude-codex' }), {
    mode: 'claude-codex',
    dshHome: path.join(os.homedir(), '.dsh-claude-codex'),
    profile: 'claude-codex-web',
    defaultPort: 18080,
  });
});

test('explicit deployment overrides remain available for both modes', () => {
  assert.deepEqual(deploymentFor({ mode: 'deepseek', dshHome: 'D:/dsh', profile: 'custom' }), {
    mode: 'deepseek',
    dshHome: 'D:/dsh',
    profile: 'custom',
    defaultPort: 26100,
  });
});
