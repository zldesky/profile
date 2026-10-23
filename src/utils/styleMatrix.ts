/**
 * 模板 × 风格兼容矩阵的语义。
 *
 * 这份逻辑原先散在两处，且**两处的语义互相矛盾**：
 *  - `useStyleConfig.stylesForTemplate()` 用 `matrix[id] || null` 取值，
 *    空数组是 truthy，于是返回 `[]` —— 被调用方解读为「一个风格都不允许」；
 *  - 后台保存时又把**每个**模板都写进矩阵（`[]` 占位），注释还写着
 *    「没有登记的模板视为不限制」。
 *
 * 后果是真实的功能回归：默认模板「经典单栏」与「自由定制」没有 `styles` 白名单，
 * 后台保存一次之后它们的每一行都是 `[]`，编辑器里这两个模板下的风格胶囊全部置灰，
 * 用户再也换不了风格 —— 而界面没有任何报错，只是点不动。
 *
 * 现在把语义收成一处：**空行 = 不限制**。矩阵里出现空数组与键缺失等价，
 * 两者都解析为 null。这样后台「清空整行」是一个安全动作（恢复默认），
 * 而不是一个会把模板锁死的动作。
 */
import type { TemplateMeta } from '@/data/presets'

/** 风格兼容矩阵：`{ [templateId]: [styleKey] }`；空数组 / 缺失 = 不限制 */
export type StyleMatrix = Record<string, string[]>

/**
 * 取某模板允许的风格键；`null` 表示不限制（全部可用）。
 *
 * 注意这里必须是 `length > 0` 而不是 `|| null`：后者对 `[]` 返回空数组，
 * 而空数组在调用方眼里是「全部锁定」—— 正是本文件开头描述的那个回归。
 */
export function resolveStyleWhitelist(
  matrix: StyleMatrix | null | undefined,
  templateId: string,
): string[] | null {
  const row = matrix?.[templateId]
  return Array.isArray(row) && row.length > 0 ? row : null
}

/**
 * 组装提交给 `/api/styles-admin` 的矩阵。
 *
 * 只写「有内容」的行：空行等同于不限制，写进去既没有信息量，
 * 又会让下一个人在读取侧误以为它是「明确的空名单」。
 * 与 `resolveStyleWhitelist` 配套，保证存下去与读回来语义一致。
 */
export function buildMatrixPayload(
  templates: TemplateMeta[],
  draft: StyleMatrix | null | undefined,
): StyleMatrix {
  const payload: StyleMatrix = {}
  for (const tpl of templates) {
    const row = draft?.[tpl.id]
    if (Array.isArray(row) && row.length > 0) payload[tpl.id] = [...row]
  }
  return payload
}
