/**
 * 头像二进制的 IndexedDB 仓储。
 *
 * 头像以 dataURL 内嵌在简历 JSON 里，是把 localStorage 顶向 5MB 上限的最大单一因素。
 * 这里把「持久化形态」与「内存形态」分离：
 *  - 内存里（store.resume）始终是可渲染的 dataURL，模板 / 云同步 / 导出全部无感；
 *  - 写 localStorage 与撤销基线时换成 `idb-avatar:<hash>` 引用，dataURL 本体进 IndexedDB；
 *  - 载入 / 切换文档时再从 IndexedDB 换回 dataURL。
 *
 * IndexedDB 不可用（老浏览器、极端隐私模式）时 `isAvailable()` 返回 false，
 * 调用方应回退为把 dataURL 内联进 JSON —— 慢一点但绝不丢头像。
 */

const DB_NAME = 'resume-studio-assets'
const STORE_NAME = 'avatars'
/** 存进简历 JSON 的头像引用前缀 */
export const AVATAR_REF_PREFIX = 'idb-avatar:'

let dbPromise = null
/** 首次成功 open 后置 true；后续 put/get 失败会回退 false */
let available = typeof indexedDB !== 'undefined'

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }).catch((error) => {
      available = false
      throw error
    })
  }
  return dbPromise
}

// 模块加载即预热：尽早知道 IndexedDB 是否可用，决定后续序列化走哪条路
if (available) openDb().catch(() => {})

export function isAvailable() {
  return available
}

export function isAvatarRef(value) {
  return typeof value === 'string' && value.startsWith(AVATAR_REF_PREFIX)
}

/** djb2 内容指纹：同一张头像重复保存只落一条记录 */
function hashContent(text) {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

/**
 * 立即返回头像引用并异步落库。调用方在序列化时同步拿引用，
 * 写库失败时置 available=false 并让下次 save() 回退内联。
 * @param {string} dataUrl 头像 dataURL
 * @returns {string} `idb-avatar:<hash>` 引用
 */
export function storeAvatar(dataUrl) {
  const key = hashContent(dataUrl)
  const ref = `${AVATAR_REF_PREFIX}${key}`

  openDb()
    .then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite')
          tx.objectStore(STORE_NAME).put(dataUrl, key)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error)
        }),
    )
    .catch((error) => {
      available = false
      console.error(`头像资产写入失败，已回退内联存储：${error}`)
    })

  return ref
}

/**
 * 按引用取回头像 dataURL。
 * @param {string} ref `idb-avatar:<hash>` 引用
 * @returns {Promise<string|null>} 找不到时返回 null
 */
export async function loadAvatar(ref) {
  if (!isAvatarRef(ref) || !available) return null
  const key = ref.slice(AVATAR_REF_PREFIX.length)
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const request = tx.objectStore(STORE_NAME).get(key)
      tx.oncomplete = () => resolve(request.result ?? null)
      tx.onerror = () => reject(tx.error)
    })
  } catch (error) {
    available = false
    console.error(`头像资产读取失败：${error}`)
    return null
  }
}

/**
 * 清理不再被任何文档引用的头像（换过头像后旧 blob 会残留）。
 * @param {string[]} keepRefs 需要保留的 `idb-avatar:` 引用集合
 */
export async function pruneAvatars(keepRefs) {
  if (!available) return
  const keep = new Set(
    keepRefs.filter(isAvatarRef).map((ref) => ref.slice(AVATAR_REF_PREFIX.length)),
  )
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const cursorRequest = store.openCursor()
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (!cursor) return
        if (!keep.has(String(cursor.key))) cursor.delete()
        cursor.continue()
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (error) {
    // 清理失败无害，只是多占点空间
    console.error(`头像资产清理失败：${error}`)
  }
}
