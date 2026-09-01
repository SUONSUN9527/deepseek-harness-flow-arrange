# DeepSeek Harness 桌面端

[English](README.md) | 中文

参照 Codex 桌面版形态实现的本地桌面壳：双击启动，选择工作区，应用会在本机拉起 `dsh web` 服务，并把 DeepSeek 会话界面内嵌到桌面窗口中使用。全部代码独立在本目录，不参与仓库的 pnpm workspace 构建。

## 使用

推荐：双击桌面上的 **「DeepSeek Harness」图标**（不弹控制台窗口）。若还没有图标，双击本目录的 `创建桌面快捷方式.bat` 生成。

也可以直接双击 **`启动 DeepSeek Harness.bat`**。

1. 双击 **`启动 DeepSeek Harness.bat`**。
   - 首次运行会自动 `npm install` 安装 Electron（已预设 npmmirror 镜像），之后直接开窗。
   - 前提：机器上有 Node.js（仓库开发机本来就有），且仓库已执行过 `pnpm run build`（存在 `apps/cli/lib/bin.js` 与 `apps/web/dist`）。
2. 在启动页选择工作区目录（或点左侧「最近工作区」一键启动），点「启动会话」。默认使用 DeepSeek 原生模式；启动页仍可切换到 Agent 编排模式。
3. 应用自动分配空闲端口、以工作区为 cwd 拉起 `dsh web --no-open --port <port>`，就绪后在窗口内打开会话 UI。
4. 顶部状态栏：`‹ 返回` 停止服务回到启动页；`浏览器打开` 在系统浏览器中打开同一会话服务。快捷键 `Ctrl+Shift+H` 返回启动页，`Ctrl+Shift+I` 开发者工具。

## 高级选项

| 选项 | 说明 |
|---|---|
| 端口 | 留空自动分配空闲端口 |
| 附加参数 | 追加给 `dsh web` 的参数，如 `--patch ./extra.yml` |
| dsh 入口覆盖 | 指定其他 `bin.js`；默认用仓库 `apps/cli/lib/bin.js`，找不到时回退 PATH 中的 `dsh` |
| Node 路径覆盖 | 默认用 PATH 中的 `node`；机器没有 Node 时回退 Electron 自带的 Node 运行时 |

## Agent 编排模式

Agent 编排模式保留 Claude 编排 agent 与 Codex 工作 agent 的分工。编排 agent 可通过 Auth 登录或 `ANTHROPIC_API_KEY` 接入；工作 agent 使用 Codex 原生 Auth 或 API Key 配置。两者使用独立的认证状态，工作 agent 的模型由 Codex 原生配置管理，Web 模型设置页只允许选择编排 agent 的模型。

## 记忆与持久化

| 内容 | 位置 | 说明 |
|---|---|---|
| 会话历史、dsh 设置 | `~/.dsh/`（`sessions`、`settings.yaml`、`storages`） | 由 dsh 自身持久化，跨启动保留 |
| 最近工作区、桌面端配置 | Electron `userData` 下的 `dsh-desktop.json` | 桌面端维护 |
| 内嵌页面的浏览器侧状态（localStorage 等） | Electron `userData` | 按「来源(含端口)」隔离；DeepSeek 默认使用固定端口 **26100**，Agent 编排模式默认使用 **18080**，被占用时才退回随机端口 |

## 图标与桌面快捷方式

- `app.ico` 由 `scripts/make-icon.js` 生成（Electron 离屏渲染 `scripts/icon.html`，导出 16–256 多尺寸）。改样式后重新执行：`node_modules\\.bin\\electron scripts\\make-icon.js`。
- `创建桌面快捷方式.bat` 在当前用户桌面生成「DeepSeek Harness」快捷方式，直指 `electron.exe`，双击启动无控制台窗口（需先运行过一次启动 bat 完成依赖安装）。

## 目录结构

```
desktop/
├── 启动 DeepSeek Harness.bat   # 双击入口（首次自动装依赖）
├── package.json
├── main.js                     # 主进程：服务生命周期、窗口、WebContentsView 内嵌、IPC
├── runtime-config.js           # 模式到 Harness home/profile/端口的纯配置解析
├── preload.js                  # contextBridge API
└── renderer/                   # 启动器前端 UI（无框架，纯 HTML/CSS/JS）
    ├── index.html
    ├── app.css
    └── app.js
```

## 冒烟测试

```
node --test scripts/runtime-config.test.cjs
npm run smoke -- <工作区目录>              # 无窗口：起服务→等就绪→关停
npx electron . --smoke <工作区目录> --smoke-ui   # 开窗内嵌会话 UI 并导出截图
```
