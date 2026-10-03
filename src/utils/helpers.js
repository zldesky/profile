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
export function hexToRgb(hex, fallback = '0,0,0') {
  const rgb = parseHex(hex)
  return rgb ? rgb.join(',') : fallback
}

/**
 * 解析 #RRGGBB / #RGB 为 [r, g, b]，解析失败返回 null。
 * @param {string} hex 颜色值
 * @returns {number[]|null}
 */
function parseHex(hex) {
  const value = String(hex || '')
    .replace('#', '')
    .trim()
  const normalized =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null

  const num = parseInt(normalized, 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

/**
 * 在两个颜色之间线性插值（ratio=0 返回 from，ratio=1 返回 to）。
 * @param {string} fromHex 起始色 #RRGGBB
 * @param {string} toHex   目标色 #RRGGBB
 * @param {number} ratio   插值比例 0-1
 * @returns {string} #RRGGBB
 */
export function mixHex(fromHex, toHex, ratio) {
  const from = parseHex(fromHex) || [0, 0, 0]
  const to = parseHex(toHex) || [0, 0, 0]
  const k = Math.min(1, Math.max(0, Number(ratio) || 0))
  return (
    '#' +
    from
      .map((c, i) => Math.round(c + (to[i] - c) * k))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  )
}

/**
 * 把简历主色推导为编辑器外壳的品牌色令牌，内联写到 :root 上。
 * 设计面板换主色时整个界面（顶栏、按钮、选中态、选中框）随之换主题；
 * 纸张本身走 .paper 的 --accent，两条线互不影响，打印也不受干扰。
 * 解析失败时不写任何值，让样式表里的默认松绿继续生效。
 * @param {string} hex 简历主色 #RRGGBB
 */
export function applyChromeAccent(hex) {
  const rgb = parseHex(hex)
  if (!rgb) return

  const [r, g, b] = rgb
  const root = document.documentElement.style
  const normalized = `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`

  root.setProperty('--ed-brand', normalized)
  // 深浅两档：深色做悬停与文字，浅色做选中底与渐变高光，保证任意主色下层次关系一致
  root.setProperty('--ed-brand-strong', mixHex(normalized, '#000000', 0.14))
  root.setProperty('--ed-brand-deep', mixHex(normalized, '#000000', 0.3))
  root.setProperty('--ed-brand-grad-hi', mixHex(normalized, '#ffffff', 0.1))
  root.setProperty('--ed-brand-grad-lo', mixHex(normalized, '#000000', 0.08))
  root.setProperty('--ed-brand-tint', mixHex(normalized, '#ffffff', 0.9))
  root.setProperty('--ed-brand-ring', `rgba(${r}, ${g}, ${b}, 0.16)`)
  root.setProperty('--ed-brand-border', `rgba(${r}, ${g}, ${b}, 0.45)`)
  root.setProperty('--ed-brand-glow', `0 1px 2px rgba(${r}, ${g}, ${b}, 0.4)`)
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
 * flush() 立即执行一次挂起的调用（撤销前补记一笔时用），cancel() 丢弃。
 */
export function debounce(fn, wait = 300) {
  let timer = null
  const wrapped = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, wait)
  }
  wrapped.cancel = () => {
    clearTimeout(timer)
    timer = null
  }
  wrapped.flush = (...args) => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
    fn(...args)
  }
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
    reader.onload = () => compressDataUrl(reader.result, maxSize, format).then(resolve, reject)

    reader.readAsDataURL(file)
  })
}

/**
 * 把已加载的 DataURL 图片等比压缩为 DataURL，压缩规则同 readImageAsDataUrl。
 * 裁剪弹窗裁完的原图、文件直读两条路径共用，保证入库体积一致。
 * @param {string} dataUrl 图片 DataURL
 * @param {number} maxSize 最长边像素上限
 * @param {'jpeg'|'png'} format 输出格式
 * @returns {Promise<string>}
 */
export function compressDataUrl(dataUrl, maxSize = 420, format = 'jpeg') {
  return new Promise((resolve, reject) => {
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

      resolve(
        format === 'png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9),
      )
    }
    img.src = dataUrl
  })
}

/**
 * 读取图片的原始像素尺寸。
 * @param {string} src 图片 DataURL 或 Object URL
 * @returns {Promise<{width: number, height: number}>}
 */
export function readImageSize(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('图片无法解析'))
    img.src = src
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
