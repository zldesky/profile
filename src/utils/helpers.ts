/**
 * 通用工具函数集合。
 */

let seed = 0

/** 生成短唯一标识，用于数据项 key。 */
export function uid(prefix = 'id'): string {
  seed += 1
  return `${prefix}_${Date.now().toString(36)}${seed.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 将 #RRGGBB 或 #RGB 颜色转换为 r,g,b 字符串；解析失败返回 fallback。 */
export function hexToRgb(hex: string, fallback = '0,0,0'): string {
  const rgb = parseHex(hex)
  return rgb ? rgb.join(',') : fallback
}

/** 解析 #RRGGBB / #RGB 为 [r, g, b]，解析失败返回 null。 */
function parseHex(hex: string): [number, number, number] | null {
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
 * @returns #RRGGBB
 */
export function mixHex(fromHex: string, toHex: string, ratio: number): string {
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
 * 解析失败时不写任何值，让样式表里的默认黑色继续生效。
 */
export function applyChromeAccent(hex: string): void {
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

/** 限制数值范围。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 深拷贝可序列化对象。 */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 防抖包装。
 * flush() 立即执行一次挂起的调用（撤销前补记一笔时用），cancel() 丢弃。
 */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  wait = 300,
): T & { cancel(): void; flush(...args: Parameters<T>): void } {
  let timer: number | null = null
  const clear = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const wrapped = ((...args: Parameters<T>) => {
    clear()
    timer = window.setTimeout(() => {
      clear()
      fn(...args)
    }, wait)
  }) as T & { cancel(): void; flush(...args: Parameters<T>): void }
  wrapped.cancel = clear
  wrapped.flush = (...args: Parameters<T>) => {
    if (timer === null) return
    clear()
    fn(...args)
  }
  return wrapped
}

/** 触发浏览器下载二进制内容（如服务端返回的 PDF）。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

/** 触发浏览器下载文本内容。 */
export function downloadFile(content: string, filename: string, mime = 'application/json'): void {
  downloadBlob(new Blob([content], { type: `${mime};charset=utf-8` }), filename)
}

/** 格式化时间戳为「YYYY-MM-DD HH:mm」。 */
export function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 把字节数变成人话：`380 KB`、`1.2 MB`。
 *
 * 用在导出回执里。给一个数字（甚至不给）都不如给一句「380 KB」有用 ——
 * 用户能据此判断「这是不是一份正常大小的简历」。
 * 用 1024 进制（与文件管理器一致），不是 1000。
 *
 * 小于 1 KB 时显示字节数：一份 300 字节的 PDF 显然是空白的，这个信息很有用。
 */
export function formatBytes(bytes: number): string {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size < 0) return '大小未知'
  if (size < 1024) return `${Math.round(size)} B`
  const kb = size / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/**
 * 读取图片文件并等比压缩为 DataURL，用于控制简历数据体积。
 * @param maxSize 最长边像素上限
 * @param format 输出格式；logo 类图形用 png 以保留透明背景
 */
export function readImageAsDataUrl(
  file: File,
  maxSize = 420,
  format: 'jpeg' | 'png' = 'jpeg',
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.onload = () =>
      compressDataUrl(reader.result as string, maxSize, format).then(resolve, reject)

    reader.readAsDataURL(file)
  })
}

/**
 * 把已加载的 DataURL 图片等比压缩为 DataURL，压缩规则同 readImageAsDataUrl。
 * 裁剪弹窗裁完的原图、文件直读两条路径共用，保证入库体积一致。
 */
export function compressDataUrl(
  dataUrl: string,
  maxSize = 420,
  format: 'jpeg' | 'png' = 'jpeg',
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onerror = () => reject(new Error('图片无法解析'))
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('画布不可用'))
        return
      }
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

/** 读取图片的原始像素尺寸。 */
export function readImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('图片无法解析'))
    img.src = src
  })
}

/** 数组元素换位。 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}
