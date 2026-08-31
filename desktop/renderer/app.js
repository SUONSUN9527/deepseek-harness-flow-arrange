'use strict';

const api = window.dshDesktop;

const el = (id) => document.getElementById(id);
const launcher = el('launcher');
const sessionBar = el('session-bar');
const workspaceInput = el('workspace-input');
const modeSelect = el('mode-select');
const modeHint = el('mode-hint');
const optPort = el('opt-port');
const optExtra = el('opt-extra');
const optDsh = el('opt-dsh');
const optNode = el('opt-node');
const btnStart = el('btn-start');
const btnCancel = el('btn-cancel');
const btnPick = el('btn-pick');
const statusText = el('status-text');
const errorBanner = el('error-banner');
const logPanel = el('log-panel');
const logBody = el('log-body');
const recentList = el('recent-list');

if (!api) {
  // 直接用浏览器打开该文件时的降级提示（正常应通过 Electron 加载）
  statusText.textContent = '预览模式：未连接 Electron 主进程';
  btnStart.disabled = true;
}

const MODE_LABELS = {
  'claude-codex': 'Claude × Codex 双模型',
  deepseek: 'DeepSeek 单模型',
};

const MODE_HINTS = {
  'claude-codex': 'Claude 负责对话编排，Codex 负责代码执行；使用独立配置目录 ~/.dsh-claude-codex（Claude OAuth/API Key 与 Codex 中转均在其中）。',
  deepseek: '原生单模型模式，使用默认配置目录 ~/.dsh。',
};

function updateModeHint() {
  modeHint.textContent = MODE_HINTS[modeSelect.value] || '';
}

function setScreen(state) {
  const running = state.status === 'running';
  // 自动进入期间（含后端已 running 但会话页面尚未完成首帧渲染）显示全屏
  // 加载页；主进程在视图真正挂载后清除 autoEntering 并广播。
  const splashing = Boolean(state.autoEntering) && state.status !== 'error';
  el('splash').hidden = !splashing;
  if (splashing) {
    el('splash-status').textContent = running ? '正在加载会话界面…' : '正在启动本地服务…';
  }
  // 会话视图占满整窗：顶部状态栏永不显示（返回/浏览器打开走应用菜单）。
  sessionBar.hidden = true;
  launcher.style.display = running || splashing ? 'none' : 'flex';
}

function setBusy(busy, text) {
  btnStart.disabled = busy;
  btnCancel.hidden = !busy;
  statusText.textContent = text || '';
  statusText.classList.toggle('busy', busy);
}

function showError(message) {
  errorBanner.hidden = !message;
  errorBanner.textContent = message || '';
}

function appendLog(line) {
  logPanel.hidden = false;
  logBody.textContent += line + '\n';
  logBody.scrollTop = logBody.scrollHeight;
}

function renderRecent(dirs) {
  recentList.innerHTML = '';
  if (!dirs || dirs.length === 0) {
    const li = document.createElement('li');
    li.className = 'recent-empty';
    li.textContent = '暂无记录，启动一次会话后会出现在这里';
    recentList.appendChild(li);
    return;
  }
  for (const dir of dirs) {
    const li = document.createElement('li');
    const main = document.createElement('div');
    main.className = 'recent-main';
    const name = document.createElement('div');
    name.className = 'recent-name';
    name.textContent = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir;
    const p = document.createElement('div');
    p.className = 'recent-path';
    p.textContent = dir;
    p.title = dir;
    main.append(name, p);
    li.appendChild(main);
    li.addEventListener('click', () => {
      workspaceInput.value = dir;
      startSession();
    });
    recentList.appendChild(li);
  }
}

async function startSession() {
  const workspace = workspaceInput.value.trim();
  if (!workspace) {
    showError('请先选择工作区目录');
    return;
  }
  showError('');
  logBody.textContent = '';
  logPanel.hidden = true;
  setBusy(true, '正在启动 dsh web 服务…');
  try {
    await api.setConfig({
      mode: modeSelect.value,
      dshPath: optDsh.value.trim(),
      nodePath: optNode.value.trim(),
      extraArgs: optExtra.value.trim(),
    });
    await api.start({
      workspace,
      port: optPort.value.trim(),
      extraArgs: optExtra.value.trim(),
    });
    // 状态切换由 onStatus 驱动
  } catch (err) {
    setBusy(false, '');
    showError(String(err.message || err).replace(/^Error invoking remote method '[^']+': Error: /, ''));
  } finally {
    refreshRecent();
  }
}

async function refreshRecent() {
  const cfg = await api.getConfig();
  renderRecent(cfg.recentWorkspaces);
  return cfg;
}

async function init() {
  if (!api) return;
  const cfg = await refreshRecent();
  if (cfg.lastWorkspace) workspaceInput.value = cfg.lastWorkspace;
  modeSelect.value = cfg.mode === 'deepseek' ? 'deepseek' : 'claude-codex';
  updateModeHint();
  modeSelect.addEventListener('change', () => {
    updateModeHint();
    api.setConfig({ mode: modeSelect.value });
  });
  if (cfg.dshPath) optDsh.value = cfg.dshPath;
  if (cfg.nodePath) optNode.value = cfg.nodePath;
  if (cfg.extraArgs) optExtra.value = cfg.extraArgs;

  const state = await api.getState();
  setScreen(state);

  api.onLog((line) => appendLog(line));
  api.onStatus((state) => {
    setScreen(state);
    if (state.status === 'running') {
      setBusy(false, '');
    } else if (state.status === 'starting') {
      setBusy(true, '正在启动 dsh web 服务…');
    } else if (state.status === 'error') {
      setBusy(false, '');
      showError(state.error || '启动失败，请查看日志');
    } else {
      setBusy(false, '');
    }
  });

  btnPick.addEventListener('click', async () => {
    const dir = await api.pickFolder();
    if (dir) workspaceInput.value = dir;
  });
  btnStart.addEventListener('click', startSession);
  btnCancel.addEventListener('click', () => api.stop());
  workspaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startSession();
  });

  el('btn-leave').addEventListener('click', () => api.stop());
  el('btn-browser').addEventListener('click', async () => {
    const state = await api.getState();
    if (state.url) api.openExternal(state.url);
  });
}

init();
