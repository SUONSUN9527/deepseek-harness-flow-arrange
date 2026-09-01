/**
 * Dual-model deployment cards: the orchestrator's default-model dropdown and
 * the Codex executor's managed-configuration summary. The block renders only when the
 * host registers the executor settings namespace (`subagent-codex`), which is
 * the deployment's own declaration that a second model plane exists — a
 * single-model install never sees it. Every choice list is a fact the host
 * already owns: orchestrator models come from the live `llm.models` catalog,
 * executor settings remain owned by native Codex configuration, so the page
 * cannot accidentally diverge from the worker's runtime. Orchestrator changes
 * commit immediately through `settings.mutate` and the page re-renders from the
 * next describe.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  IApiClient, ModelProviderGroup, SettingsNamespaceView, SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { messageOf } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** The executor settings namespace whose registration enables this block. */
export const EXECUTOR_SETTINGS_NS = 'subagent-codex'

/** The orchestrator default-model namespace (agent-default-model plugin). */
export const ORCHESTRATOR_SETTINGS_NS = 'agent-default-model'

/**
 * Joins a provider route and model id into one option value. The unit
 * separator cannot occur in either identifier, so the split at its first
 * occurrence is unambiguous.
 */
const OPTION_SEPARATOR = String.fromCharCode(0x1F)

/** Injected dependencies of {@link DualModelCards}. */
export interface DualModelCardsProps {
  /** The `agent-default-model` namespace view, when the plugin is mounted. */
  orchestrator: SettingsNamespaceView | undefined
  /** The `subagent-codex` namespace view (the block's render condition). */
  executor: SettingsNamespaceView
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Wire faces: settings writes and the host-scoped model catalog. */
  api: Pick<IApiClient, 'settings' | 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes (read-only settings provider). */
  readOnly: boolean
  /** Reload the page snapshot after a committed write. */
  onSaved: () => void
}

/**
 * String literal choices of a union schema node inside a namespace's own
 * schema, the same read `protocolChoices` makes for the create card: the page
 * offers exactly what the owning plugin's `Config` accepts.
 * @param namespace - the namespace view whose schema declares the field.
 * @param schema - settings schema operations.
 * @param path - path from the section root to the union field.
 * @returns the string choices, or an empty list when the node is not a union.
 */
export function unionChoices(
  namespace: SettingsNamespaceView,
  schema: SettingsSchemaOperations,
  path: readonly string[],
): string[] {
  const node = schema.nodeAtPath(schema.rehydrate(namespace.schema), path)
  const union = node as { type?: string; list?: readonly { value?: unknown }[] } | undefined
  if (union?.type !== 'union' || union.list === undefined) return []
  return union.list.map(entry => entry.value).filter((value): value is string => typeof value === 'string')
}

/** A string field of a namespace's resolved section value. */
function stringField(
  namespace: SettingsNamespaceView,
  schema: SettingsSchemaOperations,
  key: string,
): string | undefined {
  const value = schema.getPath(namespace.value, [key])
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** One card's mutable write state. */
interface WriteState {
  busy: boolean
  failure: string | undefined
  saved: boolean
}

const IDLE_WRITE: WriteState = { busy: false, failure: undefined, saved: false }

/**
 * Render the dual-model block: one card for the orchestrator's default model,
 * plus a summary of the executor settings owned by native Codex configuration.
 * @param props - namespace views, wire faces, and copy.
 * @returns the block.
 */
export function DualModelCards(props: DualModelCardsProps): ReactNode {
  const { orchestrator, schema, api, t } = props
  const [groups, setGroups] = useState<ModelProviderGroup[] | undefined>(undefined)
  const [catalogFailure, setCatalogFailure] = useState<string | undefined>(undefined)
  const [write, setWrite] = useState<WriteState>(IDLE_WRITE)

  useEffect(() => {
    let stale = false
    void api.llm.models({}).then(
      (response) => {
        if (stale) return
        if (!response.result.ok) {
          setCatalogFailure(response.result.error.message)
          return
        }
        setGroups(response.result.value.groups)
        const failure = response.result.value.failures[0]
        if (failure !== undefined) setCatalogFailure(`${failure.name}: ${failure.message}`)
      },
      (error: unknown) => {
        if (!stale) setCatalogFailure(messageOf(error))
      },
    )
    return () => { stale = true }
  }, [api.llm])

  const commit = (ns: string, ops: SettingsPathOpView[]): void => {
    setWrite({ busy: true, failure: undefined, saved: false })
    void api.settings.mutate({ ns, ops }).then(
      (response) => {
        if (!response.result.ok) {
          setWrite({ busy: false, failure: response.result.error.message, saved: false })
          return
        }
        setWrite({ busy: false, failure: undefined, saved: true })
        props.onSaved()
      },
      (error: unknown) => {
        setWrite({ busy: false, failure: messageOf(error), saved: false })
      },
    )
  }

  const disabled = props.readOnly || write.busy

  const currentProvider = orchestrator === undefined ? undefined : stringField(orchestrator, schema, 'provider')
  const currentModel = orchestrator === undefined ? undefined : stringField(orchestrator, schema, 'model')
  const currentOption = currentProvider !== undefined && currentModel !== undefined
    ? `${currentProvider}${OPTION_SEPARATOR}${currentModel}`
    : ''
  const catalogHasCurrent = groups?.some(group =>
    group.id === currentProvider && group.models.some(model => model.id === currentModel)) === true

  return (
    <div>
      <h3 className={styles['title']}>{t('dualTitle')}</h3>
      <p className={styles['intro']}>{t('dualIntro')}</p>
      <ul className={styles['rows']}>
        {orchestrator === undefined
          ? null
          : (
            <li className={styles['rowCard']}>
              <div className={styles['rowHead']}>
                <span className={styles['rowIdentity']}>
                  <span className={styles['rowName']}>{t('orchestratorModel')}</span>
                </span>
              </div>
              <p className={styles['advancedHint']}>{t('orchestratorHint')}</p>
              <div className={styles['field']}>
                <span className={styles['fieldLabel']}>{t('model')}</span>
                <select
                  className={`${styles['input']} ${styles['selectInput']}`}
                  value={currentOption}
                  aria-label={t('orchestratorModel')}
                  disabled={disabled || groups === undefined}
                  onChange={(event) => {
                    const separator = event.target.value.indexOf(OPTION_SEPARATOR)
                    /* v8 ignore next -- every selectable option carries the separator */
                    if (separator < 0) return
                    commit(ORCHESTRATOR_SETTINGS_NS, [
                      { op: 'set', path: ['provider'], value: event.target.value.slice(0, separator) },
                      { op: 'set', path: ['model'], value: event.target.value.slice(separator + 1) },
                      // A per-model capability: the previous model's level may
                      // not exist on the new one, so the change resets it to
                      // the adapter default rather than carrying it over.
                      { op: 'unset', path: ['reasoningEffort'] },
                    ])
                  }}
                >
                  {/* A stored selection the catalog no longer advertises stays
                      selectable as itself: catalog membership is advisory and
                      the route may still serve it. */}
                  {currentOption !== '' && !catalogHasCurrent
                    ? <option value={currentOption}>{`${currentModel ?? ''} (${currentProvider ?? ''})`}</option>
                    : currentOption === '' ? <option value="">{'—'}</option> : null}
                  {(groups ?? []).map(group => (
                    <optgroup key={group.id} label={group.name}>
                      {group.models.map(model => (
                        <option key={model.id} value={`${group.id}${OPTION_SEPARATOR}${model.id}`}>
                          {model.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              {catalogFailure === undefined
                ? null
                : <p className={styles['error']}>{`${t('orchestratorCatalogFailed')}: ${catalogFailure}`}</p>}
            </li>
          )}
        <li className={styles['rowCard']}>
          <div className={styles['rowHead']}>
            <span className={styles['rowIdentity']}>
              <span className={styles['rowName']}>{t('executorModel')}</span>
            </span>
          </div>
          <p className={styles['advancedHint']}>{t('executorHint')}</p>
        </li>
      </ul>
      {write.failure !== undefined ? <p className={styles['error']}>{write.failure}</p> : null}
      {write.saved
        ? <p className={styles['savedNotice']} role="status" aria-live="polite">{t('dualSaved')}</p>
        : null}
    </div>
  )
}
