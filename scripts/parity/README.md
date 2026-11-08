# mcpp 旧服务对齐验证（golden + compare）

Python 版 mcpp 网关（`C:\Users\joe\Documents\repo\skill\mcpp`）正在被重写为 DSH 插件
（`L:\dsh\.local-deploy\mcpp-plugin`）。在新实现合入前，旧服务在 `http://127.0.0.1:9020`
上继续运行，**它是响应形状的唯一真值来源**。本目录的两个脚本负责：

1. `capture-golden.mjs` — 把旧服务对外的响应（status + 解析后的 JSON）抓成快照；
2. `compare.mjs` — 把所有快照逐条重放到旧服务与候选（新）服务，深比较响应，输出差异路径。

脚本只读取旧服务，不修改实现代码，也不写 `src/` 或测试文件。

## 目录

```
scripts/parity/
  capture-golden.mjs   抓 golden（旧服务 → test/fixtures/golden/）
  compare.mjs          旧服务 vs 候选服务 逐端点对比
  README.md            本文件
test/fixtures/golden/  抓下来的 golden（只读资产）
  admin/
    upstreams.json
    toolsets.json
    client-presets.json
    expose.json
    keys.json
  mcp/
    <toolset>/<naming>/initialize.json
    <toolset>/<naming>/tools-list.json
    legacy-mcp/initialize.json
    legacy-mcp/tools-list.json
```

当前快照：**91 个 fixture**（admin 5 + MCP 86），全部 HTTP 200，约 349 KB。
MCP 覆盖 7 个 toolset（`/api/toolsets` 动态取，含默认 toolset `mcpp`）× 6 种 naming
（`/api/client-presets` 的 `naming_modes` 动态取：`claude` `cursor` `opencode` `coder`
`codex` `default`）× `initialize`/`tools/list`，外加 legacy `POST /mcp`。

## token 从哪来

脚本运行时从旧服务配置 `C:\Users\joe\Documents\repo\skill\mcpp\config.yaml` 的顶层
`auth:` → `token:` 读取（逐行状态机，不引入 YAML 依赖；兼容引号与 `${VAR}` 环境变量引用）。
也支持 `--token <t>`、`--config <path>` 覆盖，以及环境变量 `MCPP_REFERENCE_CONFIG` /
`MCPP_TOKEN`。

**token 永不落盘**：不写入 golden、日志、报告或错误信息；脚本只打印
`<redacted, 32 chars>`。所有请求走 `Authorization: Bearer <token>`。

## 抓 golden

前置条件：旧服务在跑（`curl -s -o NUL -w "%{http_code}" http://127.0.0.1:9020/api/upstreams`
返回 401 表示在跑；200 表示网关未设 token，也继续）。

```powershell
# 在 L:\dsh\.local-deploy\mcpp-plugin 下
node scripts/parity/capture-golden.mjs
```

可选参数：`--base <url>`、`--token <t>`、`--config <path>`、`--out <dir>`、
`--timeout <ms>`（默认 120000，兼顾旧 search 上游 read_timeout=90s）。

行为约定：

- 请求**串行**发出，避免 `tools/list` 并发打爆旧服务/上游；
- 单个请求失败（网络错误或 5xx）重试 **1 次**后报错，不写半份 golden；
- toolset 列表来自 `GET /api/toolsets`，naming 列表来自 `GET /api/client-presets`，
  不硬编码；
- 每份 fixture 是固定 envelope：

  ```json
  {
    "endpoint": "/sciverse/claude/mcp",
    "method": "POST",
    "request": { "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} },
    "status": 200,
    "json": { }
  }
  ```

  `request` 让 `compare.mjs` 无需猜测请求体；响应 body 的 object key 递归排序
  （数组顺序保留），保证重新抓取时文件稳定、可 diff。

### secret 清洗（写盘前）

每份 fixture 序列化后、写盘前扫描：

- 网关 token 本体；
- 形如 `[0-9a-f]{48,}` 的长 hex 串（上游 URL 内嵌 path token 的特征）。

只要命中，**整批拒绝写入**并列出命中文件，退出码 1。这是最后一道闸门：即使旧服务
某天把 secret 回显到某个响应里，也不会进仓库。抓取成功时摘要里会打印
`secret scan: clean (N fixtures scanned)`；本次抓取的 91 个文件已额外独立复核为 0 命中。

### 为什么**不**抓 `/api/config`

`GET /api/config` 返回整份配置 YAML，其中 `upstreams[].url` 内嵌上游从 URL path 传入的
token（`.../<48+ hex>/mcp` 之类）。把它抓进 `test/fixtures/golden/` 等于把上游凭据写进
仓库，而且清洗后这份 golden 也没有对比价值（配置是由各实现自己读同一份文件的）。
因此不抓，也不把任何上游 URL 写进文件。

同样**不抓**的端点及原因：

| 端点 | 原因 |
| --- | --- |
| `GET /api/config` | 含上游 URL token（见上），且重放无意义 |
| `GET /api/calls` | 内存环形缓冲，随调用变化，非稳定契约 |
| `GET /api/upstreams/{name}/tools`、`POST /api/upstreams/{name}/test` | 直接打上游、含上游原始数据，慢且不稳定 |
| `POST/PUT/DELETE /api/*` | 有副作用（会改配置/键池），绝不能重放 |
| `/admin` 静态页 | UI 资产，不是 JSON 契约 |

## 对比

```powershell
# 候选服务必须已启动；--candidate 必填
node scripts/parity/compare.mjs --candidate http://127.0.0.1:9030
```

参数：`--base <url>`（默认 `http://127.0.0.1:9020`）、`--candidate <url>`（必填）、
`--token`/`--config`（同 capture）、`--golden <dir>`、`--concurrency <n>`（默认 4，
`--concurrency 1` 对旧服务最温和）、`--timeout <ms>`、`--verbose`（逐端点打印，含一致项）。

比较规则：

- 先比 **HTTP status**，再比 JSON；
- object **键序无关**（两侧递归规范化）；
- array **保序**；
- 数字按严格相等（`===`）；
- 值超过 300 字符截断显示。

输出内容：

- 一致端点数量 / 差异端点数量 / 总数；
- 每个不一致端点的**最小差异路径**与两边值，例如：

  ```
  mcp/academic/claude/tools-list.json  (POST /academic/claude/mcp)
    differences: 1
      tools[3].inputSchema.properties.query.type
          base      : "string"
          candidate : "number"
  ```

- 各 toolset 的工具数（base / candidate）；
- **base drift**：旧服务重放结果与录制 golden 的差异。它只作提示（旧服务可能在上游
  波动后 `tools/list` 变了），**不影响退出码**；出现时先重抓 golden，再判断候选差异
  是不是回归。

退出码：

| 码 | 含义 |
| --- | --- |
| 0 | 所有端点一致 |
| 1 | 存在响应差异 |
| 2 | 连接/鉴权/用法失败（候选或旧服务不可达、token 被拒、golden 缺失/损坏） |

不传 `--candidate` 或 URL 不可达时退出码 2，保证 CI/汇报里不会把"连不上"误判成
"有差异"或"通过"。

## 使用建议

1. 旧服务还在时**先抓**（本次快照已写入 `test/fixtures/golden/`）；
2. 候选服务起来后用 `compare.mjs` 跑全量，差异清单直接贴进汇报；
3. 若旧服务配置/上游可用性发生变化（`base drift` 非 0），重抓 golden 后再比；
4. 重抓会覆盖同名 fixture，但不删除已不存在的 toolset 旧目录；toolset 集合变化后
   请手动清理 `test/fixtures/golden/mcp/` 下多余目录，避免对比旧端点。

## 局限

- golden 是**某一时刻**的快照：`tools/list` 依赖上游可用性（某上游超时/失败时旧服务
  会静默少返回工具），`/api/keys` 含运行时的 `paused`/`healthy_count` 状态；
- 对比同时打旧服务与候选服务，两者各自再 fan-out 到 11 个上游；默认并发 4，必要时
  降到 1；
- 本目录脚本只读，不参与新实现的行为；新实现的单元测试仍应覆盖各自模块。
