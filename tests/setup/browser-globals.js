/**
 * 给 store 测试用的浏览器 API 补齐工具（仅按需安装，不要写进 vitest 的 setupFiles）。
 *
 * 背景：tests 跑在 Node 里，而 src/stores/resume.js 在 setup 阶段就会注册
 * `window` / `document` 事件监听并读写 `localStorage`，没有这些全局对象连 store 都
 * 创建不出来。但**不能全局安装 document**：pdf.js 会据此判定自己跑在浏览器里，
 * 转而按 URL 解析 worker 文件，导致 tests/pdfImportE2E.test.js 直接失败
 * （报错形如 Cannot find module 'D:\node_modules\pdfjs-dist\build\pdf.worker.min.mjs'）。
 *
 * 因此这里只在需要的测试文件里用 installBrowserGlobals() / uninstallBrowserGlobals()
 * 成对开关，且不引入 jsdom，只补 store 真正用到的那几项：
 *   localStorage、sessionStorage、window.addEventListener、document 的
 *   addEventListener / visibilityState / createElement。
 *
 * sessionStorage 必须一起补：AI 配置的「草稿」与「仅本次会话」两条路都写它，
 * 少了它会抛 ReferenceError，而调用处是 try/catch 静默降级 —— 测试会「通过」，
 * 但通过的原因是写入失败了，等于什么都没验证。
 *
 * avatarStore 依赖 IndexedDB，它对缺失已内置降级（isAvailable() 返回 false），
 * 这里刻意不补 indexedDB，顺带覆盖「无 IndexedDB 环境」这条分支。
 */

/** 让某个 key 的 setItem 抛错，用来测超容量时的降级行为 */
let failingKeys = new Set()

class MemoryStorage {
  #map = new Map()

  get length() {
    return this.#map.size
  }

  key(index) {
    return [...this.#map.keys()][index] ?? null
  }

  getItem(key) {
    const value = this.#map.get(String(key))
    return value === undefined ? null : value
  }

  setItem(key, value) {
    const name = String(key)
    if (failingKeys.has(name)) {
      const error = new Error(`模拟写入失败：${name}`)
      error.name = 'QuotaExceededError'
      throw error
    }
    this.#map.set(name, String(value))
  }

  removeItem(key) {
    this.#map.delete(String(key))
  }

  clear() {
    this.#map.clear()
  }
}

/** 测试用：指定 key 在写入时抛错（模拟超配额），传空解除 */
function failStorageKey(key) {
  failingKeys.clear()
  if (key) failingKeys.add(key)
}

// 挂到全局，方便测试里直接调用（installBrowserGlobals 的返回值也带一份）
globalThis.__failStorageKey = failStorageKey

/** 极简元素占位：Vue 与 store 都不需要真实 DOM 行为，只要能建、能挂属性 */
function makeElement(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    style: {},
    sheet: null,
    innerHTML: '',
    textContent: '',
    setAttribute() {},
    getAttribute() {
      return null
    },
    appendChild(child) {
      return child
    },
    removeChild(child) {
      return child
    },
    addEventListener() {},
    removeEventListener() {},
    // <template> 的解析结果：Vue 加载时会读 .content
    content: { firstChild: null, childNodes: [] },
  }
}

function makeEventTarget() {
  const bucket = new Map()
  return {
    addEventListener(type, handler) {
      if (!bucket.has(type)) bucket.set(type, new Set())
      bucket.get(type).add(handler)
    },
    removeEventListener(type, handler) {
      bucket.get(type)?.delete(handler)
    },
    // utils/helpers.ts 的 debounce 用 window.setTimeout 而非全局 setTimeout，
    // 少了这几个会让 store 的自动保存与历史提交直接抛错
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    setInterval: (...args) => globalThis.setInterval(...args),
    clearInterval: (...args) => globalThis.clearInterval(...args),
  }
}

const saved = {}

/** 安装浏览器全局，返回 localStorage / sessionStorage 实例供断言使用 */
export function installBrowserGlobals() {
  const storage = new MemoryStorage()
  const session = new MemoryStorage()

  saved.localStorage = globalThis.localStorage
  saved.sessionStorage = globalThis.sessionStorage
  saved.window = globalThis.window
  saved.document = globalThis.document

  globalThis.localStorage = storage
  globalThis.sessionStorage = session
  globalThis.window = makeEventTarget()
  globalThis.document = {
    ...makeEventTarget(),
    visibilityState: 'visible',
    createElement: makeElement,
    createElementNS: (_ns, tag) => makeElement(tag),
    createTextNode: (text) => ({ textContent: String(text) }),
    querySelector: () => null,
    head: makeElement('head'),
    body: makeElement('body'),
  }

  return { storage, session, failStorageKey }
}

/** 还原环境，避免污染同进程内的其它测试文件 */
export function uninstallBrowserGlobals() {
  failingKeys = new Set()
  for (const key of ['localStorage', 'sessionStorage', 'window', 'document']) {
    if (saved[key] === undefined) delete globalThis[key]
    else globalThis[key] = saved[key]
    delete saved[key]
  }
}
