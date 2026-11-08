# INSTALL — dsh-mcpp 装机 / 验证 / 回滚

以共享 home `L:\dsh\.dsh-home`、桌面端 profile `desktop` 为例。**目标端由 dsh 宿主托管网关，旧 Python 服务不再单独运行。**

插件 v0.2 起带浏览器半区（侧栏页签 + 设置页分区），因此以 **bundle** 形式安装：`dsh.profile.bundles` 提供插件行（插件自带的 `cordis.patch.yml` 负责 insert），profile 补丁只按 id 覆盖配置。

一键脚本（需要不受 dsh 沙箱限制的 shell）：

```powershell
# 装进桌面端 profile（含构建），并停用旧 Python 自启、停掉独立服务
pwsh -NoProfile -File L:\dsh\.local-deploy\install-mcpp-gateway.ps1 `
  -Profile desktop -Build -DisablePythonAutostart -StopStandaloneService

# 只更新代码（已装过，改了 src 后重跑；会覆盖 profile 里的副本）
pwsh -NoProfile -File L:\dsh\.local-deploy\install-mcpp-gateway.ps1 -Profile desktop -Build

# 卸载（移除 profile 里的插件、依赖、bundle 项与配置行；可选恢复 Python 自启）
pwsh -NoProfile -File L:\dsh\.local-deploy\install-mcpp-gateway.ps1 -Profile desktop -Action uninstall
```

脚本做四件事：构建（host + client 两遍，缺 `lib/client.js` 会失败）→ 复制到 `<profile>/node_modules/dsh-mcpp` → profile `package.json` 加依赖并追加 `dsh.profile.bundles` → `cordis.patch.yml` 写入按 id 的 `mcpp` 配置行（会先剥掉旧版本用 `- insert:` 写的块）。改 `package.json` 前会留 `.bak-pre-mcpp-<时间戳>`。

> **必须重启宿主才会加载新插件行与客户端 bundle**：实测（0.2.2-rc.1 桌面端）改 profile 补丁后 HMR 不会新增插件行，30 秒内 9020 仍无监听。桌面端用 `.local-deploy\switch-mcpp-to-desktop.cmd` 一键重启并验收。

## 手工步骤（脚本不可用时）

1. 构建：`node ../../node_modules/tsdown/dist/run.mjs --config tsdown.config.mjs --config-loader native`（必须产出 `lib/index.js` 与 `lib/client.js`）
2. 复制 `package.json`、`cordis.patch.yml`、`lib/`、`static/` 到 `L:\dsh\.dsh-home\profiles\desktop\node_modules\dsh-mcpp\`
3. `profiles\desktop\package.json`：
   - `dependencies` 加 `"dsh-mcpp": "file:L:/dsh/.local-deploy/mcpp-plugin"`
   - `dsh.profile.bundles` 追加 `"dsh-mcpp"`（bundle 补丁负责插入插件行）
4. `profiles\desktop\cordis.patch.yml` 末尾追加（只覆盖配置，不 insert）：

   ```yaml
   # dsh-mcpp：由 dsh 宿主托管原 mcpp 网关；插件行由 bundle 补丁插入。
   - id: mcpp
     name: dsh-mcpp
     config:
       configPath: C:/Users/joe/Documents/repo/skill/mcpp/config.yaml
       host: 127.0.0.1
       port: 9020
   ```

5. 彻底退出桌面端（含托盘），再从 `L:\dsh\.local-deploy\start-desktop.cmd` 启动。

> **不要**用 `pnpm add` 装这个包：桌面 profile 由 Electron 独占，且 `file:` 安装会建符号链接；直接拷目录是这条部署链的既有做法（见 deployment.md §18）。

## 验证

### 1. 网关（9020 外部端点）

1. 启动日志（桌面端 stderr / `start-web.cmd` 的 server.log）出现：
   `mcpp gateway listening at http://127.0.0.1:9020 (config: … , 11 upstreams)`
2. 无 token 应 401：

   ```powershell
   curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:9020/api/upstreams   # 401
   ```

3. 带 token 取上游名单与工具集（token 在 `config.yaml` 的 `auth.token`）：

   ```powershell
   $T = (Select-String -Path C:\Users\joe\Documents\repo\skill\mcpp\config.yaml -Pattern '^\s+token:\s*(\S+)').Matches[0].Groups[1].Value
   curl.exe -s -H "Authorization: Bearer $T" http://127.0.0.1:9020/api/upstreams
   curl.exe -s -H "Authorization: Bearer $T" "http://127.0.0.1:9020/api/tools?toolset=search&client=claude"
   ```

4. 与 golden 对齐（旧服务退役后可离线验证）：

   ```powershell
   node scripts/parity/verify-against-golden.mjs --candidate http://127.0.0.1:9020
   node --experimental-strip-types scripts/verify-live.mjs --base http://127.0.0.1:9020
   ```

### 2. dsh 原生工具面 / 侧栏 / 设置页

1. **侧栏**：打开右侧栏（或底部工作台）的「MCP 网关」页签 → 管理页（`mcpp Admin`，顶部显示「Auth: 通过 dsh 会话鉴权」）。
2. **设置页**：账号菜单 → 设置（Ctrl+Alt+,）→ 左侧「MCP 工具」→ 显示网关状态、11 个上游、toolset 分组与 20 个工具、「已选 0 / 20 个工具」「当前已注册 0 个工具」。
3. **选择生效**：勾选 1–2 个工具 → 保存 → 「当前已注册」出现 `mcp__<toolset>__<tool>`；回到会话里模型即可直接调用（工具名形如 `mcp__search__searxng`）。取消勾选后立即消失。
4. **服务**：其他插件 `inject: ['mcpp']` 或 `ctx.get('mcpp')` 后可用 `catalog()/call()/upstreams()/toolsets()`（调用不要求工具被选中）。
5. 选择文档落在 `<DSH_HOME>/storages/mcpp/selection.json`；删掉它即回到「默认全关」。

## 回滚

```powershell
pwsh -NoProfile -File L:\dsh\.local-deploy\install-mcpp-gateway.ps1 -Profile desktop -Action uninstall
# 恢复 Python 自启：把 archived\mcpp-gateway.vbs.disabled 移回 Startup 目录
# 启动旧服务：双击 startup 里的 mcpp-gateway.vbs，或 cd C:\Users\joe\Documents\repo\skill\mcpp; .venv\Scripts\mcpp.exe
```

profile 的 `package.json` 与 `cordis.patch.yml` 都有 `.bak-pre-mcpp-*` 备份可回退。

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 启动报 `EADDRINUSE 127.0.0.1:9020` | 旧 Python mcpp 还在跑（或另一个 dsh 实例托管着）。停掉其一：`Get-NetTCPConnection -LocalPort 9020` 找 PID。 |
| 启动报 `ConfigError: ...` | `configPath` 指向的文件不存在或被改坏；先用 `node scripts/run-standalone.mjs <path>` 单独复现。 |
| 插件没加载 | 检查 profile `package.json` 的 `dsh.profile.bundles` 是否含 `dsh-mcpp`、`cordis.patch.yml` 是否有 `- id: mcpp` 行、`node_modules/dsh-mcpp/lib/index.js` 是否存在。 |
| 更新插件/其它插件时报 `dsh-mcpp: declared patch ./cordis.patch.yml is missing — the profile will fail to boot` | pnpm 按 `files` 打包 `file:` 依赖，安装副本里缺 `cordis.patch.yml`。已在 `package.json` 的 `files` 里补上（v0.2.1）；修复办法是重跑本页的一键安装（会重新物化副本），再用 `node .local-deploy/tools/check-profile-bundles.mjs` 校验。 |
| 设置页没有「MCP 工具」 | `settings.section` 槽未声明（打开过一次设置页后才会注册）或客户端 bundle 未加载；确认 `lib/client.js` 在 profile 副本里、且重启过应用。 |
| 侧栏没有「MCP 网关」 | 该 profile 没装 `dsh-better-sidebar`（缺失时插件安静跳过）；或客户端 bundle 未加载。 |
| 工具注册失败列表非空 | 同名冲突（另配了 mcp-client 指向同一上游）或上游不可用；`mcp__` 前缀相同即算冲突。 |
| 工具少了一批 | 上游自己的问题：`POST /api/upstreams/<name>/test` 看 `tool_count`；stdio 上游还要确认命令路径。 |
| 改了 mcpp 的 `config.yaml` 但网关没变 | 网关只在启动时读一次；改完用 `/admin` 保存（走 reload）或重启 dsh。 |

