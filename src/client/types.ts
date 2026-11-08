/**
 * 浏览器半区的最小本地类型：本插件实际调用的 Cordis 服务面，以及宿主半区
 * `/plugins/mcpp/ui/*` 路由的数据形状。
 *
 * 客户端 bundle 只能从 module table 取到 `react`，因此 dsh 的服务类型不能从
 * `@deepseek-ai/*` 导入；这里按运行时的真实签名手写消费面，`ctx.get` /
 * `ctx.inject` 的缺失情况由调用方逐个判空。
 */
import type { ReactNode } from 'react'

/** `ctx.effect` 面：注册一个随插件 fiber 释放的清理函数。 */
export type EffectFn = (factory: () => (() => void) | void, name?: string) => () => void

/** better-sidebar 传给页签 body 的 props 子集；iframe 页不使用它。 */
export interface SidebarTabComponentProps {
  /** 页签是否可见；纯 iframe 页无需据此暂停任何工作。 */
  readonly visible?: boolean
}

/** 一个侧栏页签注册（`betterSidebar.registerTab` 的入参子集）。 */
export interface SidebarTabDescriptor {
  /** 页签类型 id；`mcpp:admin` 是本包唯一的页签类型。 */
  readonly id: string
  /** 页签标题，显示在页签条与新建页签列表里。 */
  readonly title: string | (() => string)
  /** 新建页签列表里的一行说明。 */
  readonly description?: string | (() => string)
  /** 页签图标；函数形式按渲染尺寸取用。 */
  readonly icon?: ReactNode | ((size: number) => ReactNode)
  /** 新建页签列表中的顺序（升序，内置页占 10-40）。 */
  readonly order?: number
  /** 同类页签只保留一个实例。 */
  readonly single?: boolean
  /** 页签 body 组件。 */
  readonly component: (props: SidebarTabComponentProps) => ReactNode
}

/** better-sidebar 客户端注册表的消费面。 */
export interface BetterSidebarService {
  /** 注册一个页签类型；返回的注销函数随插件 fiber 释放。 */
  registerTab(descriptor: SidebarTabDescriptor): () => void
}

/** 一个 `settings.section` 注册项（`slots.register` 的入参子集）。 */
export interface SettingsSectionOptions {
  readonly name: 'settings.section'
  /** 设置页分区 id；复用内置 id 会替换该分区，这里用独立的 `mcpp`。 */
  readonly id: string
  /** 设置导航中的位置（升序）。 */
  readonly order?: number
  /** 设置导航里的分区名。 */
  readonly label?: string | (() => string)
}

/** 客户端 slot 注册表（`ctx.get('slots')`）的消费面。 */
export interface SlotsService {
  /** 注册设置页分区；返回的注销函数随调用方 fiber 释放。 */
  register(options: SettingsSectionOptions, component: () => ReactNode): () => void
  /** `settings.section` 槽声明就绪时执行回调；返回注销函数。 */
  inject(key: 'settings.section', callback: () => () => void): () => void
}

/** 客户端 Cordis 上下文的最小结构面（只含本插件调用的成员）。 */
export interface ClientCtx {
  /** 注册随插件 fiber 释放的副作用。 */
  readonly effect: EffectFn
  /** 等指定服务可用后执行回调；服务缺失时回调不执行，也不抛错。 */
  inject(deps: readonly string[], callback: (scope: ClientCtx) => void): void
  /** 读取可选的侧栏注册表；未安装 better-sidebar 时为 undefined。 */
  get(name: 'betterSidebar'): BetterSidebarService | undefined
  /** 读取客户端 slot 注册表；客户端 shell 未提供时为 undefined。 */
  get(name: 'slots'): SlotsService | undefined
  /** 其它服务名的宽松读取（本插件不使用）。 */
  get(name: string): unknown
}

/** 一次注册失败的条目，例如与 mcp-client 的公开名冲突。 */
export interface McppRegistrationError {
  /** 冲突或失败的工具名。 */
  readonly name: string
  /** 宿主给出的失败原因。 */
  readonly message: string
}

/** 一个上游连接在工具目录里的摘要。 */
export interface McppUpstream {
  readonly name: string
  /** `stdio` 或 `streamable-http`。 */
  readonly transport: string
}

/** 工具目录里的一个工具。 */
export interface McppCatalogTool {
  /** 稳定 expose key（`upstream/tool`），选择文档按它保存。 */
  readonly key: string
  /** 下游显示名（`mcp__<toolset>__<tool>` 或上游原名）。 */
  readonly name: string
  readonly description: string
  /** 当前选择文档是否包含该工具。 */
  readonly enabled: boolean
}

/** 工具目录里的一个 toolset 分组。 */
export interface McppCatalogToolset {
  readonly name: string
  /** 配置里是否标为默认 toolset。 */
  readonly default: boolean
  readonly tools: readonly McppCatalogTool[]
}

/** `GET /plugins/mcpp/ui/catalog` 的响应。 */
export interface McppCatalog {
  readonly serverName: string
  /** 外部 MCP 客户端使用的公开网关 origin。 */
  readonly publicOrigin: string
  readonly toolsets: readonly McppCatalogToolset[]
  /** 当前已注册进主 agent 的公开工具名。 */
  readonly registered: readonly string[]
  /** 最近一次同步的失败项（含同名冲突）。 */
  readonly errors: readonly McppRegistrationError[]
  readonly upstreams: readonly McppUpstream[]
}

/** `POST /plugins/mcpp/ui/selection` 与 `/plugins/mcpp/ui/sync` 的响应。 */
export interface McppSyncResult {
  /** 本次同步后注册成功的公开工具名。 */
  readonly registered: readonly string[]
  readonly errors: readonly McppRegistrationError[]
}
