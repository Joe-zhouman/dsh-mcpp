window.__ModuleLoader__.load({
	id: "dsh-mcpp",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		//#region src/client/admin-panel.tsx
		/** 侧栏页签 body。 */
		function McppAdminPanel(_props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "mcpp-frame-wrap",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
					className: "mcpp-frame",
					src: "/plugins/mcpp/admin",
					title: "MCP 网关管理"
				})
			});
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* 浏览器半区的样式表：一个 CSS 字符串、一个 `<style>` 标签。
		*
		* 构建没有配置 CSS Modules，页面样式统一走这里的前缀类名；颜色/边框跟随
		* dsh 的 alias token，并给每个 token 带字面量兜底，深浅主题都能渲染。
		*/
		/** 这个插件唯一样式标签的 id（`style[data-plugin-css]` 的取值）。 */
		const STYLE_TAG_ID = "dsh-mcpp/styles";
		/** 样式标签上的插件名标记。 */
		const PLUGIN_ID = "dsh-mcpp";
		/** 全部样式；两个界面共用一套前缀类名。 */
		const STYLESHEET = `
/* ── 侧栏「MCP 网关」：占满容器的 iframe ───────────────────────────── */
.mcpp-frame-wrap {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  background: var(--dsw-alias-bg-base, transparent);
}
.mcpp-frame {
  display: block;
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  border: 0;
  background: var(--dsw-alias-bg-base, transparent);
}

/* ── 设置页「MCP 工具」────────────────────────────────────────────── */
.mcpp-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 2px 2px 24px;
  color: var(--dsw-alias-label-primary, #1f2328);
  font-size: var(--dsh-content-font-size, 13px);
  line-height: 1.55;
}
.mcpp-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mcpp-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.mcpp-hint {
  margin: 0;
  color: var(--dsw-alias-label-secondary, #6b6b76);
  font-size: 12px;
}
.mcpp-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mcpp-chip {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 140, 0.12));
  color: var(--dsw-alias-label-secondary, #6b6b76);
  font-size: 11px;
  white-space: nowrap;
}

.mcpp-notice {
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 140, 0.3));
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 140, 0.06));
  font-size: 12px;
}
.mcpp-notice-error {
  border-color: var(--dsw-alias-state-error-primary, #c0392b);
  color: var(--dsw-alias-state-error-primary, #c0392b);
}
.mcpp-muted {
  color: var(--dsw-alias-label-secondary, #6b6b76);
  font-size: 12px;
}
.mcpp-empty {
  padding: 10px 12px;
  border: 1px dashed var(--dsw-alias-border-l1, rgba(128, 128, 140, 0.35));
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary, #6b6b76);
  font-size: 12px;
}

.mcpp-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.mcpp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 140, 0.35));
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, #1f2328);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.mcpp-btn:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 140, 0.12));
}
.mcpp-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.mcpp-btn-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #3a6df0));
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
}
.mcpp-btn-primary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary, #3a6df0));
}

.mcpp-toolset {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 140, 0.3));
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  overflow: hidden;
}
.mcpp-toolset-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 140, 0.08));
  cursor: pointer;
  user-select: none;
}
.mcpp-toolset-name {
  font-weight: 600;
  font-size: 13px;
}
.mcpp-tag {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 5px;
  background: var(--dsw-alias-bg-base, rgba(128, 128, 140, 0.16));
  color: var(--dsw-alias-label-secondary, #6b6b76);
  font-size: 11px;
}
.mcpp-tools {
  display: flex;
  flex-direction: column;
}
.mcpp-tool {
  display: grid;
  grid-template-columns: 18px minmax(140px, 220px) minmax(120px, 1fr) minmax(160px, 2fr);
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 140, 0.2));
  cursor: pointer;
}
.mcpp-tool:hover {
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 140, 0.06));
}
.mcpp-check {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--dsw-alias-brand-primary, #3a6df0);
  cursor: pointer;
}
.mcpp-tool-name {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mcpp-tool-key {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #6b6b76);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mcpp-tool-desc {
  color: var(--dsw-alias-label-secondary, #6b6b76);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcpp-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 2px;
}
.mcpp-details summary {
  cursor: pointer;
  color: var(--dsw-alias-label-secondary, #6b6b76);
  font-size: 12px;
}
.mcpp-name-list {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mcpp-name-list code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #6b6b76);
  word-break: break-all;
}

.mcpp-errors {
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-state-error-primary, #c0392b);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, transparent);
}
.mcpp-errors-title {
  color: var(--dsw-alias-state-error-primary, #c0392b);
  font-size: 12px;
  font-weight: 600;
}
.mcpp-error-list {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mcpp-error-list li {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
}
.mcpp-error-list code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-primary, #1f2328);
  word-break: break-all;
}
.mcpp-error-list span {
  color: var(--dsw-alias-label-secondary, #6b6b76);
}

@media (max-width: 640px) {
  .mcpp-tool {
    grid-template-columns: 18px 1fr;
    row-gap: 2px;
  }
  .mcpp-tool-key,
  .mcpp-tool-desc {
    grid-column: 2;
  }
}
`;
		/**
		* 安装本插件的样式标签；已存在时直接返回，重复激活只保留一个标签。
		* @returns 移除本插件标签的清理函数（交给 `ctx.effect`）。
		*/
		function injectStylesheet() {
			if (typeof document === "undefined") return () => void 0;
			if (document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return () => void 0;
			const tag = document.createElement("style");
			tag.dataset.plugin = PLUGIN_ID;
			tag.dataset.pluginCss = STYLE_TAG_ID;
			tag.textContent = STYLESHEET;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}
		//#endregion
		//#region src/client/tools-section.tsx
		/**
		* 设置页「MCP 工具」分区：拉取工具目录，按 toolset 分组勾选要注册给主
		* agent 的工具，保存选择，并可手动触发一次重新同步。
		*
		* 全部数据来自宿主半区的同源路由（`/plugins/mcpp/ui/*`）。本组件不缓存
		* 选择结果：保存/同步成功后重新拉取目录，用其中的 `registered` 与 `errors`
		* 刷新「已注册数量」和「注册失败项」（同名冲突就出现在这里）。
		*/
		/** 工具目录：选择文档 + 已注册工具 + 最近一次注册失败项。 */
		const CATALOG_URL = "/plugins/mcpp/ui/catalog";
		/** 保存选择：body `{ enabled: string[] }`。 */
		const SELECTION_URL = "/plugins/mcpp/ui/selection";
		/** 手动重新同步（按当前选择文档重新注册）。 */
		const SYNC_URL = "/plugins/mcpp/ui/sync";
		/** 判断一个 JSON 值是不是普通对象。 */
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		/** 从 JSON 值里取出对象数组，丢弃非对象项。 */
		function asRecordArray(value) {
			if (!Array.isArray(value)) return [];
			const records = [];
			for (const entry of value) if (isRecord(entry)) records.push(entry);
			return records;
		}
		/** 读取字符串字段；缺失或类型不符时给空串。 */
		function asString(value) {
			return typeof value === "string" ? value : "";
		}
		/** 读取 `=== true` 的布尔字段。 */
		function asBoolean(value) {
			return value === true;
		}
		/** 读取字符串数组，丢弃非字符串项。 */
		function asStringList(value) {
			if (!Array.isArray(value)) return [];
			const list = [];
			for (const entry of value) if (typeof entry === "string") list.push(entry);
			return list;
		}
		/** 解析注册失败项数组。 */
		function asErrors(value) {
			const errors = [];
			for (const entry of asRecordArray(value)) {
				const name = asString(entry.name);
				const message = asString(entry.message);
				if (name !== "" || message !== "") errors.push({
					name,
					message
				});
			}
			return errors;
		}
		/** 取响应信封里的 error 文案。 */
		function errorText(payload) {
			if (!isRecord(payload)) return void 0;
			const message = payload.error;
			return typeof message === "string" && message !== "" ? message : void 0;
		}
		/** 读取响应体；非 JSON（例如网关返回的 HTML 错误页）当作没有 body。 */
		async function readBody(response) {
			const text = await response.text();
			if (text === "") return void 0;
			try {
				return JSON.parse(text);
			} catch {
				return;
			}
		}
		/** 发一个同源请求并解出 JSON；非 2xx 用响应里的 error 文案抛错。 */
		async function request(url, method, body) {
			const init = body === void 0 ? { method } : {
				method,
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			};
			const response = await fetch(url, init);
			const payload = await readBody(response);
			if (!response.ok) throw new Error(errorText(payload) ?? `HTTP ${String(response.status)}`);
			return payload;
		}
		/** 解析 `GET /plugins/mcpp/ui/catalog` 的响应。 */
		function parseCatalog(payload) {
			if (!isRecord(payload)) throw new Error("工具目录响应不是 JSON 对象");
			const toolsets = [];
			for (const entry of asRecordArray(payload.toolsets)) {
				const tools = asRecordArray(entry.tools).map((tool) => ({
					key: asString(tool.key),
					name: asString(tool.name),
					description: asString(tool.description),
					enabled: asBoolean(tool.enabled)
				})).filter((tool) => tool.key !== "").map((tool) => ({
					...tool,
					name: tool.name === "" ? tool.key : tool.name
				}));
				toolsets.push({
					name: asString(entry.name),
					default: asBoolean(entry.default),
					tools
				});
			}
			return {
				serverName: asString(payload.serverName),
				publicOrigin: asString(payload.publicOrigin),
				toolsets,
				registered: asStringList(payload.registered),
				errors: asErrors(payload.errors),
				upstreams: asRecordArray(payload.upstreams).map((entry) => ({
					name: asString(entry.name),
					transport: asString(entry.transport)
				}))
			};
		}
		/** 解析保存/同步响应；`{ok:false}` 信封转成异常。 */
		function parseSyncResult(payload) {
			if (!isRecord(payload)) throw new Error("同步响应不是 JSON 对象");
			if (!asBoolean(payload.ok)) throw new Error(asString(payload.error) || "同步请求被拒绝");
			return {
				registered: asStringList(payload.registered),
				errors: asErrors(payload.errors)
			};
		}
		/** 把任意异常转成可展示文案。 */
		function messageOf(failure) {
			return failure instanceof Error ? failure.message : String(failure);
		}
		/** catalog 的 `enabled` 字段还原成本地勾选集合。 */
		function enabledKeysOf(catalog) {
			const keys = /* @__PURE__ */ new Set();
			for (const toolset of catalog.toolsets) for (const tool of toolset.tools) if (tool.enabled) keys.add(tool.key);
			return keys;
		}
		/** 按 catalog 的稳定顺序收集被勾选的稳定 key。 */
		function selectedKeys(toolsets, enabled) {
			const keys = [];
			for (const toolset of toolsets) for (const tool of toolset.tools) if (enabled.has(tool.key)) keys.push(tool.key);
			return keys;
		}
		/** 写操作的结果提示：注册数量 + 失败项数量（明细由 errors 区块展示）。 */
		function registrationNotice(prefix, result) {
			const registered = `已注册 ${String(result.registered.length)} 个工具`;
			if (result.errors.length === 0) return {
				tone: "ok",
				text: `${prefix}：${registered}`
			};
			return {
				tone: "error",
				text: `${prefix}：${registered}，${String(result.errors.length)} 项注册失败`
			};
		}
		/** 设置页「MCP 工具」分区。 */
		function McppToolsSection() {
			const [phase, setPhase] = (0, react.useState)("loading");
			const [loadError, setLoadError] = (0, react.useState)("");
			const [catalog, setCatalog] = (0, react.useState)(void 0);
			const [enabled, setEnabled] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [busy, setBusy] = (0, react.useState)(void 0);
			const [notice, setNotice] = (0, react.useState)(void 0);
			/** 组件卸载后丢弃在途请求的结果。 */
			const alive = (0, react.useRef)(true);
			/** 拉取工具目录；卸载后不落状态。 */
			const loadCatalog = async () => {
				try {
					const next = parseCatalog(await request(CATALOG_URL, "GET"));
					if (!alive.current) return;
					setCatalog(next);
					setEnabled(enabledKeysOf(next));
					setPhase("ready");
					setLoadError("");
				} catch (failure) {
					if (!alive.current) return;
					setPhase("error");
					setLoadError(messageOf(failure));
				}
			};
			(0, react.useEffect)(() => {
				alive.current = true;
				loadCatalog();
				return () => {
					alive.current = false;
				};
			}, []);
			/** 切换一个工具的勾选状态。 */
			const toggleTool = (key, checked) => {
				setEnabled((previous) => {
					const next = new Set(previous);
					if (checked) next.add(key);
					else next.delete(key);
					return next;
				});
			};
			/** toolset 行三态复选框：全选/全不选该组工具。 */
			const toggleToolset = (toolset, checked) => {
				setEnabled((previous) => {
					const next = new Set(previous);
					for (const tool of toolset.tools) if (checked) next.add(tool.key);
					else next.delete(tool.key);
					return next;
				});
			};
			/** 保存选择或重新同步，然后刷新目录并给出结果提示。 */
			const run = async (action) => {
				if (busy !== void 0 || catalog === void 0) return;
				setBusy(action);
				setNotice(void 0);
				try {
					const payload = action === "save" ? await request(SELECTION_URL, "POST", { enabled: selectedKeys(catalog.toolsets, enabled) }) : await request(SYNC_URL, "POST");
					setNotice(registrationNotice(action === "save" ? "已保存" : "已同步", parseSyncResult(payload)));
					await loadCatalog();
				} catch (failure) {
					setNotice({
						tone: "error",
						text: `${action === "save" ? "保存" : "同步"}失败：${messageOf(failure)}`
					});
				} finally {
					if (alive.current) setBusy(void 0);
				}
			};
			const toolsets = catalog?.toolsets ?? [];
			const tools = toolsets.flatMap((toolset) => toolset.tools);
			const selectedCount = tools.filter((tool) => enabled.has(tool.key)).length;
			const dirty = catalog !== void 0 && tools.some((tool) => tool.enabled !== enabled.has(tool.key));
			const errors = catalog?.errors ?? [];
			const working = busy !== void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "mcpp-section",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "mcpp-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: "mcpp-title",
							children: "MCP 工具"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "mcpp-hint",
							children: "勾选要通过 mcpp 网关注册给主 agent 的工具；保存后按选择重新注册（默认全部不选）。"
						})]
					}),
					catalog === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mcpp-meta",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "mcpp-chip",
								children: ["网关 ", catalog.serverName === "" ? "mcpp" : catalog.serverName]
							}),
							catalog.publicOrigin === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "mcpp-chip",
								children: catalog.publicOrigin
							}),
							catalog.upstreams.map((upstream) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "mcpp-chip",
								children: [
									upstream.name,
									" · ",
									upstream.transport
								]
							}, upstream.name))
						]
					}),
					notice === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: notice.tone === "ok" ? "mcpp-notice" : "mcpp-notice mcpp-notice-error",
						role: "status",
						children: notice.text
					}),
					phase === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "mcpp-muted",
						children: "正在加载工具目录…"
					}) : null,
					phase === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "mcpp-notice mcpp-notice-error",
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["加载工具目录失败：", loadError] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "mcpp-toolbar",
							style: { marginTop: 8 },
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mcpp-btn",
								onClick: () => {
									loadCatalog();
								},
								children: "重试"
							})
						})]
					}) : null,
					phase === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "mcpp-toolbar",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "mcpp-btn mcpp-btn-primary",
									disabled: working,
									onClick: () => {
										run("save");
									},
									children: busy === "save" ? "保存中…" : "保存"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "mcpp-btn",
									disabled: working,
									onClick: () => {
										run("sync");
									},
									children: busy === "sync" ? "同步中…" : "重新同步"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "mcpp-muted",
									children: [
										"已选 ",
										selectedCount,
										" / ",
										tools.length,
										" 个工具",
										dirty ? "（有未保存的更改）" : ""
									]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "mcpp-muted",
							children: [
								"当前已注册 ",
								catalog === void 0 ? 0 : catalog.registered.length,
								" 个工具"
							]
						}),
						toolsets.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "mcpp-empty",
							children: "目前没有可注册的工具：上游可能未连接，或者配置里没有可暴露的 expose 条目。"
						}) : toolsets.map((toolset) => {
							const selected = toolset.tools.filter((tool) => enabled.has(tool.key)).length;
							const all = toolset.tools.length > 0 && selected === toolset.tools.length;
							const partial = selected > 0 && !all;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "mcpp-toolset",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "mcpp-toolset-head",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "mcpp-check",
											type: "checkbox",
											checked: all,
											"aria-label": `全选 ${toolset.name}`,
											ref: (element) => {
												if (element !== null) element.indeterminate = partial;
											},
											onChange: (event) => {
												toggleToolset(toolset, event.currentTarget.checked);
											}
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "mcpp-toolset-name",
											children: toolset.name
										}),
										toolset.default ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "mcpp-tag",
											children: "默认"
										}) : null,
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "mcpp-muted",
											children: [
												selected,
												" / ",
												toolset.tools.length
											]
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "mcpp-tools",
									children: toolset.tools.map((tool) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: "mcpp-tool",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "mcpp-check",
												type: "checkbox",
												checked: enabled.has(tool.key),
												"aria-label": tool.name,
												onChange: (event) => {
													toggleTool(tool.key, event.currentTarget.checked);
												}
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "mcpp-tool-name",
												title: tool.name,
												children: tool.name
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
												className: "mcpp-tool-key",
												title: tool.key,
												children: tool.key
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "mcpp-tool-desc",
												title: tool.description,
												children: tool.description
											})
										]
									}, tool.key))
								})]
							}, toolset.name);
						}),
						catalog !== void 0 && catalog.registered.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
							className: "mcpp-details",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [
								"查看已注册的工具名（",
								catalog.registered.length,
								"）"
							] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: "mcpp-name-list",
								children: catalog.registered.map((name) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: name }) }, name))
							})]
						}) : null,
						errors.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "mcpp-errors",
							role: "alert",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "mcpp-errors-title",
								children: [
									"注册失败 ",
									errors.length,
									" 项（同名工具会被主 agent 拒绝，例如与 mcp-client 的公开名冲突）"
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: "mcpp-error-list",
								children: errors.map((error, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: error.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: error.message })] }, `${error.name}#${String(index)}`))
							})]
						})
					] }) : null
				]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		/** 侧栏页签类型 id；与设置页分区 id 一起构成本包的两个界面标识。 */
		const TAB_ID = "mcpp:admin";
		/** 设置页「MCP 工具」分区 id（独立 id 把本分区加在内置分区旁边）。 */
		const SECTION_ID = "mcpp";
		/** 页签图标：三个节点连成的聚合网关示意。 */
		function gatewayIcon(size) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M2.6 8h10.8" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "2.6",
						cy: "8",
						r: "1.5"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "8",
						cy: "8",
						r: "1.5"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "13.4",
						cy: "8",
						r: "1.5"
					})
				]
			});
		}
		/**
		* 插件入口。
		* @param ctx - 客户端 Cordis 上下文。
		*/
		function apply(ctx) {
			ctx.effect(() => injectStylesheet(), "dsh-mcpp: stylesheet");
			ctx.inject(["betterSidebar"], (scope) => {
				const betterSidebar = scope.get("betterSidebar");
				if (betterSidebar === void 0) return;
				const tab = {
					id: TAB_ID,
					title: "MCP 网关",
					description: "聚合工具与网关管理",
					icon: (size) => gatewayIcon(size),
					order: 45,
					single: true,
					component: McppAdminPanel
				};
				scope.effect(() => betterSidebar.registerTab(tab), "dsh-mcpp: sidebar tab");
			});
			ctx.inject(["slots"], (scope) => {
				const slots = scope.get("slots");
				if (slots === void 0) return;
				scope.effect(() => slots.inject("settings.section", () => slots.register({
					name: "settings.section",
					id: SECTION_ID,
					order: 45,
					label: () => "MCP 工具"
				}, McppToolsSection)), "dsh-mcpp: settings section");
			});
		}
		//#endregion
		exports.apply = apply;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map