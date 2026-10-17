import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { installBrowserGlobals, uninstallBrowserGlobals } from './setup/browser-globals.js'
import {
  AI_PRESETS,
  clearAIDraft,
  clearAISettings,
  loadAIDraft,
  loadAISettings,
  presetById,
  saveAIDraft,
  saveAISettings,
} from '../src/utils/aiKeyStore.js'

/**
 * AI 配置存储与预设。
 *
 * 预设是「用户点了就能用」的承诺，所以地址与模型的形状要用断言钉住：
 * 地址多一段少一段都会 404，而模型默认值若不在候选列表里，界面会退化成手填。
 * 草稿则关系到「填了一半不小心关掉会不会丢」，是这次修的主要问题之一。
 */
describe('AI 预设', () => {
  it('id 唯一', () => {
    const ids = AI_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每项都有 id 与 label', () => {
    for (const preset of AI_PRESETS) {
      expect(preset.id).toBeTruthy()
      expect(preset.label).toBeTruthy()
    }
  })

  it('端点地址是合法的 https 绝对地址，且不带尾部斜杠', () => {
    for (const preset of AI_PRESETS) {
      if (preset.id === 'custom') continue
      // 服务端会固定拼 /chat/completions，尾部斜杠会拼出双斜杠
      expect(preset.baseUrl.endsWith('/')).toBe(false)
      const url = new URL(preset.baseUrl)
      expect(url.protocol).toBe('https:')
      expect(url.hostname).toBeTruthy()
    }
  })

  it('baseUrl 不包含 /chat/completions（服务端会自己拼）', () => {
    for (const preset of AI_PRESETS) {
      expect(preset.baseUrl).not.toContain('/chat/completions')
    }
  })

  it('非自定义预设的默认模型都在候选列表里（否则界面会退化成手填）', () => {
    for (const preset of AI_PRESETS) {
      if (preset.id === 'custom') continue
      expect(preset.models).toContain(preset.model)
    }
  })

  it('自定义预设没有候选项与默认地址（避免拼出无效请求）', () => {
    const custom = presetById('custom')
    expect(custom.id).toBe('custom')
    expect(custom.baseUrl).toBe('')
    expect(custom.models).toEqual([])
  })

  it('包含用户点名的两家：硅基流动与 OpenCode', () => {
    const siliconflow = presetById('siliconflow')
    expect(siliconflow.baseUrl).toBe('https://api.siliconflow.cn/v1')

    const opencode = presetById('opencode')
    // 实测确认：/inference/openai/v1/models 是 404，正确的 OpenAI 兼容前缀是 /inference/v1
    expect(opencode.baseUrl).toBe('https://opencode.ai/inference/v1')
  })

  it('未知 id 退回自定义而不是抛错', () => {
    expect(presetById('nope').id).toBe('custom')
    expect(presetById(undefined).id).toBe('custom')
  })
})

describe('AI 草稿（防止误关弹窗丢输入）', () => {
  beforeEach(() => {
    installBrowserGlobals()
    clearAISettings()
    clearAIDraft()
  })

  afterEach(() => {
    uninstallBrowserGlobals()
  })

  it('没存过草稿时返回 null', () => {
    expect(loadAIDraft()).toBeNull()
  })

  it('原样回填已存内容', () => {
    saveAIDraft({
      presetId: 'opencode',
      baseUrl: 'https://opencode.ai/inference/v1',
      model: 'glm-5.3-flash',
      apiKey: 'sk-abc',
      remember: false,
    })

    expect(loadAIDraft()).toEqual({
      presetId: 'opencode',
      baseUrl: 'https://opencode.ai/inference/v1',
      model: 'glm-5.3-flash',
      apiKey: 'sk-abc',
      remember: false,
    })
  })

  it('只填了 Key 也算草稿（用户最容易丢的就是它）', () => {
    saveAIDraft({ presetId: 'custom', baseUrl: '', model: '', apiKey: 'sk-only', remember: true })

    expect(loadAIDraft()?.apiKey).toBe('sk-only')
  })

  it('全空当作没有草稿，避免每次打开都恢复一个空表单', () => {
    saveAIDraft({ presetId: 'custom', baseUrl: '', model: '', apiKey: '', remember: true })

    expect(loadAIDraft()).toBeNull()
  })

  it('草稿不进正式配置：没点过保存就仍是「未配置」', () => {
    saveAIDraft({
      presetId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: 'sk-draft',
      remember: true,
    })

    // 关键：草稿存在时 loadAISettings 必须仍返回 null，
    // 否则润色弹窗会以为已配置，用户只会撞到服务端报错
    expect(loadAISettings()).toBeNull()
  })

  it('正式保存后草稿可清掉，且不影响已保存配置', () => {
    saveAISettings({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: 'sk-real',
      remember: true,
    })
    saveAIDraft({ presetId: 'deepseek', baseUrl: 'x', model: 'y', apiKey: 'sk-draft' })

    clearAIDraft()

    expect(loadAIDraft()).toBeNull()
    expect(loadAISettings()?.apiKey).toBe('sk-real')
  })

  it('清除全部痕迹时连草稿一起去掉', () => {
    saveAISettings({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: 'sk-real',
      remember: true,
    })
    saveAIDraft({ presetId: 'deepseek', baseUrl: 'x', model: 'y', apiKey: 'sk-draft' })

    clearAISettings()

    expect(loadAISettings()).toBeNull()
    expect(loadAIDraft()).toBeNull()
  })

  it('损坏的草稿按没有处理，不抛错', () => {
    sessionStorage.setItem('resume-studio-ai-draft-v1', '{ 不是 JSON')

    expect(() => loadAIDraft()).not.toThrow()
    expect(loadAIDraft()).toBeNull()
  })
})
