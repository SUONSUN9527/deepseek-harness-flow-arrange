// DeepSeek Harness 桌面端主进程。
// 职责：启动器窗口、拉起/停止 dsh web 服务、把会话 UI 以 WebContentsView 内嵌进窗口。
'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, Menu } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { deploymentFor } = require('./runtime-config.js');

// 会话视图占满整窗（0 = 无顶部状态栏）。返回启动页与浏览器打开走应用菜单
// （Alt 呼出）：返回启动页 Ctrl+Shift+H，在浏览器中打开见「应用」菜单。
const HEADER_HEIGHT = 0;
const BOOT_TIMEOUT_MS = 120_000;
// 固定默认端口，按模式区分：内嵌页面的 localStorage 等浏览器侧状态按
// 「来源(含端口)」隔离，端口既要跨启动稳定，也要让两种模式互不串扰。
// claude-codex 用 18080，与浏览器直启的 claude-codex-web 后端同源同端口：
// 该端口已有 dsh 在跑时桌面端直接复用那个后端，不再另起一份（复用探测
// 仅在 claude-codex 模式下进行，deepseek 模式绝不能挂错后端）。
const LOG_LIMIT = 800;

let mainWindow = null;
let sessionView = null;

const server = {
  proc: null,
  port: 0,
  url: '',
  workspace: '',
  mode: '', // claude-codex | deepseek（本次会话的运行模式）
  status: 'idle', // idle | starting | running | error
  error: '',
  logs: [],
};

// ---------- 配置持久化 ----------

function configPath() {
  return path.join(app.getPath('userData'), 'dsh-desktop.json');
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
  return next;
}

function rememberWorkspace(dir) {
  const cfg = loadConfig();
  const recent = (cfg.recentWorkspaces || []).filter((item) => item !== dir);
  recent.unshift(dir);
  saveConfig({ recentWorkspaces: recent.slice(0, 12), lastWorkspace: dir });
}

// ---------- dsh 定位 ----------

// 桌面端目录位于仓库内，默认直接使用仓库构建产物；也允许在设置里覆盖。
function resolveDshEntry(cfg) {
  if (cfg.dshPath && fs.existsSync(cfg.dshPath)) return { kind: 'script', target: cfg.dshPath };
  const repoBin = path.resolve(__dirname, '..', 'apps', 'cli', 'lib', 'bin.js');
  if (fs.existsSync(repoBin)) return { kind: 'script', target: repoBin };
  return { kind: 'command', target: 'dsh' };
}

function resolveNode(cfg) {
  if (cfg.nodePath && fs.existsSync(cfg.nodePath)) return { exe: cfg.nodePath, asElectron: false };
  const probe = spawnSync('node', ['-v'], { shell: process.platform === 'win32', windowsHide: true });
  if (probe.status === 0) return { exe: 'node', asElectron: false };
  // 机器上没有 Node 时用 Electron 自带的 Node 运行时兜底
  return { exe: process.execPath, asElectron: true };
}

// ---------- 服务生命周期 ----------

function pushLog(line) {
  const text = String(line).replace(/\s+$/, '');
  if (!text) return;
  server.logs.push(text);
  if (server.logs.length > LOG_LIMIT) server.logs.splice(0, server.logs.length - LOG_LIMIT);
  broadcast('server:log', text);
}

function setStatus(status, error = '') {
  server.status = status;
  server.error = error;
  broadcast('server:status', publicState());
}

// 自动进入进行中：renderer 用它显示全屏加载页而不是启动表单，直到会话
// 视图真正完成首次渲染（attachSessionView 的 did-finish-load）才清除。
let autoEntering = false;

function publicState() {
  return {
    status: server.status,
    error: server.error,
    url: server.url,
    port: server.port,
    workspace: server.workspace,
    mode: server.mode,
    autoEntering,
    logs: server.logs.slice(-200),
  };
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function choosePort(requested, defaultPort) {
  if (requested) return Number(requested);
  if (await isPortFree(defaultPort)) return defaultPort;
  pushLog(`[desktop] 默认端口 ${defaultPort} 被占用，改用随机空闲端口`);
  return findFreePort();
}

// 探测某地址是否已有 HTTP 服务在应答（用于复用已运行的 dsh 后端）。
function probeHttp(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForHttp(url, isAlive) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (!isAlive()) return reject(new Error('dsh 进程在启动完成前退出'));
      if (Date.now() - startedAt > BOOT_TIMEOUT_MS) return reject(new Error('等待 dsh web 服务超时（120 秒）'));
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => setTimeout(tick, 500));
      req.setTimeout(2000, () => {
        req.destroy();
        setTimeout(tick, 500);
      });
    };
    tick();
  });
}

async function startServer(workspace, options = {}) {
  if (server.status === 'starting' || server.status === 'running') {
    throw new Error('已有会话在运行，请先停止');
  }
  if (!workspace || !fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    throw new Error('工作区目录不存在：' + workspace);
  }

  const cfg = loadConfig();
  const entry = resolveDshEntry(cfg);
  server.logs = [];
  const { mode, dshHome, profile, defaultPort } = deploymentFor(cfg);
  server.mode = mode;

  // 后端复用：默认端口上已有 dsh 在应答（例如命令行先启动了同一部署）时，
  // 桌面端直接挂到那个后端上，保证两个入口调用的是同一个实例。仅限
  // claude-codex 模式——deepseek 模式探同一端口会错挂到双模型后端。
  if (!options.port && mode === 'claude-codex') {
    const reuseUrl = `http://127.0.0.1:${defaultPort}/`;
    if (await probeHttp(reuseUrl)) {
      server.workspace = '(复用已运行的后端)';
      server.port = defaultPort;
      server.url = reuseUrl;
      server.proc = null;
      pushLog(`[desktop] 端口 ${defaultPort} 已有 dsh 后端在运行，直接复用（工作区由该实例决定）`);
      setStatus('running');
      return publicState();
    }
  }

  const port = await choosePort(options.port, defaultPort);
  const extraArgs = String(options.extraArgs || cfg.extraArgs || '')
    .split(/\s+/)
    .filter(Boolean);
  const webArgs = ['--profile', profile, '--no-open', '--port', String(port), ...extraArgs];

  server.workspace = workspace;
  server.port = port;
  server.url = `http://127.0.0.1:${port}/`;
  setStatus('starting');
  pushLog(`[desktop] 工作区: ${workspace}`);
  pushLog(`[desktop] 模式: ${mode}  DSH_HOME: ${dshHome}  profile: ${profile}`);

  let child;
  if (entry.kind === 'script') {
    const node = resolveNode(cfg);
    const env = { ...process.env, DSH_HOME: dshHome };
    if (node.asElectron) env.ELECTRON_RUN_AS_NODE = '1';
    else delete env.ELECTRON_RUN_AS_NODE;
    pushLog(`[desktop] 启动: ${node.asElectron ? 'electron(node)' : node.exe} ${entry.target} ${webArgs.join(' ')}`);
    child = spawn(node.exe, [entry.target, ...webArgs], {
      cwd: workspace,
      env,
      windowsHide: true,
      shell: node.exe === 'node' && process.platform === 'win32',
    });
  } else {
    pushLog(`[desktop] 启动: dsh ${webArgs.join(' ')}（PATH）`);
    child = spawn(entry.target, webArgs, {
      cwd: workspace,
      env: { ...process.env, DSH_HOME: dshHome },
      windowsHide: true,
      shell: process.platform === 'win32',
    });
  }

  server.proc = child;
  child.stdout.on('data', (buf) => buf.toString().split(/\r?\n/).forEach(pushLog));
  child.stderr.on('data', (buf) => buf.toString().split(/\r?\n/).forEach(pushLog));
  child.on('error', (err) => pushLog(`[desktop] 进程错误: ${err.message}`));
  child.on('exit', (code, signal) => {
    pushLog(`[desktop] dsh 进程退出 code=${code} signal=${signal || ''}`);
    const wasRunning = server.status === 'running';
    server.proc = null;
    if (server.status !== 'idle') {
      detachSessionView();
      setStatus(wasRunning && code === 0 ? 'idle' : 'error', wasRunning || code === 0 ? '' : 'dsh 启动失败，请查看日志');
    }
  });

  try {
    await waitForHttp(server.url, () => server.proc === child && child.exitCode === null);
  } catch (err) {
    stopServer();
    setStatus('error', err.message);
    throw err;
  }

  rememberWorkspace(workspace);
  setStatus('running');
  pushLog(`[desktop] 服务就绪: ${server.url}`);
  return publicState();
}

function stopServer() {
  autoEntering = false;
  const proc = server.proc;
  server.proc = null;
  if (proc && proc.exitCode === null) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try { proc.kill('SIGTERM'); } catch { /* 已退出 */ }
    }
  }
  detachSessionView();
  if (server.status !== 'idle') setStatus('idle');
}

// ---------- 会话视图内嵌 ----------

function layoutSessionView() {
  if (!sessionView || !mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  sessionView.setBounds({ x: 0, y: HEADER_HEIGHT, width, height: Math.max(0, height - HEADER_HEIGHT) });
}

function attachSessionView(url) {
  detachSessionView();
  sessionView = new WebContentsView({ webPreferences: { sandbox: true } });
  sessionView.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });
  // 视图在页面完成首次加载后才盖到窗口上：未绘制的 WebContents 默认是白底，
  // 立即挂载会在自动进入的加载页上闪一段白屏。20 秒兜底保证异常页面也可见。
  const view = sessionView;
  let attached = false;
  const attachNow = () => {
    if (attached || sessionView !== view || !mainWindow || mainWindow.isDestroyed()) return;
    attached = true;
    mainWindow.contentView.addChildView(view);
    layoutSessionView();
    if (autoEntering) {
      autoEntering = false;
      broadcast('server:status', publicState());
    }
  };
  view.webContents.once('did-finish-load', attachNow);
  setTimeout(attachNow, 20_000);
  view.webContents.loadURL(url);
}

function detachSessionView() {
  if (!sessionView) return;
  const view = sessionView;
  sessionView = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.contentView.removeChildView(view); } catch { /* 窗口正在关闭 */ }
  }
  try { view.webContents.close(); } catch { /* 已销毁 */ }
}

// ---------- 窗口与菜单 ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1017',
    title: 'DeepSeek Harness',
    icon: path.join(__dirname, 'app.ico'),
    autoHideMenuBar: true,
    // 首帧渲染好再显示窗口，消除打开瞬间的空白闪烁。
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once('ready-to-show', () => { if (mainWindow) mainWindow.show(); });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('resize', layoutSessionView);
  mainWindow.on('maximize', layoutSessionView);
  mainWindow.on('unmaximize', layoutSessionView);
  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '应用',
      submenu: [
        { label: '返回启动页', accelerator: 'CmdOrCtrl+Shift+H', click: () => { stopServer(); } },
        { label: '在浏览器中打开', click: () => { if (server.url && server.status === 'running') shell.openExternal(server.url); } },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    { role: 'editMenu', label: '编辑' },
    {
      label: '视图',
      submenu: [
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'resetZoom', label: '实际大小' },
        { type: 'separator' },
        {
          label: '开发者工具',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => (sessionView ? sessionView.webContents : mainWindow.webContents).openDevTools({ mode: 'detach' }),
        },
      ],
    },
  ]));
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle('config:get', () => loadConfig());
  ipcMain.handle('config:set', (_e, patch) => saveConfig(patch));
  ipcMain.handle('server:state', () => publicState());
  ipcMain.handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择工作区目录',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('server:start', async (_e, { workspace, port, extraArgs }) => {
    const state = await startServer(workspace, { port, extraArgs });
    attachSessionView(server.url);
    return state;
  });
  ipcMain.handle('server:stop', () => {
    stopServer();
    return publicState();
  });
  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('shell:openPath', (_e, target) => shell.openPath(target));
}

// ---------- 自动进入：双击图标直达会话界面 ----------

// 生命周期约定：双击图标 → 自动拉起（或复用已在跑的）后端并直接进入会话
// 界面；关闭窗口 → window-all-closed 里的 stopServer 杀掉自己拉起的后端。
// 上次工作区缺失、配置显式关闭（autoEnter: false）或启动失败时，回落到
// 手动启动页，行为与旧版一致。
async function autoEnter() {
  const cfg = loadConfig();
  if (cfg.autoEnter === false) return;
  const workspace = cfg.lastWorkspace;
  if (!workspace || !fs.existsSync(workspace)) {
    pushLog('[desktop] 没有可用的上次工作区，停留在启动页');
    return;
  }
  // 同步置位：renderer 初始化时通过 getState 读到它并显示加载页，
  // 全程不出现启动表单；attachSessionView 在首帧渲染完成后清除。
  autoEntering = true;
  try {
    await startServer(workspace, {});
    attachSessionView(server.url);
  } catch (err) {
    autoEntering = false;
    pushLog(`[desktop] 自动进入失败，停留在启动页: ${err.message}`);
    broadcast('server:status', publicState());
  }
}

// ---------- 冒烟测试模式：electron . --smoke [workspace] ----------

async function runSmoke() {
  const workspace = process.argv[process.argv.indexOf('--smoke') + 1] || process.cwd();
  const withUi = process.argv.includes('--smoke-ui');
  try {
    if (withUi) {
      registerIpc();
      buildMenu();
      createWindow();
    }
    const state = await startServer(workspace, {});
    console.log('[smoke] ready at ' + state.url);
    if (withUi) {
      attachSessionView(server.url);
      await new Promise((resolve, reject) => {
        sessionView.webContents.once('did-finish-load', resolve);
        sessionView.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`load failed: ${code} ${desc}`)));
        setTimeout(() => reject(new Error('会话页面加载超时')), 30_000);
      });
      await new Promise((r) => setTimeout(r, 3000));
      const outDir = process.env.DSH_SMOKE_OUT || app.getPath('temp');
      fs.writeFileSync(path.join(outDir, 'smoke-session.png'), (await sessionView.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(outDir, 'smoke-launcher.png'), (await mainWindow.webContents.capturePage()).toPNG());
      console.log('[smoke] screenshots written to ' + outDir);
    }
    stopServer();
    console.log('[smoke] OK');
    app.exit(0);
  } catch (err) {
    console.error('[smoke] FAILED: ' + err.message);
    console.error(server.logs.slice(-40).join('\n'));
    app.exit(1);
  }
}

// ---------- 入口 ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('deepseek.harness.desktop');
    if (process.argv.includes('--smoke')) {
      runSmoke();
      return;
    }
    registerIpc();
    buildMenu();
    createWindow();
    void autoEnter();
  });

  app.on('window-all-closed', () => {
    stopServer();
    app.quit();
  });

  app.on('before-quit', () => stopServer());
}
