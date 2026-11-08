# dsh-mcpp — 设计与非目标

把 Python 版 mcpp 网关（`C:\Users\joe\Documents\repo\skill\mcpp`，以下称「旧服务」）**完整重实现**为一个 DSH 宿主侧 Cordis 插件，取代旧服务本体：同一个 `127.0.0.1:9020`、同一批 MCP 路径、同一个 `config.yaml`、同一个 bearer token。v1 不把工具注册进 dsh 的 `ctx.tools`（那条留待后续讨论）。

## 硬约束

1. **零运行时依赖**：产物 `lib/index.js` 只能 import 宿主提供的 `@deepseek-ai/schemastery`；`js-yaml` 必须被打包进产物（tsdown `alwaysBundle`）。
2. **只读旧服务的 config.yaml**：默认路径由 profile 的 `cordis.patch.yml` 给出（`configPath`）；插件自身不藏任何机器坐标、不复制 token。
3. **行为对齐**：工具名、描述、`inputSchema`、JSON-RPC 响应体与旧服务逐字段一致（见 `test/fixtures/golden/`，由 parity 组抓取）。允许的偏差只有：格式错误的 body 返回 JSON-RPC `-32700`/`-32600`（旧服务是 500）；参数变换错误返回 `-32602`。
4. **文件所有权**：只改自己名下的文件（见下表）。跨文件契约变更先改 `src/types.ts` 并通知 Lead。

## 模块与契约

| 文件 | 负责人 | 旧服务对应 |
|---|---|---|
| `src/types.ts` | Lead | `config.py` 的模型 + `upstream.py` 的 `Tool` |
| `src/errors.ts` | Lead | — |
| `src/logger.ts` | Lead | `logging` |
| `src/presets.ts` | Lead | `clients.py` + `client-presets.yaml` |
| `src/config.ts` | config-transform | `config.py` |
| `src/transform.ts` | config-transform | `transform.py` |
| `src/keypool.ts` | config-transform | `keypool.py` |
| `src/upstream-http.ts` | upstream | `upstream.py` `HttpTransport` |
| `src/upstream-stdio.ts` | upstream | `upstream.py` `StdioTransport` |
| `src/gateway.ts` | gateway-admin | `main.py` `_make_mcp_handler` / `_fetch_all_tools` / `_find_expose_entry` |
| `src/admin.ts` | gateway-admin | `main.py` `/api/*` 路由 |
| `src/server.ts` | Lead | `main.py` 路由注册 + 鉴权 + cookie + 静态页 |
| `src/bootstrap.ts` | Lead | `main.py` `lifespan` / `_build_upstreams` / `_warm_stdio_upstreams` / `_persist_and_reload` |
| `src/plugin.ts`, `index.mjs` | Lead | — |
| `static/index.html` | Lead | 旧服务 `src/mcpp/static/index.html`（原样拷贝） |
| `test/fixtures/golden/**` | parity | — |

### `src/config.ts`

```ts
export function loadConfigFile(path: string, env?: NodeJS.ProcessEnv): GatewayConfig
export function parseConfig(text: string, env?: NodeJS.ProcessEnv): GatewayConfig
export function dumpConfig(config: GatewayConfig): string
export function resolveEnvValue(value: string, env?: NodeJS.ProcessEnv): string
```

- `parseConfig` 做模型校验（缺字段、错类型、未知字段报 `ConfigError`），带 Python 的默认值：`transport='http'`、`inherit_env=['PATH']`、`connect_timeout=30`、`read_timeout=120`、`list_timeout=20`、`server_name='mcpp'`、`hide=false`、`hidden=false`、`ParamsTransform.required=undefined`。
- 交叉校验：`validate_refs`（描述里 `` `upstream/tool` `` 引用必须存在且未 hide）、`validate_toolsets`（toolset 不得是保留名 `fetch`）。错误抛 `ConfigError`，消息措辞可自拟。
- `resolveEnvValue` 只认 `${VAR}`（不认裸 `$VAR`），未定义变量解析为空串。
- `dumpConfig` 供 admin 落盘：等价 `yaml.safe_dump(exclude_none=True, sort_keys=False, allow_unicode=True)` —— 丢弃 `undefined`/`null` 字段、保留键序、不折行。
- 文件读取用 `readFileSync(path,'utf8')`；读失败抛 `ConfigError`（含路径）。

### `src/transform.ts`

```ts
export function transformTools(upstreamName: string, tools: Tool[], config: GatewayConfig, client?: string, toolset?: string): Tool[]
export function paramTransformValue(rawArgs: JsonObject, entry: ExposeEntry): JsonObject
export function buildDownstreamSchema(entry: ExposeEntry, upstreamSchema?: JsonObject): JsonObject | undefined
export function displayName(entry: ExposeEntry, key: string): string
```

- `displayName(entry,key) = entry.as ?? key.split('/').at(-1)`。
- `transformTools`：上游工具按 `(upstream, tool)` 反查 expose 键；未暴露或 `hide` 的工具丢弃；`toolset` 非空时只保留 `(entry.toolset ?? serverName) === toolset`；输出名用 `getFormat(client).formatName(toolset, displayName)`；描述 `entry.description ?? tool.description ?? ''` 后做反引号交叉引用展开（`` `upstream/tool` `` → 该工具在当前 client 下的名字；未知引用原样保留）；schema 走 `buildDownstreamSchema`。只输出 `name`/`description`/`inputSchema`（与旧服务一致，不转发 annotations/title）。
- `buildDownstreamSchema`：`entry.params === undefined` 时原样返回上游 schema；否则按 `params` 顺序构造 `properties`（跳过 `hidden`），每个属性**从上游属性的拷贝开始**（保留 enum/format/items/… 等约束），`description` 按覆盖规则，`type=enum`→`{type:'string',enum:mapping 的键}`，`type=preset`→`{type:'string',enum:preset 的键}`；`required` 规则：显式 `required` 优先，否则继承上游 `required` 数组。
- `paramTransformValue`：`entry.params === undefined` 时原样返回；否则按 params 顺序构造上游参数：`hidden` 且 `default !== undefined` 时注入 `upstream_name: default`；值缺失（`undefined`/`null`）跳过；`enum`/`preset` 值不在白名单抛 `ParamError`（消息含合法值列表）；其余按 `mapFrom ?? name` 透传。preset 的注入是浅合并（`{...upstream, ...preset[value]}`）。

### `src/keypool.ts`

```ts
export class KeyPool implements KeyPoolView
```

轮转 + 暂停语义与旧服务一致：`next()` 跳过已暂停键、全暂停抛 `Error('No healthy keys available in pool')`；`current` 返回最近一次 `next()` 返回的键；`statuses()` 的 `key` 为 `前4字符 + '...'`。构造时空数组抛错。

### `src/upstream-http.ts`

```ts
export interface HttpTransportOptions {
  name: string
  url: string
  getAuth?: () => Record<string, string> | undefined
  connectTimeout?: number
  readTimeout?: number
}
export class HttpTransport implements UpstreamTransport
export function parseSseJson(text: string): JsonObject | null
```

逐条移植 `upstream.py:74-271`：

- 端点解析：URL 路径里已含 `/mcp`（大小写不敏感）就原样用，否则追加 `/mcp`。
- 延迟 `initialize`（`protocolVersion: '2025-11-25'`, `capabilities: {}`, `clientInfo: {name:'mcpp', version:'0.1.0'}`）→ 记 `mcp-session-id` → 发 `notifications/initialized`；无 session id 就无状态继续。
- 每次请求带 `Content-Type: application/json`、`Accept: application/json, text/event-stream`、可选 `MCP-Session-Id`、可选 auth headers（每次重新调 `getAuth()`）。
- `_rpc` 重试语义：**传输层异常**（fetch 抛错 = 连接被断/重置）→ `recoverConnection()`（丢 session + 重建 connection，Node 侧用新 `undici` Agent/`fetch` 的 `dispatcher` 或直接丢弃 keep-alive agent）→ 重试一次；HTTP 404 且已有 session → 丢 session 重试一次；其它 HTTP 非 200 抛 `UpstreamHttpError(message, status)`；**HTTP 错误不重试**。
- 响应解析：`content-type` 以 `application/json` 开头 → JSON；`text/event-stream` → `parseSseJson`（首个 data 事件、多行 data 以 `\n` 拼接，无尾随空行也要 flush）；其它类型尝试 JSON，失败抛 `UpstreamHttpError(..., status)`。响应里有 `error` 键 → 抛 `UpstreamRpcError("Upstream '<name>' JSON-RPC error: <message>")`。
- `listTools()` → `result.tools`；`callTool(name,args)` → `result`。
- `close()` 幂等。超时用 `AbortSignal.timeout(readTimeoutMs)`；连接超时用 Node 原生 `connect` 超时（`undici` 的 `headersTimeout`/`bodyTimeout` 不区分 connect，可接受：读超时用 signal，连接建立由 `socket` 超时兜底——实现见笔记）。错误信息前缀 `Upstream '<name>' ...`。

### `src/upstream-stdio.ts`

```ts
export interface StdioTransportOptions {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  inheritEnv?: string[]
  readTimeout?: number
}
export class StdioTransport implements UpstreamTransport {
  ensureProcess(): Promise<void>      // 供启动预热
  closeIfUnready(): Promise<void>
  killNowait(): void
}
```

逐条移植 `upstream.py:274-612`：`child_process.spawn` + 单 reader 循环、`_pending` map 按 id 派发、`initialize`/`notifications/initialized` 握手、两种帧格式（换行 JSON 与 `Content-Length`）、读超时后 pop pending、EOF/进程退出时 fail 全部 pending 并清 ready 以便下次重生成、`_fail_pending` 消息措辞、Windows 上直接 `kill()`/`SIGTERM`（不需要进程组）、`spawn` 时 stderr 采集（退出时截 500 字符进错误消息）、`stdin` 写入串行化（Node 的 write 需要背压处理）。`inheritEnv` 默认 `['PATH']`，合并顺序：继承环境 → `env` 覆盖。

### `src/gateway.ts`

```ts
export interface McpRequestContext { clientId: string; rawToolset: string; body: unknown }
export function handleMcpRequest(deps: McpHandlerDeps, ctx: McpRequestContext): Promise<HttpReply>
export function fetchAllTools(deps: McpHandlerDeps, config: GatewayConfig, client?: string, toolset?: string): Promise<Tool[]>
export function fetchTools(deps: McpHandlerDeps, config: GatewayConfig, upstreamName: string, client: string, toolset: string | undefined, listTimeout: number): Promise<Tool[]>
export function resolveToolset(config: GatewayConfig, toolset: string): string | null
export function knownToolsets(config: GatewayConfig): Set<string>
export function findExposeEntry(config: GatewayConfig, nameOrKey: string, client: string, toolset: string | undefined): { entry: ExposeEntry; upstreamName: string } | null
```

对齐 `main.py:35-85, 417-679` 的语义：

- `resolveToolset`：已知 toolset 原样返回；字面 `mcpp` 映射到 `serverName`；否则 `null` → 404 `{"error":"Unknown toolset: X"}`（先检查 `clients[clientId] === false` → 404 `{"error":"client 'X' endpoint disabled"}`）。
- `handleMcpRequest` 的 JSON-RPC 分支（响应体一律 `{jsonrpc:'2.0', id: reqId, ...}`）：
  - `initialize` → `{protocolVersion, capabilities:{tools:{}}, serverInfo:{name:'mcpp/<toolset>', version:'0.1.0'}}`
  - `notifications/initialized` → 202 空对象（注意：handler 返回 `{status:202, body:{}}`）
  - `tools/list` → `{tools:[...]}`（并发抓所有上游，单上游失败/超时只跳过并记 warn）
  - `tools/call`：缺 `name` → `-32602`；找不到工具 → `-32601`；无 transport → `-32000 "[gateway] upstream=<n>: no transport"`；成功 → `{result}`；`UpstreamHttpError` 401/403/429 → `keypool.markBad(current)`（keypool 由 deps 之外的 `onUpstreamStatus` 回调提供，见下）；HTTP 错误 → `-32000 "[gateway] upstream=<n>: HTTP <status>"`；其它异常 → `-32000 "[gateway] upstream=<n>: <message>"`。每次调用记 `recordCall`（成功与失败都记，含 latencyMs、error 截断 200 字符）。
  - `server/discover` → `{protocolVersion, serverInfo:{name:toolset,version:'0.1.0'}, capabilities:{tools:{}}}`
  - 未知方法 → `-32601 "Unknown method: <m>"`
  - 非对象 body → `-32600 "Invalid Request: body must be a JSON object"`
- `findExposeEntry`：非 default client 先用 `format.parseName(toolset ?? serverName, name)` 解析，失败且 `toolset !== serverName` 时再用 `serverName` 重试；命中 display name 返回；否则按 (stable key | display name) 在 toolset 内匹配。`hide` 的条目不参与。
- `fetchTools`：`Promise.race` 超时（`listTimeout` 秒）；超时/异常 → 打 warn 返回 `[]`；`transformTools(...)` 后 `Tool` 原样返回（不再过滤 undefined 字段——`JSON.stringify` 天然丢 undefined）。

为让 `markBad` 生效，`McpHandlerDeps` 增加一个可选成员（在 `types.ts` 里补）：

```ts
/** 上游返回 401/403/429 时标记当前 key 不健康；无 keypool 时为 undefined。 */
onUpstreamStatus?(upstreamName: string, status: number): void
```

### `src/admin.ts`

```ts
export interface AdminRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  segments: string[]            // URL path 去掉 '/api/' 前缀并按 '/' 解码后的段
  query: URLSearchParams
  bodyText(): Promise<string>
  bodyJson(): Promise<unknown>
}
export function handleAdminRequest(deps: AdminDeps, request: AdminRequest): Promise<HttpReply>
```

路由表与旧服务一一对应（`main.py:682-1223`），响应体逐字段一致：

| 方法 + 路径 | 行为 |
|---|---|
| `GET /api/config` | `{yaml: dumpConfig(config)}` |
| `POST /api/config` | body 为 YAML 文本 → `parseConfig` → `persistConfig`；失败 400 `{error}` |
| `GET /api/tools?toolset=&client=` | 工具预览数组；`toolset=mcpp` 视为默认 toolset |
| `GET /api/upstreams` | 上游名数组 |
| `GET /api/upstreams/{name}` | `{name,transport,env,inherit_env}`（http 上游 env/inherit_env 为 null） |
| `PUT /api/upstreams/{name}` | 只允许改 env/inherit_env，identity 字段强制回原值 |
| `GET /api/upstreams/{name}/tools` | 原始工具（未变换）；失败 502 |
| `POST /api/upstreams/{name}/test` | `{ok,latency_ms,tool_count,tools,error}` |
| `GET /api/toolsets` | `[{toolset,tools:[key...],default}]` |
| `GET /api/client-presets` | `presets()` |
| `GET /api/expose` | 每个 expose 条目 + 上游 raw 描述/schema 合并（`_merge_params` 语义） |
| `PUT /api/expose/{key}` | 结构化 body 更新单条；identity 字段强制回原值；先 staged 校验再提交 |
| `DELETE /api/expose/{key}` | 被别的描述反引号引用时 409 |
| `GET /api/keys` | `{upstream: {healthy_count, keys:[{index,key,paused}]}}` |
| `POST /api/keys/{upstream}/resume` | `{key_index}` → 恢复 |
| `POST /api/keys/{upstream}` | 追加一个 key |
| `DELETE /api/keys/{upstream}/{index}` | 删除指定 key |
| `POST /api/add-server` | `{json_text, toolset?}` → 解析 Claude-Desktop 形状、探测工具、生成透传 expose |
| `GET /api/calls` | 调用记录，新的在前 |

`_merge_params`、`_parse_claude_desktop_entry`、`_probe_tools` 一并移植。所有 4xx 用 `{error: "..."}`，404 措辞与旧服务一致。

### `src/server.ts`（Lead）

路由 + 鉴权 + cookie + 静态页；调用上面两个 handler。路径匹配：

- `POST /mcp` → legacy alias: client `default`，toolset = 默认。
- `POST /{toolset}/{naming}/mcp` → 已知 naming 时进 gateway；未知 naming → 404（旧服务里这些路径不存在，返回 FastAPI 404 `{"detail":"Not Found"}`）。
- `GET|POST|PUT|DELETE /api/...` → admin。
- `GET /admin` → `static/index.html`。
- 其余 → 404 `{"detail":"Not Found"}`。
- 鉴权：`config.auth.token` 非空时校验 header `Authorization: Bearer` → `?token=` → cookie `mcpp_token`；失败 401 `{"detail":"Invalid or missing token"}`。成功且来自 `?token=` 且无 cookie 且状态 200 → `Set-Cookie: mcpp_token=<token>; Max-Age=2592000; HttpOnly; SameSite=Lax`。
- token 每次请求用 `resolveEnvValue(config.auth.token, process.env)` 现算。

## 测试

- 单元测试用 `node --test --experimental-strip-types test/<name>.test.mjs`，只 import `../src/<module>.ts`，不联网、不依赖真实上游；HTTP/stdio 客户端用本地 mock server / mock subprocess（`node:test` 的 `t.after` 收尾）。
- 每个文件至少覆盖：正常路径、错误路径、边界（空值、超时、重复关闭）。
- `npm test`（= `node --test --experimental-strip-types test/*.test.mjs`）必须全绿；`npm run typecheck` 必须干净。
- parity 组另外维护 `test/fixtures/golden/**`（真实旧服务响应）与 `scripts/parity/**`，不算单测。

## 常用命令（在 `L:\dsh\.local-deploy\mcpp-plugin`）

```powershell
$node = "D:\softwares\node-v24.21.0-win-x64\node.exe"
& $node --test --experimental-strip-types test/config.test.mjs
& $node ../../node_modules/tsdown/dist/run.mjs --config tsdown.config.mjs --config-loader native
& $node ../../node_modules/typescript/bin/tsc -p tsconfig.json
```

（`npm run test:...` 也行，只要 PATH 里有那个 node。）

## 增量 v0.2：dsh 原生工具面 + 选择面板 + 侧栏/设置 UI（2026-11-08 第二轮）

**目标**：对 dsh 不再经第二层 MCP 转发——把聚合工具以 `mcp__<toolset>__<tool>` 的公开名**全局注册**进 `ctx.tools`，`execute` 直连上游 transport；外部客户端仍走 9020 的 HTTP MCP 端点。新增：默认全关的 toolset+单工具两级选择、管理页同源进 dsh-better-sidebar 侧栏、设置页分区、供其他插件消费的 `ctx.mcpp` 服务。

### 新增文件与所有权

| 文件 | 负责人 | 说明 |
|---|---|---|
| `src/dsh.ts` | Lead | dsh 宿主服务的最小本地类型（tools/webServer/connection/plugin ctx） |
| `src/native-tools.ts` | native-tools | `ToolDefinition` 适配器 + 代际差量注册 |
| `src/selection.ts` | native-tools | 选择文档读写（`$DSH_HOME/storages/mcpp/selection.json`） |
| `src/dsh-routes.ts` | dsh-routes | `/plugins/mcpp/**` 同源路由（管理页 + admin API 直连 + ui API） |
| `static/index.html` | dsh-routes | 在旧服务页面上做最小改动：API base / 公开 origin / token 来源可注入 |
| `src/client/**` | client-ui | 浏览器半区：侧栏 tab（iframe）+ 设置页分区（工具勾选） |
| `src/plugin.ts`、`package.json`、`tsdown.config.mjs` | Lead | 接线、服务、双 pass 构建 |

### `src/native-tools.ts`

```ts
export interface NativeToolSpec {
  publicName: string      // mcp__<toolset>__<display>（getFormat('claude') 生成）
  key: string             // 稳定 expose key（upstream/tool）
  toolset: string
  description: string
  inputSchema?: JsonObject
  upstreamName: string
  entry: ExposeEntry
}
export function collectNativeToolSpecs(config: GatewayConfig, upstreamTools: Map<string, Tool[]>): NativeToolSpec[]
export function createNativeToolSet(deps: NativeToolDeps): NativeToolSet
```

- 规格来源：遍历 `config.expose` 的非 hidden 条目；名字 = `getFormat('claude').formatName(toolset, displayName)`；描述/schema 取自 `transformTools(upstreamName, rawTools, config, 'claude')` 的同名结果（复用现有变换，不重写逻辑）；上游没有该工具则跳过。
- `ToolDefinition`：`name` / `description` / `parameters=inputSchema` / `output` / `execute` / `timeoutMs`（`deps.timeoutFor?.(spec)`）。
  - `output.schema = {type:'object', properties:{content:{type:'array',items:{}}, structuredContent:{}}, required:['content'], additionalProperties:false}`；
  - `output.render(_args, value)`：把 `value.content` 里的 MCP content 投影为纯文本（`text` 块拼接；image/audio/resource 用占位符，与 mcp-client 的 fallback 语义一致）；
  - `execute(args, exec)`：`paramTransformValue(args as JsonObject, entry)` → `deps.call(upstreamName, entry.tool, upstreamArgs, exec.signal)` → 上游 `isError === true` 时 `throw new Error(text)`（DSH 记为失败），否则返回 `{content, ...structuredContent !== undefined ? {structuredContent} : {}}`。
- `sync(specs)`：按 `publicName` 差量——新增注册、消失的注销、规格哈希（name+description+schema+key+upstream+tool）变化的先注销再注册；单工具注册失败（同名冲突等）记入 `errors` 并继续其它工具，**不能整体失败**。`dispose()` 注销全部。
- 测试：假 `DshToolsService`（Map 记录）、假 call；覆盖名字/描述/schema、execute 参数映射与 `isError` 抛错、差量同步与冲突报告。

### `src/selection.ts`

```ts
export interface SelectionDocument { version: 1; enabled: string[] }   // 稳定 key
export function selectionPathFromEnv(env?: NodeJS.ProcessEnv): string  // <DSH_HOME>/storages/mcpp/selection.json
export function createSelectionStore(path: string): SelectionStore     // load/save/path
```

- 缺文件 → `{version:1, enabled:[]}`（默认全关）；文件损坏 → 打 warn 并回落到空选择，**不让插件失败**；`save` 用临时文件 + rename 原子写，自动建目录；`load` 过滤非字符串/重复项。

### `src/dsh-routes.ts`

```ts
export function registerDshRoutes(webServer: DshWebServer, deps: DshRoutesDeps): () => void
```

路由（全部先过 `deps.rejectRequest?.(req)`，非 undefined → 403 JSON）：

| 路由 | 方法 | 行为 |
|---|---|---|
| `/plugins/mcpp/admin` | GET | 返回 `static/index.html`，`<head>` 后注入 `<script>window.__MCPP_API_BASE__='/plugins/mcpp/api';window.__MCPP_PUBLIC_ORIGIN__='<deps.publicOrigin()>';window.__MCPP_TOKEN__='<deps.token()>';</script>` |
| `/plugins/mcpp/api/*` | GET/POST/PUT/DELETE | 把 `*` 作为 `segments` 直接交给进程内 `handleAdminRequest(deps.admin, …)`（与 9020 同一 handler、同一响应体），写明 `Content-Type: application/json` |
| `/plugins/mcpp/ui/catalog` | GET | `{serverName, publicOrigin, toolsets:[{name, default, tools:[{key, name, description, enabled}]}], registered:[names], errors:[{name,message}], upstreams:[{name,transport}]}` |
| `/plugins/mcpp/ui/selection` | POST | body `{enabled: string[]}` → `selection.save` → `native.resync()` → `{ok:true, registered, errors}`；非法 body → 400 `{ok:false,error}` |
| `/plugins/mcpp/ui/sync` | POST | `native.resync()` → `{ok:true, registered, errors}` |

- 未知路径 404 `{error}`；方法不符 405。
- `static/index.html` 的最小改动（保持 9020 独立访问不变）：`api()` 里 `fetch(url)` → `fetch((window.__MCPP_API_BASE__||'')+url)`；`getToken()` 优先 `window.__MCPP_TOKEN__`；连接模板的 origin 用 `window.__MCPP_PUBLIC_ORIGIN__ || location.origin`；同源模式下鉴权提示显示"通过 dsh 会话鉴权"。
- 测试：假 `DshWebServer` 只收集路由；假 admin/native/selection；断言 HTML 注入、catalog 形状、selection 保存→resync、admin 透传状态与 body、fence 403、方法 405。

### `src/client/**`（浏览器半区）

- 入口 `src/client/index.tsx`：`export function apply(ctx)`。
- 侧栏 tab：`ctx.get('betterSidebar')?.registerTab({ id:'mcpp:admin', title:'MCP 网关', description:'聚合工具与网关管理', icon, order: 45, single: true, component: McppAdminPanel })`；`McppAdminPanel` = `<iframe src="/plugins/mcpp/admin">` 占满容器（`visible` 为 false 时无需轮询，纯 iframe）。
- 设置页分区：`ctx.get('slots')` → `slots.inject('settings.section', () => slots.register({name:'settings.section', id:'mcpp', order: 45, label: () => 'MCP 工具'}, McppToolsSection))`；`McppToolsSection` 拉 `/plugins/mcpp/ui/catalog`，按 toolset 分组渲染复选框 + toolset 全选/全不选 + 保存（POST selection）+ 同步（POST sync）+ 显示 registered 数量与注册失败项（如与 mcp-client 同名冲突）。
- 只允许 `import ... from 'react'`；不得 import 任何 `@deepseek-ai/*` 值（module table 只提供 react）。本地类型放 `src/client/types.ts`。样式用内联 style + 一个 `<style>` 注入（无 CSS Modules）。
- 服务缺失（无 slots / 无 betterSidebar）时安静跳过，不抛错。

### `src/plugin.ts`（Lead 接线）

- 启动顺序：gateway.start() →（异步）首次 native sync → `ctx.provide('mcpp', service)` →（如有 webServer）`registerDshRoutes`。
- `ctx.mcpp` 服务：`{ catalog(): Promise<…>, call(name, args, signal?): Promise<JsonObject>, upstreams(): string[], toolsets(): string[] }`；`call` 用 `findExposeEntry(config, name, 'claude', undefined)` 解析 → `paramTransformValue` → transport.callTool（未选中的工具也能调，服务面向插件而非模型）。
- 选择变更/配置 reload 后重抓上游工具并重注册；上游抓取失败只影响该上游的工具（沿用 `fetchTools` 语义）。
- 所有注册/路由必须走 `ctx.effect`，随插件卸载释放。

### 验收

1. 单测全绿；`tsc` 干净；`tsdown` 产出 `lib/index.js` + `lib/client.js`。
2. 假宿主集成测试：注册 0 个（默认）→ 勾选 2 个 → `ctx.tools` 出现 2 个 `mcp__*`；取消 → 消失；执行一个工具经假上游返回内容；同名冲突进 errors。
3. 真机（重启桌面端后）：dsh 会话里模型能直接调用勾选工具；侧栏出现「MCP 网关」页签；设置页出现「MCP 工具」分区且勾选生效；9020 外部端点仍 91/91 对齐。
