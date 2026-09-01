# Agent Note: DeepSeek default and managed agent worker settings

Status: implemented

[English](2026-09-01-deepseek-default-agent-worker-controls.md) | 中文

## Problem

双击桌面启动器已经同时承载原生 DeepSeek 运行时和 Claude 编排、Codex 执行的双模型运行时，但未设置模式时仍会选择双模型运行时。双模型设置页也允许浏览器写入 Codex 工作 agent 的模型与推理力度，因而可能偏离工作 agent 所属的原生配置。

## Decision

桌面启动器保留现有启动页、最近工作区持久化和双击自动进入行为。未设置或未知模式现在解析为 `deepseek`，使用默认 `~/.dsh` home、`web` profile 和 `26100` 端口。显式的 `claude-codex` 模式仍是 Agent 编排模式，使用 `~/.dsh-claude-codex`、`claude-codex-web` 和 `18080` 端口。

启动器和模型页明确两套彼此独立的认证归属。编排 agent 可使用 Auth 登录或 `ANTHROPIC_API_KEY`；工作 agent 保留 Codex 原生 Auth 或 API Key 配置。凭据留在仓库之外，不复制进桌面配置。

`DualModelCards` 保留编排 agent 的实时模型目录选择器，并渲染工作 agent 配置摘要，不再提供模型或推理力度控件。`subagent-codex` 设置命名空间仍为原生 profile 声明工作配置，但网页不再修改它。

## Alternatives considered

**保留 Agent 编排作为桌面隐式默认。** 否决，因为新安装双击后应进入桌面入口所要求的 DeepSeek 原生运行时；Agent 编排仍作为显式选择保留。

**移除 Agent 编排模式。** 否决，因为已有部署需要 Claude 与 Codex 作为认证彼此独立的两个 agent。

**本次新增浏览器 OAuth RPC。** 否决，因为当前客户端 RPC 没有授权交互接口；新增它需要新的 wire 方法、事件转发、提示 UI 和生命周期测试。现有原生 profile 继续负责 Auth 登录，API Key 仍通过凭据与设置路径录入。

## Consequences

新的桌面启动默认使用 DeepSeek，同时不改变启动页布局或双击流程。Agent 部署仍可通过显式模式使用，并保留独立的 Auth/API Key 配置。模型页只能修改编排 agent 的模型，避免浏览器设置静默偏离工作 agent 的 Codex 原生配置。聚焦组件测试和桌面冒烟路径验证可见控件与运行时启动行为。
