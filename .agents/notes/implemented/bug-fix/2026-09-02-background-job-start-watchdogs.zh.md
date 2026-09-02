# Agent Note: 后台任务启动与取消看门狗

Status: implemented

[English](2026-09-02-background-job-start-watchdogs.md) | 中文

## Problem

此前后台任务的启动确认只表示生产方已登记或 inbox 已接受消息。提供方如果从未真正启动，任务可能一直显示运行中；取消如果始终不结算，也会永久占用容量。过大的默认等待时间还会拖慢下一次检查。

## Decision

任务注册表保留现有 `status` 字段，并增加可观测的 `phase`、单调递增的 `revision`、接受／启动／进度时间戳和可选的生产方 `ready` promise。提供 `ready` 的生产方先进入 `provisioning`，promise 解决后转为 `running`。进程内注册表增加可配置的启动看门狗（默认 10 秒）和取消宽限看门狗（默认 5 秒）。启动超时以 `failed` 状态和 `timeout` phase 结算；无法确认取消完成则以 `failed` 状态和 `orphaned` phase 结算。所有看门狗在终态结算时清理。

普通 bundle、headless 和 ACP subagent 工具现在默认使用 one-shot 策略，省略 `run_in_background` 时不会静默创建 continuable 子任务。显式配置仍可使用 continuable。任务控制工具的默认等待改为 3 秒，单次上限改为 60 秒。

API 与 UI 会投影这些生命周期字段。已有只读取 `status` 的消费者保持有效，新消费者可以通过 `revision` 轮询，并明确显示启动超时或疑似孤儿任务。

## Alternatives considered

**继续把登记视为运行中。** 这保留了旧快照，但无法区分已接受的任务和从未启动的提供方。

**保留无限等待。** 这少一个状态转换，却会重现永久运行和 teardown 死锁问题。

**删除 continuable 模式。** 这只是通过删除已支持的工作流隐藏问题；显式 continuable 部署仍需要独立的生命周期路径。

## Consequences

未提供 `ready` hook 的生产方继续按同步启动解释。能够区分句柄发布时机的生产方应提供 `ready`。超时只能给注册表记录分类，并通过取消 hook 尝试停止外部进程；无法响应的外部进程仍需独立的持久化后端处理。
