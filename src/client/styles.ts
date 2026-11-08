/**
 * 浏览器半区的样式表：一个 CSS 字符串、一个 `<style>` 标签。
 *
 * 构建没有配置 CSS Modules，页面样式统一走这里的前缀类名；颜色/边框跟随
 * dsh 的 alias token，并给每个 token 带字面量兜底，深浅主题都能渲染。
 */

/** 这个插件唯一样式标签的 id（`style[data-plugin-css]` 的取值）。 */
const STYLE_TAG_ID = 'dsh-mcpp/styles'

/** 样式标签上的插件名标记。 */
const PLUGIN_ID = 'dsh-mcpp'

/** 全部样式；两个界面共用一套前缀类名。 */
export const STYLESHEET = `
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
`

/**
 * 安装本插件的样式标签；已存在时直接返回，重复激活只保留一个标签。
 * @returns 移除本插件标签的清理函数（交给 `ctx.effect`）。
 */
export function injectStylesheet(): () => void {
  if (typeof document === 'undefined') return () => undefined
  if (document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return () => undefined
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = STYLESHEET
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
