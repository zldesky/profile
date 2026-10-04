/**
 * 简历完成度体检（纯逻辑，可直接单测）。
 *
 * 站在招聘方视角扫一遍简历数据，产出按严重度分级的问题清单与一个扣分制的分数：
 *  - error：招聘方会直接扣印象分的硬伤（缺姓名、空模块），每处 -18 分；
 *  - warn ：明显不完整（缺联系方式、条目没正文），每处 -9 分；
 *  - tip  ：锦上添花的优化项（缺量化数据、内容偏短），每处 -4 分。
 * 分数只是「把明显能补的补上」的参考，不是投递门槛。
 */

import { contactFieldIssue } from '@/utils/validators'

const LEVEL_WEIGHT = { error: 18, warn: 9, tip: 4 }
/** 问题排序：严重的排前面 */
const LEVEL_ORDER = { error: 0, warn: 1, tip: 2 }

const str = (value) => String(value ?? '').trim()

/** 按字段名语义判断是否电话 / 邮箱，与 ContactFieldsEditor 的提示口径一致 */
const PHONE_LABEL_RE = /电话|手机|号码|传真|tel|phone/i
const MAIL_LABEL_RE = /邮箱|邮件|mail/i

/**
 * 体检一份简历。
 * @param {object} resume 简历数据（store.resume 形态）
 * @returns {{ score: number, counts: {error: number, warn: number, tip: number}, issues: Array<{level: 'error'|'warn'|'tip', title: string, detail: string}> }}
 */
export function checkResume(resume) {
  const issues = []

  const basics = resume?.basics || {}
  if (!str(basics.name)) {
    issues.push({
      level: 'error',
      title: '缺少姓名',
      detail: '招聘方第一眼要看到你是谁，先补上姓名。',
    })
  }
  if (!str(basics.jobTitle)) {
    issues.push({
      level: 'warn',
      title: '缺少求职职位',
      detail: '写明目标岗位，简历内容才有对齐的方向。',
    })
  }

  const fields = Array.isArray(basics.fields) ? basics.fields : []
  const filledFields = fields.filter((f) => str(f.value))
  const hasPhone = filledFields.some((f) => PHONE_LABEL_RE.test(str(f.label)))
  const hasMail = filledFields.some((f) => MAIL_LABEL_RE.test(str(f.label)))
  if (!hasPhone) {
    issues.push({
      level: 'error',
      title: '缺少联系电话',
      detail: '没有电话，HR 很难第一时间联系到你。',
    })
  }
  if (!hasMail) {
    issues.push({
      level: 'warn',
      title: '缺少联系邮箱',
      detail: '不少投递渠道以邮件往来为主，建议补上。',
    })
  }
  // 已填的字段顺带做格式检查，复用编辑器里的同一条规则
  filledFields.forEach((f) => {
    const issue = contactFieldIssue(f.label, f.value)
    if (issue) issues.push({ level: 'warn', title: `「${str(f.label)}」格式存疑`, detail: issue })
  })

  const allSections = Array.isArray(resume?.sections) ? resume.sections : []
  const sections = allSections.filter((s) => s && s.visible !== false)
  if (!sections.length) {
    issues.push({
      level: 'error',
      title: '没有任何内容模块',
      detail: '简历正文还是空的，先添加教育、经历等模块。',
    })
  }
  sections.forEach((section) => checkSection(section, issues))

  // 模块结构建议：按标题启发式判断（标题可改名，所以只做 warn 级提示）
  if (sections.length) {
    const joinedTitles = sections.map((s) => str(s.title)).join('|')
    if (!/教育|学历/.test(joinedTitles)) {
      issues.push({
        level: 'warn',
        title: '没有教育背景模块',
        detail: '学历是多数岗位的硬门槛，建议补上教育背景模块。',
      })
    }
    if (!/工作|实习|项目|校园|实践/.test(joinedTitles)) {
      issues.push({
        level: 'warn',
        title: '没有任何经历类模块',
        detail: '至少保留一段工作、实习、项目或校园经历，简历才有可聊的内容。',
      })
    }
  }

  // 量化数据：有足够样本时，过半要点没有数字才提醒，避免两三条没数字就误报
  const { total: bulletTotal, withoutNumber } = collectBulletStats(sections)
  if (bulletTotal >= 4 && withoutNumber / bulletTotal > 0.6) {
    issues.push({
      level: 'tip',
      title: '多数要点缺少量化数据',
      detail: '把「提升了效率」写成「把构建耗时从 8 分钟降到 90 秒」，说服力完全不同。',
    })
  }

  const hiddenCount = allSections.length - sections.length
  if (hiddenCount > 0) {
    issues.push({
      level: 'tip',
      title: `有 ${hiddenCount} 个模块处于隐藏状态`,
      detail: '确认是有意隐藏，别让重要经历被挡在纸面之外。',
    })
  }

  // 同名问题合并计数：两条目都没写机构名，是一条「3 处」而不是两条一样的
  const merged = new Map()
  issues.forEach((issue) => {
    const existing = merged.get(issue.title)
    if (existing) {
      existing.count += 1
      return
    }
    merged.set(issue.title, { ...issue, count: 1 })
  })

  const finalIssues = [...merged.values()].sort(
    (a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level],
  )

  const deduction = finalIssues.reduce((sum, issue) => sum + LEVEL_WEIGHT[issue.level], 0)
  const counts = { error: 0, warn: 0, tip: 0 }
  finalIssues.forEach((issue) => (counts[issue.level] += 1))

  return { score: Math.max(0, 100 - deduction), counts, issues: finalIssues }
}

/** 单个模块的内容体检；同模块内同类问题合并成一条 */
function checkSection(section, issues) {
  const title = str(section.title) || '未命名模块'
  const label = `「${title}」`
  const add = (level, suffix, detail) => issues.push({ level, title: `${label}${suffix}`, detail })

  if (section.type === 'entries') {
    const items = Array.isArray(section.items) ? section.items : []
    if (!items.length) {
      add('error', '模块是空的', '放几段真实经历进去，或者删掉这个空模块。')
      return
    }
    let missingOrg = 0
    let missingBody = 0
    let longEntry = false
    items.forEach((entry) => {
      if (!str(entry?.org)) missingOrg += 1
      const bullets = (Array.isArray(entry?.bullets) ? entry.bullets : []).filter((b) =>
        str(b?.text),
      )
      const hasMeta = (Array.isArray(entry?.meta) ? entry.meta : []).some((m) => str(m?.value))
      if (!bullets.length && !hasMeta) missingBody += 1
      if (bullets.length > 6) longEntry = true
    })
    if (missingOrg) {
      add(
        'warn',
        `有条目没写机构/项目名（${missingOrg} 处）`,
        '学校、公司或项目名是这段经历的锚点，缺了就没法定位。',
      )
    }
    if (missingBody) {
      add(
        'warn',
        `有条目没有正文（${missingBody} 处）`,
        '既没有要点也没有补充说明，招聘方看不到这段经历里你做了什么。',
      )
    }
    if (longEntry) {
      add('tip', '有条目要点超过 6 条', '精简到 3-5 条最有含金量的，剩下的面试再展开。')
    }
  } else if (section.type === 'grid') {
    const items = Array.isArray(section.items) ? section.items : []
    if (!items.length) {
      add('error', '模块是空的', '放几条键值信息进去，或者删掉这个空模块。')
      return
    }
    const unfinished = items.filter((item) => !str(item?.label) || !str(item?.value)).length
    if (unfinished) {
      add(
        'warn',
        `有未填完的条目（${unfinished} 处）`,
        '空着的项目名或内容会在纸面上留白，填完或删掉。',
      )
    }
  } else if (section.type === 'skills') {
    const hasFields = (Array.isArray(section.fields) ? section.fields : []).some((f) =>
      str(f?.value),
    )
    const hasItems = (Array.isArray(section.items) ? section.items : []).some((s) => str(s?.name))
    if (!hasFields && !hasItems) {
      add('error', '模块是空的', '列出你的技能栈，或者删掉这个空模块。')
    } else if (!hasFields) {
      add(
        'tip',
        '只有进度条没有文字描述',
        '加一两句技能描述，说明用它们做过什么，比单纯的熟练度更有说服力。',
      )
    }
  } else if (section.type === 'text') {
    const content = str(section.content)
    if (!content) {
      add('error', '模块是空的', '写一段有数据支撑的自我评价，或者删掉这个空模块。')
    } else if (content.length < 40) {
      add('tip', '段落内容偏短', '展开说说核心优势与代表性成果，三四句话比较合适。')
    }
  }
}

/** 统计全部可见条目的要点数与没有数字的要点数 */
function collectBulletStats(sections) {
  let total = 0
  let withoutNumber = 0
  sections.forEach((section) => {
    if (section.type !== 'entries') return
    ;(Array.isArray(section.items) ? section.items : []).forEach((entry) => {
      ;(Array.isArray(entry?.bullets) ? entry.bullets : []).forEach((bullet) => {
        const text = str(bullet?.text)
        if (!text) return
        total += 1
        if (!/\d/.test(text)) withoutNumber += 1
      })
    })
  })
  return { total, withoutNumber }
}
