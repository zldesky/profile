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
  /** 字段种类（data-field 的值），就地编辑据此决定能力开关（如行内加粗） */
  field: string
  /** 写回 */
  commit: (next: string) => void
}

/** 面板标题用的字段名 */
export const FIELD_LABELS: Record<string, string> = {
  name: '姓名',
  jobTitle: '求职职位',
  /** 页头「基本信息」的某一项（年龄 / 性别 / 电话 …）的**标签**，如「年龄」 */
  basicsLabel: '字段名',
  /** 页头「基本信息」的某一项的**内容**，如「28岁」 */
  basicsValue: '内容',
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
}

/** 多行输入：正文与要点是成段的，单行框里改很难受 */
const MULTILINE_FIELDS = new Set(['content', 'bulletText'])

/**
 * 值类文字支持行内加粗（`**…**`，就地编辑里选中后 Ctrl/B 按钮切换）。
 *
 * 只收经 RichText 渲染的字段（见 SectionBody.vue）：页头的姓名 / 职位 / 联系方式
 * 与模块标题、条目机构等由各模板直接插值渲染，加粗标记不会被解析，
 * 写进数据只会让纸面出现字面星号 —— 所以就地编辑对这些字段不提供加粗。
 */
export const BOLDABLE_FIELDS = new Set([
  'content',
  'gridValue',
  'metaValue',
  'bulletText',
  'skillValue',
  'skillName',
])

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

  const kind: FieldKind = MULTILINE_FIELDS.has(target.field) ? 'multiline' : 'text'
  const base = { label, kind, field: target.field }

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

  /*
   * 页头「基本信息」里的每一项（年龄 / 性别 / 电话 / 邮箱 / 现居城市 …）。
   *
   * 这些是 `basics.fields`（GridItem 数组），不是模块，之前**完全不能就地编辑** ——
   * 模板渲染它们时没有挂任何 data-field，用户只能去右侧面板找。
   * 现在按 itemId 精确定位，标签与内容都能改（改标签就变成「年龄」→「年纪」这类）。
   */
  if (target.field === 'basicsLabel' || target.field === 'basicsValue') {
    const item = resume.basics.fields.find((f) => f.id === target.itemId)
    if (!item) return null
    const isLabel = target.field === 'basicsLabel'
    return {
      ...base,
      value: isLabel ? item.label : item.value,
      commit: (next) => {
        if (isLabel) item.label = next
        else item.value = next
      },
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

    /*
     * 技能名可就地改。这里原先还处理 skillLevel（熟练度）——
     * 整套熟练度已移除（纸面不再渲染百分比，也没有进度条可调），
     * 所以那条分支一并删掉，而不是留着一条永远不会命中的死代码。
     */
    if (target.field === 'skillName') {
      const skill = section.items.find((s) => s.id === target.itemId)
      if (!skill) return null
      return {
        ...base,
        value: skill.name,
        commit: (next) => {
          skill.name = next
        },
      }
    }
  }

  return null
}
