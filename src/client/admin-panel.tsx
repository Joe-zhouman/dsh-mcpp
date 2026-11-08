/**
 * 侧栏「MCP 网关」页签的 body：一个占满容器的 iframe，指向宿主半区提供的
 * 同源管理页 `/plugins/mcpp/admin`。
 *
 * 页面交互全部发生在 iframe 内（管理页自己按需请求 admin API），所以这里的
 * 组件不需要轮询，也不需要响应 `visible`：切走页签时 iframe 保持原样即可。
 */
import type { SidebarTabComponentProps } from './types.ts'

/** 侧栏页签 body。 */
export function McppAdminPanel(_props: SidebarTabComponentProps) {
  return (
    <div className="mcpp-frame-wrap">
      <iframe
        className="mcpp-frame"
        src="/plugins/mcpp/admin"
        title="MCP 网关管理"
      />
    </div>
  )
}
