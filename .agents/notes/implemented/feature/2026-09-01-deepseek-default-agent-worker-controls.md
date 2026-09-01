# Agent Note: DeepSeek default and managed agent worker settings

Status: implemented

English | [中文](2026-09-01-deepseek-default-agent-worker-controls.zh.md)

## Problem

The double-click desktop launcher already hosted both the native DeepSeek runtime and the Claude-orchestrated Codex runtime, but an unset mode selected the dual-model runtime. The dual-model settings page also allowed the browser to write the Codex worker model and reasoning effort, even though the worker's native configuration owns those values.

## Decision

The desktop launcher keeps its existing startup page, recent-workspace persistence, and double-click auto-entry. An unset or unknown mode now resolves to `deepseek`, which uses the default `~/.dsh` home, `web` profile, and port `26100`. The explicit `claude-codex` mode remains the Agent orchestration mode and uses `~/.dsh-claude-codex`, `claude-codex-web`, and port `18080`.

The launcher and Models page identify the two independent authentication owners. The orchestrator can use its Auth login or `ANTHROPIC_API_KEY`; the worker keeps Codex-native Auth or API-key configuration. Credentials stay outside the repository and are not copied into desktop settings.

`DualModelCards` keeps the live catalog selector for the orchestrator and renders a worker configuration summary without model or reasoning-effort controls. The `subagent-codex` settings namespace still declares the worker configuration for the native profile, but the web page does not mutate it.

## Alternatives considered

**Keep Agent orchestration as the implicit desktop default.** Rejected because a fresh double-click should open the DeepSeek-branded native runtime requested by the desktop entry point; Agent orchestration remains an explicit choice.

**Remove the Agent orchestration mode.** Rejected because existing deployments need Claude and Codex as separate agents with independent authentication.

**Add a new browser OAuth RPC in this change.** Rejected because the current client RPC has no authorization interaction face; adding one would require a new wire method, event forwarding, prompt UI, and lifecycle tests. Existing native profile authorization remains the owner of Auth login, while API-key entry continues through the credential/settings paths.

## Consequences

Fresh desktop launches use DeepSeek without changing the launcher layout or double-click workflow. Agent deployments remain available through an explicit mode and keep their separate Auth/API-key configuration. The Models page can change only the orchestrator model, preventing a browser setting from silently diverging from the worker's native Codex configuration. Focused component tests and the desktop smoke path verify the visible controls and runtime startup behavior.
