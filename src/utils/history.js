/**
 * 快照式撤销/重做历史栈（纯数据结构，无 Vue / 浏览器依赖，可直测）。
 *
 * 接线方式见 stores/resume.js：
 *  - 简历每次「成组」的修改结束时，调用 commit(current) 把上一个已提交状态压栈；
 *  - undo/redo 交换栈顶并返回目标快照，由调用方整体替换状态。
 *
 * 两类边界都为简历场景做了收缩：
 *  - 条目上限：超过 maxEntries 丢最旧的；
 *  - 字节预算：头像等图片以 dataURL 内嵌，单份快照可达 MB 级，
 *    超过 maxBytes 同样从最旧开始丢，避免撤销栈把内存吃爆。
 *  （undo/redo 本身在交换时也要接受预算检查，防止一步「重做」把预算顶穿。）
 */

const DEFAULT_MAX_ENTRIES = 50
/** 24MiB：约 8 张 3MB 头像的历史容量，超出按最旧丢弃 */
const DEFAULT_MAX_BYTES = 24 * 1024 * 1024

/**
 * @param {object} [options]
 * @param {number} [options.maxEntries] 快照条数上限
 * @param {number} [options.maxBytes] 快照总字节预算（按 UTF-16 长度近似）
 * @returns {{
 *   init: (current: string) => void,
 *   commit: (current: string) => boolean,
 *   undo: (current: string) => string | null,
 *   redo: (current: string) => string | null,
 *   reset: (current: string) => void,
 *   canUndo: () => boolean,
 *   canRedo: () => boolean,
 *   size: () => number,
 * }}
 */
export function createHistory({
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  /** @type {string[]} 过去的快照，栈顶是上一个状态 */
  let past = []
  /** @type {string[]} 未来的快照，栈顶是下一步可回到的状态 */
  let future = []
  /** 最近一次提交（或应用）的状态，同时是「当前状态」的基线 */
  let last = ''

  /** 状态与基线一致时无需记录 */
  const same = (a, b) => a === b

  /** 入栈时维持条数与字节预算，超限从最旧丢 */
  function pushPast(snapshot) {
    past.push(snapshot)
    let total = past.reduce((sum, item) => sum + item.length, 0)
    while (past.length > maxEntries || (total > maxBytes && past.length > 1)) {
      const dropped = past.shift()
      total -= dropped.length
    }
  }

  /**
   * 初始化/重置：以 current 为基线，清空两侧栈。
   * 用于载入初始数据、导入 JSON、恢复示例这类「历史从这里重新数」的场景。
   */
  function init(current) {
    past = []
    future = []
    last = current
  }

  /**
   * 提交一次成组修改。current 与基线不同时把基线压入 past、清空 future。
   * @returns {boolean} 本次是否实际产生了记录
   */
  function commit(current) {
    if (same(current, last)) return false
    pushPast(last)
    future = []
    last = current
    return true
  }

  /**
   * 撤销：current 是调用方的当前状态，可能尚未 commit（比如正打字就按了 Ctrl+Z），
   * 因此先把它作为基线补提交，再回退到 past 栈顶。
   * @returns {string | null} 目标快照；无可撤销时为 null
   */
  function undo(current) {
    if (!past.length) return null
    if (!same(current, last)) commit(current)
    future.push(last)
    const target = past.pop()
    last = target
    return target
  }

  /**
   * 重做：把当前状态压回 past，弹出 future 栈顶作为目标。
   * @returns {string | null} 目标快照；无可重做时为 null
   */
  function redo(current) {
    if (!future.length) return null
    if (!same(current, last)) commit(current)
    const target = future.pop()
    pushPast(last)
    last = target
    return target
  }

  /** 与 undo/redo 配套的显式重置（重置简历、导入替换后调用） */
  function reset(current) {
    init(current)
  }

  const canUndo = () => past.length > 0
  const canRedo = () => future.length > 0
  const size = () => past.length

  return { init, commit, undo, redo, reset, canUndo, canRedo, size }
}
