/**
 * 导出流程的状态判定（纯函数）。
 *
 * 从 usePdfExport 里抽出来的原因：那条「未登录 → 弹登录 → 成功后自动续跑导出」
 * 的链路一直是本项目最脆弱的地方 —— 它跨了三个模块（auth / authDialog / 导出），
 * 状态藏在多个 ref 里，改一处很容易漏掉另一处，而**单测完全覆盖不到**
 * （要挂载组件 + 模拟网络）。把「该走哪一步」抽成纯函数之后，
 * 每种组合都能用一行断言钉住。
 *
 * 它只回答一个问题：**现在这次点击应该做什么**。
 * 真正执行动作的仍然是调用方。
 */

/** 认证态 */
export type AuthState = 'anon' | 'authed' | 'unknown'

export interface ExportContext {
  /** 当前登录态 */
  auth: AuthState
  /** 服务是否要求脚本口令 */
  authRequired: boolean
  /** 本地是否已有可用口令 */
  hasPassword: boolean
  /** 今日额度是否已用完 */
  quotaExhausted: boolean
  /** 是否正在导出 */
  exporting: boolean
}

/** 这次点击应该采取的动作 */
export type ExportAction =
  /** 直接导出 */
  | 'export'
  /** 弹登录/注册弹窗，成功后续跑 */
  | 'ask-login'
  /** 弹口令输入框 */
  | 'ask-password'
  /** 什么都不做（正在导出 / 额度用完） */
  | 'noop'

/**
 * 判定本次点击的动作。
 *
 * 顺序是有讲究的，改之前先读这几条：
 *
 *  1. **正在导出 / 额度用完 → 直接返回**。这两种情况点了也没用，
 *     再去弹登录框只会让用户白登录一次。
 *
 *  2. **服务要口令且本地没有 → 弹口令框**，优先于登录：
 *     这类部署里账号登录也能用，但口令是更直接的那条路；
 *     而且口令框是本地弹窗，比跳登录页打断更小。
 *
 *  3. **匿名且无口令 → 弹登录**。这是最常见的首次使用路径。
 *     若服务其实要口令（`authRequired`）却没有口令，走的是第 2 条，不会到这里。
 *
 *  4. 其余情况直接导出。
 */
export function decideExportAction(ctx: ExportContext): ExportAction {
  if (ctx.exporting || ctx.quotaExhausted) return 'noop'

  // 服务要求口令、本地还没有 → 先要口令（比登录更直接，也不打断编辑）
  if (ctx.authRequired && !ctx.hasPassword) return 'ask-password'

  // 匿名、且没有口令通道可用 → 必须登录
  if (ctx.auth === 'anon' && !ctx.hasPassword) return 'ask-login'

  return 'export'
}

/**
 * 导出失败后是否应该清掉本地口令。
 *
 * 只有「口令本身不对 / 已被锁定」才清：其他失败（额度、网络、渲染服务没起来）
 * 与口令无关，清掉它只会让用户重新输入一遍 —— 而重新输入并不能解决问题。
 *
 * @param code 服务端返回的错误码
 */
export function shouldClearPassword(code: string | undefined): boolean {
  return code === 'AUTH_FAILED' || code === 'AUTH_LOCKED'
}

/** 失败后是否应该保持口令弹窗打开（好让用户重输） */
export function shouldKeepPasswordDialog(code: string | undefined): boolean {
  return code === 'AUTH_FAILED'
}

/**
 * 额度用尽时给用户指的另一条路。
 * 抽出来是因为它在三处被用到，措辞不一致会让人以为是不一样的东西。
 */
export const QUOTA_FALLBACK_HINT = '可改用「打印导出」，它不消耗额度'

/**
 * 判断一条错误信息是否属于「可预期限制」（额度 / 来源），
 * 用于决定提示里要不要加「改用打印导出」。
 *
 * 注意：这里匹配的是服务端文案。它**不是**理想做法（`conventions.md` 要求按 code 分流），
 * 但额度与来源两类错误目前没有专用 code，而它们又确实需要不同的话术。
 * 抽成一个函数集中一处，至少不会散落成五份各自为政的正则。
 */
export function isExpectedLimit(message: string): boolean {
  return /额度|来源/.test(String(message ?? ''))
}
