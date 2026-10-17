import type { Resume, Section } from '@/types/resume'

/**
 * 「在纸上直接改」的字段解析。
 *
 * 从点到的 DOM 反查该写回哪个数据字段。DOM 侧只提供两类锚点：
 *  - `data-sec-id`（各模板的模块根节点）与 `data-field` / `data-item-id`
 *    （SectionBody 与各模板的标题上，见它们的注释）；
 *  - 页头的姓名 / 职位没有模块，靠 data-field="name" / "jobTitle" 直接命中。
 *
 * 本模块刻意做成纯函数（传入 resume 与锚点，返回取值 / 写回闭包），
 * 因此不必起 DOM 就能单测 —— 而「字段映射错了会把内容写到别处」正是最该被测的。
 */

/** 元素上能提供的锚点 */
export interface FieldTarget {
  /** 模块 id；页头字段没有 */
  sectionId: string
  /** 字段种类 */
  field: string
  /** 网格项 / 条目 / 要点 / meta / 技能项的 id */
  itemId: string
  /** 条目的 id（要点与 meta 需要它来定位父条目） */
  entryId: string
}

export type FieldKind = 'text' | 'multiline' | 'number'

export interface EditTarget {
  /** 面板标题 */
  label: string
  /** 当前值（字符串形式，便于放进输入框） */
  value: string
  kind: FieldKind
  /** 写回 */
  commit: (next: string) => void
}

/** 面板标题用的字段名 */
const FIELD_LABELS: Record<string, string> = {
  name: '姓名',
  jobTitle: '求职职位',
  sectionTitle: '模块标题',
  content: '正文',
  gridLabel: '标签',
  gridValue: '内容',
  entryTime: '时间',
  entryOrg: '机构 / 公司',
  entryRole: '职位 / 专业',
  metaLabel: '标签',
  metaValue: '内容',
  bulletText: '要点',
  skillLabel: '标签',
  skillValue: '内容',
  skillName: '技能名',
  skillLevel: '熟练度（0-100）',
}

/** 多行输入：正文与要点是成段的，单行框里改很难受 */
const MULTILINE_FIELDS = new Set(['content', 'bulletText'])

/**
 * 去掉显示用的后缀。
 * 网格与技能的标签在纸上是「标签：」，值就是纯值；回写时要把「：」补回去，
 * 否则用户改一次标签，冒号就永久消失了。
 */
function stripSuffix(text: string, suffix: string): string {
  return text.endsWith(suffix) ? text.slice(0, -suffix.length) : text
}

function findSection(resume: Resume, id: string): Section | undefined {
  return resume.sections.find((section) => section.id === id)
}

/**
 * 解析可编辑字段。
 *
 * @param resume 当前简历（直接改它的字段即可，store 的响应式会接手）
 * @param target DOM 锚点
 * @returns 可编辑目标；该处不可编辑（或数据已不存在）时返回 null
 */
export function resolveEditTarget(resume: Resume, target: FieldTarget): EditTarget | null {
  const label = FIELD_LABELS[target.field]
  if (!label) return null

  const kind: FieldKind =
    target.field === 'skillLevel'
      ? 'number'
      : MULTILINE_FIELDS.has(target.field)
        ? 'multiline'
        : 'text'
  const base = { label, kind }

  /* ---------- 页头字段（不属于任何模块） ---------- */
  if (target.field === 'name') {
    return { ...base, value: resume.basics.name, commit: (next) => (resume.basics.name = next) }
  }
  if (target.field === 'jobTitle') {
    return {
      ...base,
      value: resume.basics.jobTitle,
      commit: (next) => (resume.basics.jobTitle = next),
    }
  }
  if (target.field === 'sectionTitle') {
    const section = findSection(resume, target.sectionId)
    if (!section) return null
    return { ...base, value: section.title, commit: (next) => (section.title = next) }
  }
  if (target.field === 'content') {
    const section = findSection(resume, target.sectionId)
    if (!section || section.type !== 'text') return null
    return { ...base, value: section.content, commit: (next) => (section.content = next) }
  }

  /* ---------- 模块内的条目级字段 ---------- */
  const section = findSection(resume, target.sectionId)
  if (!section) return null

  if (target.field === 'gridLabel' || target.field === 'gridValue') {
    if (section.type !== 'grid') return null
    const item = section.items.find((it) => it.id === target.itemId)
    if (!item) return null
    const isLabel = target.field === 'gridLabel'
    return {
      ...base,
      value: isLabel ? item.label : item.value,
      commit: (next) => {
        if (isLabel) item.label = next
        else item.value = next
      },
    }
  }

  if (section.type === 'entries') {
    const entry = section.items.find((it) => it.id === target.entryId)
    if (!entry) return null

    if (
      target.field === 'entryTime' ||
      target.field === 'entryOrg' ||
      target.field === 'entryRole'
    ) {
      const key =
        target.field === 'entryTime' ? 'time' : target.field === 'entryOrg' ? 'org' : 'role'
      return {
        ...base,
        value: entry[key] ?? '',
        commit: (next) => {
          entry[key] = next
        },
      }
    }

    if (target.field === 'metaLabel' || target.field === 'metaValue') {
      const meta = entry.meta.find((m) => m.id === target.itemId)
      if (!meta) return null
      const isLabel = target.field === 'metaLabel'
      return {
        ...base,
        value: isLabel ? meta.label : meta.value,
        commit: (next) => {
          if (isLabel) meta.label = next
          else meta.value = next
        },
      }
    }

    if (target.field === 'bulletText') {
      const bullet = entry.bullets.find((b) => b.id === target.itemId)
      if (!bullet) return null
      return {
        ...base,
        value: bullet.text,
        commit: (next) => {
          bullet.text = next
        },
      }
    }
    return null
  }

  if (section.type === 'skills') {
    if (target.field === 'skillLabel' || target.field === 'skillValue') {
      const field = section.fields.find((f) => f.id === target.itemId)
      if (!field) return null
      const isLabel = target.field === 'skillLabel'
      return {
        ...base,
        value: isLabel ? field.label : field.value,
        commit: (next) => {
          if (isLabel) field.label = next
          else field.value = next
        },
      }
    }

    if (target.field === 'skillName' || target.field === 'skillLevel') {
      const skill = section.items.find((s) => s.id === target.itemId)
      if (!skill) return null
      const isLevel = target.field === 'skillLevel'
      return {
        ...base,
        value: isLevel ? String(skill.level) : skill.name,
        commit: (next) => {
          if (!isLevel) {
            skill.name = next
            return
          }
          // 熟练度是 0-100 的整数：纸上的进度条宽度直接用它，越界会画出纸外
          const parsed = Number.parseInt(stripSuffix(next, '%'), 10)
          if (Number.isNaN(parsed)) return
          skill.level = Math.max(0, Math.min(100, parsed))
        },
      }
    }
  }

  return null
}
