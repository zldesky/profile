import { describe, expect, it } from 'vitest'

import { routes } from '@/router/routes'
import { EDITOR_PATH } from '../server/renderTarget.ts'

/**
 * PDF 渲染目标必须是一个真实存在的路由。
 *
 * 这条测试来自一次真实事故：编辑器原先在站点根路径 `/`，
 * 后来首页占用了 `/`、编辑器搬到 `/editor`，而服务端的渲染地址**没有跟着改**。
 * 首页的主视觉里也有一个 `.paper`（缩略图预览），于是导出链路一路"成功"，
 * 实际交付的是**首页的 PDF**：纸宽 332px、带首页的页头页脚、分成 2 页。
 *
 * 「选错了页面却毫无报错」只能靠断言路径来防 —— 这也是本项目的规矩：
 * 脚本/链路报"成功"时，先确认它检查的是对的东西。
 */
describe('PDF 渲染目标', () => {
  it('EDITOR_PATH 在路由表里真实存在', () => {
    const paths = routes.map((r) => r.path)
    expect(paths).toContain(EDITOR_PATH)
  })

  it('它指向编辑器而不是首页', () => {
    const matched = routes.find((r) => r.path === EDITOR_PATH)
    expect(matched?.name, '渲染目标应当是编辑器页').toBe('editor')
    expect(EDITOR_PATH).not.toBe('/')
  })

  it('路径是绝对路径（拼接时不会漏掉斜杠）', () => {
    expect(EDITOR_PATH.startsWith('/')).toBe(true)
  })

  it('站点根路径不是编辑器 —— 换言之不能再用 "/" 当渲染地址', () => {
    // 如果哪天编辑器又搬回根路径，这条会失败，提醒同步改回 EDITOR_PATH
    const root = routes.find((r) => r.path === '/')
    expect(root?.name).not.toBe('editor')
  })
})
