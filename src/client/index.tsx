/**
 * dsh-mcpp 的浏览器半区入口：安装样式表，然后分别等待 `betterSidebar`
 * （侧栏「MCP 网关」页签）与 `slots`（设置页「MCP 工具」分区）两个可选服务，
 * 出现后再注册对应界面。
 *
 * 两个服务都不写进静态 `inject`：better-sidebar 是可选第三方插件，缺失时
 * 必须安静跳过；`slots` 由客户端 shell 在启动过程中提供，可能晚于本插件
 * 挂载。`ctx.inject` 会一直等到服务可用，服务缺失时回调不执行也不会抛错。
 */
import type { ReactNode } from 'react'
import { McppAdminPanel } from './admin-panel.tsx'
import { injectStylesheet } from './styles.ts'
import { McppToolsSection } from './tools-section.tsx'
import type { ClientCtx, SidebarTabDescriptor } from './types.ts'

/** 侧栏页签类型 id；与设置页分区 id 一起构成本包的两个界面标识。 */
const TAB_ID = 'mcpp:admin'

/** 设置页「MCP 工具」分区 id（独立 id 把本分区加在内置分区旁边）。 */
const SECTION_ID = 'mcpp'

/** 页签图标：三个节点连成的聚合网关示意。 */
function gatewayIcon(size: number): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2.6 8h10.8" />
      <circle cx="2.6" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13.4" cy="8" r="1.5" />
    </svg>
  )
}

/**
 * 插件入口。
 * @param ctx - 客户端 Cordis 上下文。
 */
export function apply(ctx: ClientCtx): void {
  ctx.effect(() => injectStylesheet(), 'dsh-mcpp: stylesheet')

  // 侧栏页签：better-sidebar 的服务出现后注册；没有装该插件时不注册任何东西。
  ctx.inject(['betterSidebar'], scope => {
    const betterSidebar = scope.get('betterSidebar')
    if (betterSidebar === undefined) return
    const tab: SidebarTabDescriptor = {
      id: TAB_ID,
      title: 'MCP 网关',
      description: '聚合工具与网关管理',
      icon: size => gatewayIcon(size),
      order: 45,
      single: true,
      component: McppAdminPanel,
    }
    scope.effect(() => betterSidebar.registerTab(tab), 'dsh-mcpp: sidebar tab')
  })

  // 设置页分区：等 slots 服务可用、且 settings.section 槽被声明后再注册。
  ctx.inject(['slots'], scope => {
    const slots = scope.get('slots')
    if (slots === undefined) return
    scope.effect(() => slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: SECTION_ID, order: 45, label: () => 'MCP 工具' },
      McppToolsSection,
    )), 'dsh-mcpp: settings section')
  })
}
