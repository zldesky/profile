/**
 * 通用工具函数集合。
 */

let seed = 0

/**
 * 生成短唯一标识，用于数据项 key。
 * @param {string} prefix 标识前缀
 * @returns {string}
 */
export function uid(prefix = 'id') {
  seed += 1
  return `${prefix}_${Date.now().toString(36)}${seed.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 将 #RRGGBB 或 #RGB 颜色转换为 r,g,b 字符串。
 * @param {string} hex 颜色值
 * @param {string} fallback 解析失败时的回退值
 * @returns {string}
 */
export function hexToRgb(hex, fallback = '43,87,154') {
  const value = String(hex || '').replace('#', '').trim()
  const normalized =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return fallback

  const num = parseInt(normalized, 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255].join(',')
}

/**
 * 限制数值范围。
 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * 深拷贝可序列化对象。
 */
export function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * 防抖包装。
 */
export function debounce(fn, wait = 300) {
  let timer
  const wrapped = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
  wrapped.cancel = () => clearTimeout(timer)
  return wrapped
}

/**
 * 触发浏览器下载二进制内容（如服务端返回的 PDF）。
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

/**
 * 触发浏览器下载文本内容。
 */
export function downloadFile(content, filename, mime = 'application/json') {
  downloadBlob(new Blob([content], { type: `${mime};charset=utf-8` }), filename)
}

/**
 * 格式化时间戳为“YYYY-MM-DD HH:mm”。
 */
export function formatTime(timestamp) {
  const d = new Date(timestamp)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 读取图片文件并等比压缩为 DataURL，用于控制简历数据体积。
 * @param {File} file 图片文件
 * @param {number} maxSize 最长边像素上限
 * @param {'jpeg'|'png'} format 输出格式；logo 类图形用 png 以保留透明背景
 * @returns {Promise<string>}
 */
export function readImageAsDataUrl(file, maxSize = 420, format = 'jpeg') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('图片无法解析'))
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))

        const ctx = canvas.getContext('2d')
        if (format === 'jpeg') {
          // JPEG 不支持透明通道，先铺白底，避免透明区域发黑
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

        resolve(format === 'png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9))
      }
      img.src = reader.result
    }

    reader.readAsDataURL(file)
  })
}

/**
 * 数组元素换位。
 */
export function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}
