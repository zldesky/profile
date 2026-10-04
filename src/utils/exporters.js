/**
 * 简历文本导出（纯逻辑，可直接单测）。
 *
 * Markdown 版用于粘贴进在线文档或支持 MD 的投递系统；
 * 纯文本版面向 ATS 解析与招聘网站表单，不含任何标记符号。
 * 两者都跳过隐藏模块与空内容，保证导出即可用。
 */

const str = (value) => String(value ?? '').trim()

/** 依序拼接非空片段，作为条目标题行：机构 · 职位 */
function joinParts(parts, separator = ' · ') {
  return parts.filter(Boolean).join(separator)
}

const visibleSections = (resume) =>
  (Array.isArray(resume?.sections) ? resume.sections : []).filter((s) => s && s.visible !== false)

/**
 * 渲染为 Markdown。
 * @param {object} resume 简历数据
 * @returns {string}
 */
export function resumeToMarkdown(resume) {
  const basics = resume?.basics || {}
  const lines = []

  lines.push(`# ${str(basics.name) || '简历'}`)
  if (str(basics.jobTitle)) lines.push('', `**${str(basics.jobTitle)}**`)

  const contactLines = (Array.isArray(basics.fields) ? basics.fields : [])
    .filter((f) => str(f?.value))
    .map((f) => `- ${str(f.label) || '联系方式'}：${str(f.value)}`)
  if (contactLines.length) lines.push('', ...contactLines)

  visibleSections(resume).forEach((section) => {
    const title = str(section.title) || '未命名模块'
    lines.push('', `## ${title}`)

    if (section.type === 'entries') {
      ;(Array.isArray(section.items) ? section.items : []).forEach((entry) => {
        const heading = joinParts([str(entry?.org), str(entry?.role)])
        if (heading) lines.push('', `### ${heading}`)
        if (str(entry?.time)) lines.push(str(entry.time))
        ;(Array.isArray(entry?.meta) ? entry.meta : [])
          .filter((m) => str(m?.value))
          .forEach((m) => lines.push(`- ${str(m.label) || '补充'}：${str(m.value)}`))
        ;(Array.isArray(entry?.bullets) ? entry.bullets : [])
          .filter((b) => str(b?.text))
          .forEach((b) => lines.push(`- ${str(b.text)}`))
      })
    } else if (section.type === 'grid') {
      ;(Array.isArray(section.items) ? section.items : [])
        .filter((item) => str(item?.value))
        .forEach((item) => lines.push(`- ${str(item.label) || '信息'}：${str(item.value)}`))
    } else if (section.type === 'skills') {
      ;(Array.isArray(section.fields) ? section.fields : [])
        .filter((f) => str(f?.value))
        .forEach((f) => lines.push(`- ${str(f.label) || '技能'}：${str(f.value)}`))
      ;(Array.isArray(section.items) ? section.items : [])
        .filter((s) => str(s?.name))
        .forEach((s) =>
          lines.push(
            section.showBars
              ? `- ${str(s.name)}（熟练度 ${Number(s.level) || 0}%）`
              : `- ${str(s.name)}`,
          ),
        )
    } else if (section.type === 'text') {
      const content = str(section.content)
      if (content) lines.push('', content)
    }
  })

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`
}

/**
 * 渲染为纯文本（ATS 友好）：无标记符号，模块标题用【】包裹。
 * @param {object} resume 简历数据
 * @returns {string}
 */
export function resumeToPlainText(resume) {
  const basics = resume?.basics || {}
  const lines = []

  const head = joinParts([str(basics.name), str(basics.jobTitle)], ' ｜ ')
  if (head) lines.push(head)

  const contactLines = (Array.isArray(basics.fields) ? basics.fields : [])
    .filter((f) => str(f?.value))
    .map((f) => `${str(f.label) || '联系方式'}：${str(f.value)}`)
  if (contactLines.length) lines.push(...contactLines)

  visibleSections(resume).forEach((section) => {
    const title = str(section.title) || '未命名模块'
    lines.push('', `【${title}】`)

    if (section.type === 'entries') {
      ;(Array.isArray(section.items) ? section.items : []).forEach((entry) => {
        const heading = joinParts([str(entry?.org), str(entry?.role)], ' ｜ ')
        if (heading) lines.push(heading)
        if (str(entry?.time)) lines.push(`时间：${str(entry.time)}`)
        ;(Array.isArray(entry?.meta) ? entry.meta : [])
          .filter((m) => str(m?.value))
          .forEach((m) => lines.push(`${str(m.label) || '补充'}：${str(m.value)}`))
        ;(Array.isArray(entry?.bullets) ? entry.bullets : [])
          .filter((b) => str(b?.text))
          .forEach((b) => lines.push(`- ${str(b.text)}`))
      })
    } else if (section.type === 'grid') {
      ;(Array.isArray(section.items) ? section.items : [])
        .filter((item) => str(item?.value))
        .forEach((item) => lines.push(`${str(item.label) || '信息'}：${str(item.value)}`))
    } else if (section.type === 'skills') {
      ;(Array.isArray(section.fields) ? section.fields : [])
        .filter((f) => str(f?.value))
        .forEach((f) => lines.push(`${str(f.label) || '技能'}：${str(f.value)}`))
      ;(Array.isArray(section.items) ? section.items : [])
        .filter((s) => str(s?.name))
        .forEach((s) =>
          lines.push(
            section.showBars ? `${str(s.name)}（熟练度 ${Number(s.level) || 0}%）` : str(s.name),
          ),
        )
    } else if (section.type === 'text') {
      const content = str(section.content)
      if (content) lines.push(content)
    }
  })

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`
}
