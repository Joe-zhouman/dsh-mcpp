# dsh-mcpp

把 Python 版 **mcpp** 网关（`C:\Users\joe\Documents\repo\skill\mcpp`，一个 MCP 聚合网关）完整重实现为 **DSH 宿主侧 Cordis 插件**。旧服务退场后，`127.0.0.1:9020` 上回答 `/api/*`、`/admin` 与 `/{toolset}/{naming}/mcp` 的就是这个插件。

**对客户端是 drop-in**：同一批路径、同一个 `config.yaml`、同一个 `auth.token`。Claude Code / Cursor / OpenCode / Codex 等现有配置一行都不用改。

**对 dsh 自己是原生的（v0.2）**：聚合工具以 `mcp__<toolset>__<tool>` 的公开名直接注册进 `ctx.tools`，调用直连上游（不再经第二层 MCP 转发）；默认全关，在 dsh 设置页「MCP 工具」里按 toolset / 单工具勾选后才注册给主 agent。管理页以同源 iframe 进 `dsh-better-sidebar` 侧栏「MCP 网关」页签。其他插件可经 `ctx.mcpp` 服务直接取目录、调用任意已暴露工具。

## 它做什么

### 对外 HTTP 网关（v0.1，保留）

- 读取旧服务的 YAML（`upstreams` / `expose` / `server_name` / `auth` / `clients`），把上游 MCP 服务器（Streamable HTTP 与 stdio 子进程）聚合成若干 **toolset**，每个 toolset 按多种 **naming mode** 暴露：
  - `/{toolset}/claude/mcp` → `mcp__{toolset}__{tool}`
  - `/{toolset}/cursor/mcp` → `mcp_{toolset}_{tool}`
  - `/{toolset}/opencode/mcp` → `{toolset}_{tool}`
  - `/{toolset}/coder/mcp` → `{toolset}__{tool}`
  - `/{toolset}/codex/mcp` → `{toolset}::{tool}`
  - `/{toolset}/default/mcp` → `{tool}`（另有 legacy `/mcp`）
- 工具面改写：`as:` 改名、`hide: true` 隐藏、`toolset` 分组、描述里 `` `upstream/tool` `` 反引号交叉引用按客户端格式展开、`params` 的 `map_from` / `enum` / `preset` / `hidden+default` / `required` 覆盖。
- 上游密钥池：轮转 + 401/403/429 标记不健康 + `/api/keys` 管理。
- 管理接口与页面：`/api/config`、`/api/tools`、`/api/upstreams`、`/api/upstreams/{n}/test`、`/api/toolsets`、`/api/expose`、`/api/client-presets`、`/api/keys`、`/api/calls`、`/api/add-server`，以及原样的 `/admin` 页面。
- 网关 bearer 鉴权（header / `?token=` / `mcpp_token` cookie），`clients:` 可逐 naming 关停端点。

### dsh 原生工具面（v0.2）

- 选择文档 `<DSH_HOME>/storages/mcpp/selection.json`：`{ "version": 1, "enabled": ["search/searxng_search", …] }`，**默认全关**；保存即差量注册/注销，无需重启。
- 每个被选中的工具注册一个 `ToolDefinition`：`parameters` = 变换后的 inputSchema，`execute` = 参数变换 → 上游 `tools/call`（`isError` 抛错、content 投影为文本、按上游 `read_timeout+15s` 设 `timeoutMs`）。
- 同名冲突（例如另配了 mcp-client 指向同一上游）只记入设置页的「注册失败」列表，不影响其它工具。
- 同源路由（走 dsh 宿主的 webServer，受 dsh 的浏览器信任围栏保护，不暴露网关 token）：
  - `GET /plugins/mcpp/admin` — 管理页（注入 API base / 公开 origin / token）
  - `/plugins/mcpp/api/*` — 与 9020 同一套进程内 admin handler
  - `GET /plugins/mcpp/ui/catalog`、`POST /plugins/mcpp/ui/selection`、`POST /plugins/mcpp/ui/sync`
- 浏览器半区：侧栏「MCP 网关」页签（iframe 管理页）+ 设置页「MCP 工具」分区（勾选/保存/重新同步/失败原因）。
- `ctx.mcpp` 服务：`catalog()` / `call(name, args, signal?)` / `upstreams()` / `toolsets()`；调用不要求工具被选中。

## 代码结构

```
index.mjs              bundle 入口（re-export src/plugin.ts）
src/plugin.ts          Cordis 插件：Config + apply（网关、原生工具、同源路由、ctx.mcpp 服务）
src/bootstrap.ts       composition root：读配置、建上游/密钥池、预热 stdio、reload 路径
src/server.ts          9020 的 node:http 监听：路由表、鉴权、cookie、静态 admin 页
src/gateway.ts         MCP JSON-RPC 协议层（initialize / tools/list / tools/call / …）
src/admin.ts           /api/* 全部管理接口
src/native-tools.ts    ToolDefinition 适配器 + 按 publicName 的代际差量注册
src/selection.ts       选择文档原子读写（默认全关）
src/dsh-routes.ts      /plugins/mcpp/** 同源路由（管理页 + admin API + ui API）
src/dsh.ts             dsh 宿主服务的最小本地类型（tools/webServer/connection/ctx）
src/service.ts         ctx.mcpp 服务与 catalog 构建
src/config.ts          YAML 模型、默认值、交叉校验、序列化
src/transform.ts       下游工具面与参数变换
src/upstream-http.ts   Streamable HTTP 上游（握手、session 恢复、重试一次）
src/upstream-stdio.ts  stdio 上游（两种帧、超时隔离、EOF 重生成）
src/keypool.ts         密钥轮转池
src/presets.ts         naming modes / connect modes / client 目录
src/types.ts           共享契约
src/client/            浏览器半区（侧栏页签 + 设置页分区）
static/index.html      旧服务管理页（最小改动以支持同源注入）
scripts/run-standalone.mjs  脱离 dsh 直接起网关（验证用）
scripts/parity/       与旧服务响应对齐的抓取/比较工具
test/                 node --test 单测与端到端测试
```

**零运行时依赖**：产物只 import 宿主提供的 `@deepseek-ai/schemastery`；`js-yaml` 被打进 bundle，客户端 bundle 只依赖 module table 里的 `react`。

## 构建与测试

便携 Node 24（`D:\softwares\node-v24.21.0-win-x64`）下：

```powershell
cd L:\dsh\.local-deploy\mcpp-plugin
node --test --experimental-strip-types test/*.test.mjs        # 单测 + 端到端
node ../../node_modules/tsdown/dist/run.mjs --config tsdown.config.mjs --config-loader native   # lib/index.js + lib/client.js
node L:\dsh\node_modules\typescript\bin\tsc -p tsconfig.json  # 类型检查
```

脱离 dsh 验证（候选端口 9021，不打扰 9020 上的旧服务）：

```powershell
node --experimental-strip-types scripts/run-standalone.mjs C:\Users\joe\Documents\repo\skill\mcpp\config.yaml 9021
```

与旧服务逐端点对齐：

```powershell
node scripts/parity/capture-golden.mjs                 # 从旧服务抓 golden（token 运行时读取，不落盘）
node scripts/parity/compare.mjs --candidate http://127.0.0.1:9021     # 新旧逐端点对比
node scripts/parity/verify-against-golden.mjs --candidate http://127.0.0.1:9020   # 旧服务退役后只对 golden 验证
node --experimental-strip-types scripts/verify-live.mjs --base http://127.0.0.1:9020   # 真实 tools/call
```

**已验证**（2026-11-08）：

- v0.1：207/207 单测与端到端用例通过；91 个 golden 与旧服务逐端点 **91/91 identical**；同一套检查在「插件装进 dsh 宿主」的实例上复跑同样 91/91，`verify-live` 12 项全过。
- v0.2：全量 **255/255** 测试通过（新增 24 个 native/selection + 21 个同源路由 + 3 个接线端到端）；在真实 dsh web 宿主上实测：选择往返 `POST /plugins/mcpp/ui/selection` → `registered` 出现/消失、设置页「MCP 工具」分区渲染 20 个工具、侧栏「MCP 网关」页签加载管理页、`/plugins/mcpp/*` 全部受 dsh 浏览器会话围栏保护（未登录 401）；9020 外部端点重跑 golden 仍 **91/91**。

## 打包约定（踩过的坑）

`package.json` 的 `files` **必须**包含 `cordis.patch.yml`。profile 里的 `dsh-mcpp` 是 `file:` 依赖，pnpm 会按 `files` 打成一个真实目录副本；漏掉这个文件后，下一次 profile 更新重装插件就会得到「声明了 bundle patch 但文件不存在」的副本，dsh 的启动前组合校验会直接拒绝整个 profile：

```
dsh-mcpp: declared patch ./cordis.patch.yml is missing — the profile will fail to boot
```

`test/package.test.mjs` 会守住这条（`files` 三件套 `lib` / `static` / `cordis.patch.yml` 缺一即红）。改包结构后跑一遍全量测试再交给 profile 更新流程。

## 安装

见 [INSTALL.md](./INSTALL.md)。一句话：构建 → 把 `lib/`（含 `client.js`）+ `static/` 拷进目标 profile 的 `node_modules/dsh-mcpp`，profile 的 `package.json` 加依赖与 `dsh.profile.bundles`，`cordis.patch.yml` 加一行按 id 的 `config`，重启该 dsh 端。

## 与旧服务的已知偏差

| 场景 | 旧服务 | 本插件 |
|---|---|---|
| 非法 JSON body | 500 | 400 + JSON-RPC `-32700` |
| 参数变换非法值 | 500 | JSON-RPC `-32602` |
| 未知路径 / 错误方法 | FastAPI `{"detail": ...}` 404/405 | 同左（保持一致） |
| 上游 HTTP 错误 | 透传状态码到日志、JSON-RPC `-32000` | 同左 |

其余行为按 `test/fixtures/golden/`（旧服务真实响应）与 `test/integration.test.mjs` 对齐。

