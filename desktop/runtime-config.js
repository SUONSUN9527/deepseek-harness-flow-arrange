'use strict';

const os = require('node:os');
const path = require('node:path');

/** Fixed local ports used to keep browser state isolated per runtime mode. */
const MODE_PORTS = { 'claude-codex': 18080, deepseek: 26100 };
/** User-level Harness home for the optional Agent orchestration profile. */
const DEFAULT_DSH_HOME = path.join(os.homedir(), '.dsh-claude-codex');
/** Profile containing the Claude orchestrator and Codex worker composition. */
const DEFAULT_PROFILE = 'claude-codex-web';

/**
 * Resolve the persisted desktop mode, defaulting new installs to DeepSeek.
 * @param {{ mode?: unknown }} cfg - persisted desktop configuration.
 * @returns {'claude-codex' | 'deepseek'} the selected runtime mode.
 */
function resolveMode(cfg) {
  return cfg.mode === 'claude-codex' ? 'claude-codex' : 'deepseek';
}

/**
 * Resolve the Harness home, profile, and port for one desktop mode.
 * @param {{ mode?: unknown, dshHome?: unknown, profile?: unknown }} cfg - persisted desktop configuration.
 * @returns {{ mode: 'claude-codex' | 'deepseek', dshHome: string, profile: string, defaultPort: number }} deployment settings.
 */
function deploymentFor(cfg) {
  const mode = resolveMode(cfg);
  const defaults = mode === 'deepseek'
    ? { dshHome: path.join(os.homedir(), '.dsh'), profile: 'web' }
    : { dshHome: DEFAULT_DSH_HOME, profile: DEFAULT_PROFILE };
  return {
    mode,
    dshHome: typeof cfg.dshHome === 'string' && cfg.dshHome.length > 0 ? cfg.dshHome : defaults.dshHome,
    profile: typeof cfg.profile === 'string' && cfg.profile.length > 0 ? cfg.profile : defaults.profile,
    defaultPort: MODE_PORTS[mode],
  };
}

module.exports = { MODE_PORTS, DEFAULT_DSH_HOME, DEFAULT_PROFILE, resolveMode, deploymentFor };
