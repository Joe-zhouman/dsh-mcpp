/**
 * 设置页「MCP 工具」分区：拉取工具目录，按 toolset 分组勾选要注册给主
 * agent 的工具，保存选择，并可手动触发一次重新同步。
 *
 * 全部数据来自宿主半区的同源路由（`/plugins/mcpp/ui/*`）。本组件不缓存
 * 选择结果：保存/同步成功后重新拉取目录，用其中的 `registered` 与 `errors`
 * 刷新「已注册数量」和「注册失败项」（同名冲突就出现在这里）。
 */
import { useEffect, useRef, useState } from 'react'
import type {
  McppCatalog,
  McppCatalogToolset,
  McppRegistrationError,
  McppSyncResult,
} from './types.ts'

/** 工具目录：选择文档 + 已注册工具 + 最近一次注册失败项。 */
const CATALOG_URL = '/plugins/mcpp/ui/catalog'

/** 保存选择：body `{ enabled: string[] }`。 */
const SELECTION_URL = '/plugins/mcpp/ui/selection'

/** 手动重新同步（按当前选择文档重新注册）。 */
const SYNC_URL = '/plugins/mcpp/ui/sync'

/** 目录加载状态。 */
type Phase = 'loading' | 'ready' | 'error'

/** 正在进行的写操作；同一时间只允许一个。 */
type Busy = 'save' | 'sync'

/** 一次性结果提示。 */
interface Notice {
  readonly tone: 'ok' | 'error'
  readonly text: string
}

/** 判断一个 JSON 值是不是普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 从 JSON 值里取出对象数组，丢弃非对象项。 */
function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  const records: Record<string, unknown>[] = []
  for (const entry of value) {
    if (isRecord(entry)) records.push(entry)
  }
  return records
}

/** 读取字符串字段；缺失或类型不符时给空串。 */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 读取 `=== true` 的布尔字段。 */
function asBoolean(value: unknown): boolean {
  return value === true
}

/** 读取字符串数组，丢弃非字符串项。 */
function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const list: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string') list.push(entry)
  }
  return list
}

/** 解析注册失败项数组。 */
function asErrors(value: unknown): McppRegistrationError[] {
  const errors: McppRegistrationError[] = []
  for (const entry of asRecordArray(value)) {
    const name = asString(entry.name)
    const message = asString(entry.message)
    if (name !== '' || message !== '') errors.push({ name, message })
  }
  return errors
}

/** 取响应信封里的 error 文案。 */
function errorText(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const message = payload.error
  return typeof message === 'string' && message !== '' ? message : undefined
}

/** 读取响应体；非 JSON（例如网关返回的 HTML 错误页）当作没有 body。 */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed
  } catch {
    // 非 JSON 响应体：状态码仍由调用方按 HTTP 失败处理。
    return undefined
  }
}

/** 发一个同源请求并解出 JSON；非 2xx 用响应里的 error 文案抛错。 */
async function request(url: string, method: 'GET' | 'POST', body?: object): Promise<unknown> {
  const init: RequestInit = body === undefined
    ? { method }
    : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const response = await fetch(url, init)
  const payload = await readBody(response)
  if (!response.ok) throw new Error(errorText(payload) ?? `HTTP ${String(response.status)}`)
  return payload
}

/** 解析 `GET /plugins/mcpp/ui/catalog` 的响应。 */
function parseCatalog(payload: unknown): McppCatalog {
  if (!isRecord(payload)) throw new Error('工具目录响应不是 JSON 对象')
  const toolsets: McppCatalogToolset[] = []
  for (const entry of asRecordArray(payload.toolsets)) {
    const tools = asRecordArray(entry.tools)
      .map(tool => ({
        key: asString(tool.key),
        name: asString(tool.name),
        description: asString(tool.description),
        enabled: asBoolean(tool.enabled),
      }))
      .filter(tool => tool.key !== '')
      .map(tool => ({ ...tool, name: tool.name === '' ? tool.key : tool.name }))
    toolsets.push({ name: asString(entry.name), default: asBoolean(entry.default), tools })
  }
  return {
    serverName: asString(payload.serverName),
    publicOrigin: asString(payload.publicOrigin),
    toolsets,
    registered: asStringList(payload.registered),
    errors: asErrors(payload.errors),
    upstreams: asRecordArray(payload.upstreams).map(entry => ({
      name: asString(entry.name),
      transport: asString(entry.transport),
    })),
  }
}

/** 解析保存/同步响应；`{ok:false}` 信封转成异常。 */
function parseSyncResult(payload: unknown): McppSyncResult {
  if (!isRecord(payload)) throw new Error('同步响应不是 JSON 对象')
  if (!asBoolean(payload.ok)) throw new Error(asString(payload.error) || '同步请求被拒绝')
  return { registered: asStringList(payload.registered), errors: asErrors(payload.errors) }
}

/** 把任意异常转成可展示文案。 */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

/** catalog 的 `enabled` 字段还原成本地勾选集合。 */
function enabledKeysOf(catalog: McppCatalog): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const toolset of catalog.toolsets) {
    for (const tool of toolset.tools) {
      if (tool.enabled) keys.add(tool.key)
    }
  }
  return keys
}

/** 按 catalog 的稳定顺序收集被勾选的稳定 key。 */
function selectedKeys(toolsets: readonly McppCatalogToolset[], enabled: ReadonlySet<string>): string[] {
  const keys: string[] = []
  for (const toolset of toolsets) {
    for (const tool of toolset.tools) {
      if (enabled.has(tool.key)) keys.push(tool.key)
    }
  }
  return keys
}

/** 写操作的结果提示：注册数量 + 失败项数量（明细由 errors 区块展示）。 */
function registrationNotice(prefix: string, result: McppSyncResult): Notice {
  const registered = `已注册 ${String(result.registered.length)} 个工具`
  if (result.errors.length === 0) return { tone: 'ok', text: `${prefix}：${registered}` }
  return { tone: 'error', text: `${prefix}：${registered}，${String(result.errors.length)} 项注册失败` }
}

/** 设置页「MCP 工具」分区。 */
export function McppToolsSection() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [loadError, setLoadError] = useState('')
  const [catalog, setCatalog] = useState<McppCatalog | undefined>(undefined)
  const [enabled, setEnabled] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [busy, setBusy] = useState<Busy | undefined>(undefined)
  const [notice, setNotice] = useState<Notice | undefined>(undefined)
  /** 组件卸载后丢弃在途请求的结果。 */
  const alive = useRef(true)

  /** 拉取工具目录；卸载后不落状态。 */
  const loadCatalog = async (): Promise<void> => {
    try {
      const next = parseCatalog(await request(CATALOG_URL, 'GET'))
      if (!alive.current) return
      setCatalog(next)
      setEnabled(enabledKeysOf(next))
      setPhase('ready')
      setLoadError('')
    } catch (failure: unknown) {
      if (!alive.current) return
      setPhase('error')
      setLoadError(messageOf(failure))
    }
  }

  useEffect(() => {
    alive.current = true
    void loadCatalog()
    return () => { alive.current = false }
  }, [])

  /** 切换一个工具的勾选状态。 */
  const toggleTool = (key: string, checked: boolean): void => {
    setEnabled(previous => {
      const next = new Set(previous)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  /** toolset 行三态复选框：全选/全不选该组工具。 */
  const toggleToolset = (toolset: McppCatalogToolset, checked: boolean): void => {
    setEnabled(previous => {
      const next = new Set(previous)
      for (const tool of toolset.tools) {
        if (checked) next.add(tool.key)
        else next.delete(tool.key)
      }
      return next
    })
  }

  /** 保存选择或重新同步，然后刷新目录并给出结果提示。 */
  const run = async (action: Busy): Promise<void> => {
    if (busy !== undefined || catalog === undefined) return
    setBusy(action)
    setNotice(undefined)
    try {
      const payload = action === 'save'
        ? await request(SELECTION_URL, 'POST', { enabled: selectedKeys(catalog.toolsets, enabled) })
        : await request(SYNC_URL, 'POST')
      setNotice(registrationNotice(action === 'save' ? '已保存' : '已同步', parseSyncResult(payload)))
      await loadCatalog()
    } catch (failure: unknown) {
      setNotice({ tone: 'error', text: `${action === 'save' ? '保存' : '同步'}失败：${messageOf(failure)}` })
    } finally {
      if (alive.current) setBusy(undefined)
    }
  }

  const toolsets = catalog?.toolsets ?? []
  const tools = toolsets.flatMap(toolset => toolset.tools)
  const selectedCount = tools.filter(tool => enabled.has(tool.key)).length
  const dirty = catalog !== undefined && tools.some(tool => tool.enabled !== enabled.has(tool.key))
  const errors = catalog?.errors ?? []
  const working = busy !== undefined

  return (
    <section className="mcpp-section">
      <header className="mcpp-head">
        <h2 className="mcpp-title">MCP 工具</h2>
        <p className="mcpp-hint">
          勾选要通过 mcpp 网关注册给主 agent 的工具；保存后按选择重新注册（默认全部不选）。
        </p>
      </header>

      {catalog === undefined ? null : (
        <div className="mcpp-meta">
          <span className="mcpp-chip">网关 {catalog.serverName === '' ? 'mcpp' : catalog.serverName}</span>
          {catalog.publicOrigin === '' ? null : <span className="mcpp-chip">{catalog.publicOrigin}</span>}
          {catalog.upstreams.map(upstream => (
            <span className="mcpp-chip" key={upstream.name}>{upstream.name} · {upstream.transport}</span>
          ))}
        </div>
      )}

      {notice === undefined ? null : (
        <div
          className={notice.tone === 'ok' ? 'mcpp-notice' : 'mcpp-notice mcpp-notice-error'}
          role="status"
        >
          {notice.text}
        </div>
      )}

      {phase === 'loading' ? <div className="mcpp-muted">正在加载工具目录…</div> : null}

      {phase === 'error' ? (
        <div className="mcpp-notice mcpp-notice-error" role="alert">
          <div>加载工具目录失败：{loadError}</div>
          <div className="mcpp-toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="mcpp-btn" onClick={() => { void loadCatalog() }}>重试</button>
          </div>
        </div>
      ) : null}

      {phase === 'ready' ? (
        <>
          <div className="mcpp-toolbar">
            <button
              type="button"
              className="mcpp-btn mcpp-btn-primary"
              disabled={working}
              onClick={() => { void run('save') }}
            >
              {busy === 'save' ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              className="mcpp-btn"
              disabled={working}
              onClick={() => { void run('sync') }}
            >
              {busy === 'sync' ? '同步中…' : '重新同步'}
            </button>
            <span className="mcpp-muted">
              已选 {selectedCount} / {tools.length} 个工具
              {dirty ? '（有未保存的更改）' : ''}
            </span>
          </div>

          <div className="mcpp-muted">
            当前已注册 {catalog === undefined ? 0 : catalog.registered.length} 个工具
          </div>

          {toolsets.length === 0 ? (
            <div className="mcpp-empty">
              目前没有可注册的工具：上游可能未连接，或者配置里没有可暴露的 expose 条目。
            </div>
          ) : toolsets.map(toolset => {
            const selected = toolset.tools.filter(tool => enabled.has(tool.key)).length
            const all = toolset.tools.length > 0 && selected === toolset.tools.length
            const partial = selected > 0 && !all
            return (
              <div className="mcpp-toolset" key={toolset.name}>
                <label className="mcpp-toolset-head">
                  <input
                    className="mcpp-check"
                    type="checkbox"
                    checked={all}
                    aria-label={`全选 ${toolset.name}`}
                    ref={element => { if (element !== null) element.indeterminate = partial }}
                    onChange={event => { toggleToolset(toolset, event.currentTarget.checked) }}
                  />
                  <span className="mcpp-toolset-name">{toolset.name}</span>
                  {toolset.default ? <span className="mcpp-tag">默认</span> : null}
                  <span className="mcpp-muted">{selected} / {toolset.tools.length}</span>
                </label>
                <div className="mcpp-tools">
                  {toolset.tools.map(tool => (
                    <label className="mcpp-tool" key={tool.key}>
                      <input
                        className="mcpp-check"
                        type="checkbox"
                        checked={enabled.has(tool.key)}
                        aria-label={tool.name}
                        onChange={event => { toggleTool(tool.key, event.currentTarget.checked) }}
                      />
                      <span className="mcpp-tool-name" title={tool.name}>{tool.name}</span>
                      <code className="mcpp-tool-key" title={tool.key}>{tool.key}</code>
                      <span className="mcpp-tool-desc" title={tool.description}>{tool.description}</span>
                    </label>
                  ))}
                </div>
              </div>
            )
          })}

          {catalog !== undefined && catalog.registered.length > 0 ? (
            <details className="mcpp-details">
              <summary>查看已注册的工具名（{catalog.registered.length}）</summary>
              <ul className="mcpp-name-list">
                {catalog.registered.map(name => <li key={name}><code>{name}</code></li>)}
              </ul>
            </details>
          ) : null}

          {errors.length === 0 ? null : (
            <div className="mcpp-errors" role="alert">
              <div className="mcpp-errors-title">
                注册失败 {errors.length} 项（同名工具会被主 agent 拒绝，例如与 mcp-client 的公开名冲突）
              </div>
              <ul className="mcpp-error-list">
                {errors.map((error, index) => (
                  <li key={`${error.name}#${String(index)}`}>
                    <code>{error.name}</code>
                    <span>{error.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : null}
    </section>
  )
}
