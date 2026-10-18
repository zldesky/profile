import { describe, expect, it } from 'vitest'

import { routes } from '../src/router/routes.js'

/**
 * 路由形状的回归测试。
 *
 * 为什么值得测：`/` 从「编辑器」变成「产品首页」是一次影响所有入口的改动 ——
 * 谁进网站、看到的第一个页面是什么、以及各处 `name: 'editor'` 的链接落到哪儿。
 * 这类改动最容易在后续迭代里被无意改回去（有人图省事把首页改回编辑器），
 * 而单独的页面测试不会发现。
 *
 * 这里直接测 routes.js 这张纯配置表：它不依赖浏览器，因此不用造 location 桩。
 * 曾经试过导入 router/index.js，但 `createWebHistory()` 在模块求值时就读 location，
 * 而 vitest 会把 import 提升到可执行代码之前 —— 桩永远晚一步。把表抽出来就绕开了。
 */
describe('路由表', () => {
  const byName = (name) => routes.find((r) => r.name === name)
  const names = () => routes.map((r) => r.name)

  it('根路径是产品首页，不再是编辑器', () => {
    const home = routes.find((r) => r.path === '/')

    expect(home).toBeTruthy()
    expect(home.name).toBe('home')
  })

  it('编辑器在 /editor，且路由名仍是 editor（十余处链接依赖它）', () => {
    const editor = byName('editor')

    expect(editor).toBeTruthy()
    expect(editor.path).toBe('/editor')
  })

  it('编辑器不再占用根路径', () => {
    expect(byName('editor').path).not.toBe('/')
  })

  it('公开页面都在（合集 / 登录 / 分享）', () => {
    expect(names()).toContain('collection')
    expect(names()).toContain('login')
    expect(names()).toContain('share')
  })

  it('未知路径回首页，而不是直接把人丢进编辑器', () => {
    const fallback = routes.find((r) => String(r.path).includes('pathMatch'))

    expect(fallback).toBeTruthy()
    expect(fallback.redirect).toMatchObject({ name: 'home' })
  })

  it('首页与编辑器各自指向不同的页面组件', () => {
    // 两个 () => import(...) 若是同一个文件，说明首页其实没做出来
    expect(String(byName('home').component)).not.toBe(String(byName('editor').component))
  })

  it('每个路由要么有 name 要么是重定向（不留没名字的野路由）', () => {
    for (const r of routes) {
      expect(Boolean(r.name) || Boolean(r.redirect)).toBe(true)
    }
  })
})
