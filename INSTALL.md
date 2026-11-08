# INSTALL — dsh-mcpp 装机 / 验证 / 回滚

以共享 home `L:\dsh\.dsh-home`、桌面端 profile `desktop` 为例。**目标端由 dsh 宿主托管网关，旧 Python 服务不再单独运行。**

一键脚本（需要不受 dsh 沙箱限制的 shell）：

```powershell
# 装进桌面端 profile（含构建），并停用旧 Python 自启、停掉独立服务
pwsh -NoProfile -File L:\dsh\.local-deploy\install-mcpp-gateway.ps1 `
  -Profile desktop -Build -DisablePythonAutostart -StopStandaloneService

# 只更新代码（已装过，改了 src 后）
pwsh -NoProfile -File L:\dsh\.local-deploy\install-mcpp-gateway.ps1 -Profile desktop -Build

# 卸载（移除 profile 里的插件与配置；可选恢复 Python 自启）
pwsh -NoProfile -File L:\dsh\.local-deploy\install-mcpp-gateway.ps1 -Profile desktop -Action uninstall
```

脚本做四件事：构建 → 复制到 `<profile>/node_modules/dsh-mcpp` → profile `package.json` 的 `dependencies` 加 `dsh-mcpp` → `cordis.patch.yml` 末尾插入 `mcpp` 行（`- insert:` 形式，不占用 `dsh.profile.bundles`）。改 `package.json` 前会留 `.bak-pre-mcpp-<时间戳>`。

> **必须重启宿主才会加载新插件行**：实测（0.2.2-rc.1 桌面端）改 profile 补丁后 HMR 不会新增插件行，30 秒内 9020 仍无监听。桌面端用 `.local-deploy\switch-mcpp-to-desktop.cmd` 一键重启并验收。

## 手工步骤（脚本不可用时）

1. 构建：`node ../../node_modules/tsdown/dist/run.mjs --config tsdown.config.mjs --config-loader native`
2. 复制 `package.json`、`lib/`、`static/` 到 `L:\dsh\.dsh-home\profiles\desktop\node_modules\dsh-mcpp\`
3. `profiles\desktop\package.json` 的 `dependencies` 加 `"dsh-mcpp": "file:L:/dsh/.local-deploy/mcpp-plugin"`（loader 的解析清单；**不要**加进 `dsh.profile.bundles`，行由第 4 步直接插入）
4. `profiles\desktop\cordis.patch.yml` 末尾追加：

   ```yaml
   # dsh-mcpp：由 dsh 宿主托管原 mcpp 网关。
   - insert:
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

1. 启动日志（桌面端 stderr / `start-web.cmd` 的 server.log）出现：
   `mcpp gateway listening at http://127.0.0.1:9020 (config: … , 12 upstreams)`
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

4. 用真实 MCP 客户端（Claude Code / Cursor）确认工具列表与调用正常；或跑对齐脚本：

   ```powershell
   node scripts/parity/compare.mjs --candidate http://127.0.0.1:9020
   ```

5. 浏览器打开 `http://127.0.0.1:9020/admin?token=$T`，确认管理页可读、上游测试/密钥池/调用记录可用。

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
| 工具少了一批 | 上游自己的问题：`POST /api/upstreams/<name>/test` 看 `tool_count`；stdio 上游还要确认命令路径。 |
| 改了 mcpp 的 `config.yaml` 但网关没变 | 网关只在启动时读一次；改完用 `/admin` 保存（走 reload）或重启 dsh。 |
