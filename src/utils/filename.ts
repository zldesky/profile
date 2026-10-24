/**
 * 投递文件的命名（纯函数）。
 *
 * 看起来是小事，但它是**发给别人的第一个东西**：文件名里带 `/`、`\`、`:`、
 * 或者整串是「未命名简历.pdf」，在对方的下载目录里就是一团糟。
 * 而且不同系统对文件名的限制不同，收敛规则必须集中一处。
 *
 * 这里的规则来自实际的投递习惯：
 *   张伟_前端开发工程师.pdf        ← 最常见
 *   张伟_简历.pdf                  ← 没填岗位
 *   简历.pdf                       ← 连名字都没填（仍要能下载）
 *   张伟_前端开发工程师_202610.pdf ← 投递包带年月，便于区分多次投递
 */

/**
 * 文件名里不允许出现的字符：Windows 的保守集合，macOS/Linux 都是它的子集。
 *
 * 控制字符（U+0000–U+001F）单独列出并**按码点过滤**，而不用正则字符类：
 * 字符类里的 `\u0000-\u001f` 会触发 eslint 的 no-control-regex，
 * 而那条规则本身是对的（控制字符出现在文件名里几乎总是脏数据）——
 * 与其加豁免，不如用看不见控制字符的写法。
 */
const ILLEGAL = /[\\/:*?"<>|]/g

/** 去掉控制字符：文件名与文本里都不该出现，且会让某些系统直接拒绝写盘 */
function stripControlChars(value: string): string {
  return [...value].filter((ch) => ch.charCodeAt(0) > 0x1f).join('')
}

/** 去掉首尾的点与空格（Windows 不允许以点结尾，空格也容易被吞） */
function trimEdges(value: string): string {
  return value.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '')
}

/**
 * 把任意文本整理成可用的文件名片段。
 *
 * @param value 原始文本
 * @param fallback 清洗后为空时的兜底
 * @param maxLength 最大长度（默认 40：留够空间给「_岗位_年月.pdf」）
 */
export function safeFilePart(value: unknown, fallback: string, maxLength = 40): string {
  const cleaned = trimEdges(
    stripControlChars(String(value ?? ''))
      .replace(ILLEGAL, ' ')
      // 折叠空白：中文姓名里偶尔被粘进全角空格
      .replace(/\s+/g, ' ')
      .trim(),
  )
  if (!cleaned) return fallback
  return cleaned.slice(0, maxLength)
}

export interface ResumeFileNameOptions {
  /** 姓名 */
  name?: string
  /** 求职职位 */
  jobTitle?: string
  /** 附加后缀（如 `202610`），会拼在岗位之后 */
  suffix?: string
  /** 扩展名，不带点 */
  extension?: string
}

/**
 * 生成投递用的文件名。
 *
 * @returns 形如 `张伟_前端开发工程师.pdf`；信息缺失时逐级降级，**永远返回可用文件名**
 */
export function resumeFileName(options: ResumeFileNameOptions = {}): string {
  const { name, jobTitle, suffix, extension } = options
  const parts = [
    safeFilePart(name, '简历'),
    // 没填岗位时不再塞一个「简历」，否则会变成「张伟_简历」，比「张伟」多两个字却没有任何信息
    jobTitle ? safeFilePart(jobTitle, '') : '',
    suffix ? safeFilePart(suffix, '') : '',
  ].filter(Boolean)

  const base = parts.join('_') || '简历'
  return extension ? `${base}.${extension}` : base
}

/**
 * 生成 `YYYYMM` 形式的年月标记，用于区分多次投递。
 * @param now 注入当前时间，便于测试
 */
export function monthStamp(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}${month}`
}
