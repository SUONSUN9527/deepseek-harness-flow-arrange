// @vitest-environment jsdom
/** Dual-model block behavior over scripted settings and catalog faces. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { RpcResponse, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { DualModelCards, unionChoices } from '../src/client/DualModelCards.tsx'
import type { DualModelCardsProps } from '../src/client/DualModelCards.tsx'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t: DualModelCardsProps['t'] = key => en[key]

const ExecutorConfig = Schema.object({
  model: Schema.union(['gpt-5.6-sol', 'gpt-5.2']),
  reasoningEffort: Schema.union(['low', 'medium', 'high', 'xhigh']),
})

const OrchestratorConfig = Schema.object({
  provider: Schema.string(),
  model: Schema.string(),
  reasoningEffort: Schema.string(),
})

function executorNs(value: Record<string, unknown>): SettingsNamespaceView {
  return {
    ns: 'subagent-codex',
    schema: JSON.parse(JSON.stringify(ExecutorConfig.toJSON())) as unknown,
    value,
    applies: 'live',
    secrets: [],
    revision: 0,
  }
}

function orchestratorNs(value: Record<string, unknown>): SettingsNamespaceView {
  return {
    ns: 'agent-default-model',
    schema: JSON.parse(JSON.stringify(OrchestratorConfig.toJSON())) as unknown,
    value,
    applies: 'live',
    secrets: [],
    revision: 0,
  }
}

const CATALOG = {
  groups: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      models: [
        { id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
        { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
      ],
    },
  ],
  failures: [],
}

/** An answered wire call. */
function ok<T>(value: T): RpcResponse<T> {
  return { result: { ok: true, value } } as RpcResponse<T>
}

/** A business-rejected wire call. */
function rejected<T>(message: string): RpcResponse<T> {
  return { result: { ok: false, error: { code: 'invalid-request', message } } } as unknown as RpcResponse<T>
}

interface Faces {
  api: DualModelCardsProps['api']
  mutate: ReturnType<typeof vi.fn>
  models: ReturnType<typeof vi.fn>
}

function faces(overrides: Partial<{ mutate: unknown; models: unknown }> = {}): Faces {
  const mutate = vi.fn().mockResolvedValue(ok({ user: {}, revision: 1 }))
  const models = vi.fn().mockResolvedValue(ok(CATALOG))
  if (overrides.mutate !== undefined) mutate.mockImplementation(overrides.mutate as never)
  if (overrides.models !== undefined) models.mockImplementation(overrides.models as never)
  return {
    api: { settings: { mutate }, llm: { models } } as unknown as DualModelCardsProps['api'],
    mutate,
    models,
  }
}

function renderCards(props: Partial<DualModelCardsProps> & { api: DualModelCardsProps['api'] }): {
  onSaved: ReturnType<typeof vi.fn>
} {
  const onSaved = vi.fn()
  render(
    <DualModelCards
      orchestrator={props.orchestrator}
      executor={props.executor ?? executorNs({ model: 'gpt-5.6-sol', reasoningEffort: 'xhigh' })}
      schema={settingsSchema}
      api={props.api}
      t={t}
      readOnly={props.readOnly ?? false}
      onSaved={props.onSaved ?? onSaved}
    />,
  )
  return { onSaved }
}

describe('DualModelCards', () => {
  it('renders both cards and commits an orchestrator model change', async () => {
    const { api, mutate } = faces()
    const { onSaved } = renderCards({
      api,
      orchestrator: orchestratorNs({ provider: 'anthropic', model: 'claude-opus-4-5' }),
    })
    const select = screen.getByLabelText<HTMLSelectElement>(en.orchestratorModel)
    await waitFor(() => { expect(select.disabled).toBe(false) })
    expect(screen.getByText('Claude Opus 4.5')).toBeDefined()
    fireEvent.change(select, { target: { value: `anthropic${String.fromCharCode(0x1F)}claude-sonnet-5` } })
    await waitFor(() => { expect(onSaved).toHaveBeenCalledTimes(1) })
    expect(mutate).toHaveBeenCalledWith({
      ns: 'agent-default-model',
      ops: [
        { op: 'set', path: ['provider'], value: 'anthropic' },
        { op: 'set', path: ['model'], value: 'claude-sonnet-5' },
        { op: 'unset', path: ['reasoningEffort'] },
      ],
    })
    expect(await screen.findByText(en.dualSaved)).toBeDefined()
  })

  it('commits executor model and effort changes to the executor namespace', async () => {
    const { api, mutate } = faces()
    const { onSaved } = renderCards({ api })
    fireEvent.change(screen.getByLabelText(en.executorModel), { target: { value: 'gpt-5.2' } })
    await waitFor(() => { expect(onSaved).toHaveBeenCalledTimes(1) })
    expect(mutate).toHaveBeenCalledWith({
      ns: 'subagent-codex',
      ops: [{ op: 'set', path: ['model'], value: 'gpt-5.2' }],
    })
    fireEvent.change(screen.getByLabelText(en.executorEffort), { target: { value: 'high' } })
    await waitFor(() => { expect(onSaved).toHaveBeenCalledTimes(2) })
    expect(mutate).toHaveBeenLastCalledWith({
      ns: 'subagent-codex',
      ops: [{ op: 'set', path: ['reasoningEffort'], value: 'high' }],
    })
  })

  it('renders without an orchestrator namespace and with unset executor values', async () => {
    const { api } = faces()
    renderCards({ api, executor: executorNs({}) })
    expect(screen.queryByLabelText(en.orchestratorModel)).toBeNull()
    const model = screen.getByLabelText<HTMLSelectElement>(en.executorModel)
    expect(model.value).toBe('')
    const effort = screen.getByLabelText<HTMLSelectElement>(en.executorEffort)
    expect(effort.value).toBe('')
    await waitFor(() => { expect(model.disabled).toBe(false) })
  })

  it('keeps stored values the schema unions no longer advertise selectable', () => {
    const { api } = faces()
    renderCards({
      api,
      executor: executorNs({ model: 'gpt-legacy', reasoningEffort: 'ultra' }),
      orchestrator: orchestratorNs({ provider: 'anthropic', model: 'claude-legacy' }),
    })
    expect(screen.getByLabelText<HTMLSelectElement>(en.executorModel).value).toBe('gpt-legacy')
    expect(screen.getByLabelText<HTMLSelectElement>(en.executorEffort).value).toBe('ultra')
    expect(screen.getByText('claude-legacy (anthropic)')).toBeDefined()
  })

  it('shows a placeholder when the orchestrator has no stored selection', async () => {
    const { api } = faces()
    renderCards({ api, orchestrator: orchestratorNs({}) })
    const select = screen.getByLabelText<HTMLSelectElement>(en.orchestratorModel)
    await waitFor(() => { expect(select.disabled).toBe(false) })
    expect(select.value).toBe('')
  })

  it('surfaces a business-rejected write without calling onSaved', async () => {
    const { api } = faces({ mutate: () => Promise.resolve(rejected('refused')) })
    const { onSaved } = renderCards({ api })
    fireEvent.change(screen.getByLabelText(en.executorModel), { target: { value: 'gpt-5.2' } })
    expect(await screen.findByText('refused')).toBeDefined()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('surfaces a transport-rejected write', async () => {
    const { api } = faces({ mutate: () => Promise.reject(new Error('gone')) })
    renderCards({ api })
    fireEvent.change(screen.getByLabelText(en.executorModel), { target: { value: 'gpt-5.2' } })
    expect(await screen.findByText('gone')).toBeDefined()
  })

  it('surfaces a business-rejected catalog load', async () => {
    const { api } = faces({ models: () => Promise.resolve(rejected('no catalog')) })
    renderCards({ api, orchestrator: orchestratorNs({ provider: 'anthropic', model: 'claude-opus-4-5' }) })
    expect(await screen.findByText(`${en.orchestratorCatalogFailed}: no catalog`)).toBeDefined()
  })

  it('surfaces a transport-rejected catalog load', async () => {
    const { api } = faces({ models: () => Promise.reject(new Error('offline')) })
    renderCards({ api, orchestrator: orchestratorNs({ provider: 'anthropic', model: 'claude-opus-4-5' }) })
    expect(await screen.findByText(`${en.orchestratorCatalogFailed}: offline`)).toBeDefined()
  })

  it('surfaces a per-provider catalog failure beside the sound groups', async () => {
    const { api } = faces({
      models: () => Promise.resolve(ok({
        groups: CATALOG.groups,
        failures: [{ id: 'other', name: 'Other', message: 'down' }],
      })),
    })
    renderCards({ api, orchestrator: orchestratorNs({ provider: 'anthropic', model: 'claude-opus-4-5' }) })
    expect(await screen.findByText(`${en.orchestratorCatalogFailed}: Other: down`)).toBeDefined()
    expect(screen.getByText('Claude Opus 4.5')).toBeDefined()
  })

  it('ignores a catalog answer that lands after unmount', async () => {
    let answer: (value: RpcResponse<typeof CATALOG>) => void = () => undefined
    const { api } = faces({
      models: () => new Promise((resolve) => { answer = resolve }),
    })
    const view = render(
      <DualModelCards
        orchestrator={orchestratorNs({ provider: 'anthropic', model: 'claude-opus-4-5' })}
        executor={executorNs({ model: 'gpt-5.6-sol' })}
        schema={settingsSchema}
        api={api}
        t={t}
        readOnly={false}
        onSaved={vi.fn()}
      />,
    )
    view.unmount()
    answer(ok(CATALOG))
    await Promise.resolve()
  })

  it('disables every select in the read-only posture', async () => {
    const { api } = faces()
    renderCards({
      api,
      readOnly: true,
      orchestrator: orchestratorNs({ provider: 'anthropic', model: 'claude-opus-4-5' }),
    })
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>(en.executorModel).disabled).toBe(true)
    })
    expect(screen.getByLabelText<HTMLSelectElement>(en.orchestratorModel).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLSelectElement>(en.executorEffort).disabled).toBe(true)
  })

  it('hides the effort field when the executor schema declares no union', () => {
    const { api } = faces()
    const bare = {
      ...executorNs({ model: 'gpt-5.6-sol' }),
      schema: JSON.parse(JSON.stringify(Schema.object({
        model: Schema.union(['gpt-5.6-sol']),
        reasoningEffort: Schema.string(),
      }).toJSON())) as unknown,
    }
    renderCards({ api, executor: bare })
    expect(screen.queryByLabelText(en.executorEffort)).toBeNull()
  })
})

describe('unionChoices', () => {
  it('reads string literal choices and refuses non-union nodes', () => {
    const view = executorNs({})
    expect(unionChoices(view, settingsSchema, ['model'])).toEqual(['gpt-5.6-sol', 'gpt-5.2'])
    expect(unionChoices(view, settingsSchema, ['missing'])).toEqual([])
  })
})
