# Agent Note: Background job startup and cancellation watchdogs

Status: implemented

English | [中文](2026-09-02-background-job-start-watchdogs.zh.md)

## Problem

Background task acknowledgement previously meant only that a producer had been registered or an inbox message accepted. A provider that never started could remain reported as running, and a cancellation that never settled could hold capacity indefinitely. Long default waits also delayed the next inspection.

## Decision

The job registry keeps the existing `status` field and adds an observable `phase`, monotonic `revision`, acceptance/start/progress timestamps, and an optional producer `ready` promise. Producers that expose `ready` enter `provisioning` until the promise resolves. The local registry applies a configurable startup watchdog (10 seconds by default) and cancellation grace watchdog (5 seconds by default). A startup timeout settles as `failed` with phase `timeout`; an unconfirmed cancellation settles as `failed` with phase `orphaned`. All watchdogs are cleared on terminal settlement.

Normal bundle, headless, and ACP subagent tools now use the one-shot policy by default, so omitted `run_in_background` calls do not silently create continuable children. Continuable mode remains available when explicitly configured. Job-control waits default to 3 seconds and are capped at 60 seconds.

The API and UI project the lifecycle fields. Existing status consumers remain valid, while new consumers can poll `revision` and render startup timeout or orphaned work explicitly.

## Alternatives considered

**Keep registration as running.** This preserves the old snapshot but cannot tell accepted work from a provider that never started.

**Use one unbounded wait.** This avoids an extra state transition but recreates the permanent-running and teardown deadlock observed in production behavior.

**Remove continuable mode.** This would hide the issue by deleting a supported workflow; explicit continuable deployments still need their own lifecycle path.

## Consequences

Producers with no `ready` hook retain the existing synchronous-start interpretation. Producers that can distinguish handle publication should provide `ready`. A timeout classifies the registry record but cannot terminate an unresponsive external process beyond invoking its cancellation hook; durable recovery remains a separate backend concern.
