#!/usr/bin/env node
/**
 * 简历 JSON 离线校验器（简历工坊 Agent Skill 配套脚本）。
 *
 * 与服务端 /api/pdf 跑同一份白名单（server/sanitize.js）：这里通过，服务端必收，
 * 不存在「本地过了线上被清洗」的偏差。统计与质量警告供代理在提交前自查。
 *
 * 用法：
 *   node validate_resume.mjs <resume.json> [more.json ...]
 *   cat resume.json | node validate_resume.mjs -
 *
 * 退出码：0 = 全部文件通过白名单校验（警告不改变退出码）；1 = 任一文件不合法。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sanitizeResume } from '../../../server/sanitize.js'

/** 递归收集所有字符串值，用于占位符扫描 */
function collectStrings(node, out = []) {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) node.forEach((item) => collectStrings(item, out))
  else if (node && typeof node === 'object')
    Object.values(node).forEach((v) => collectStrings(v, out))
  return out
}

const PLACEHOLDER = /(某某|示例简历|张伟|李四|xxx|XXX|example\.com|13800000000)/

/**
 * 校验并盘点一份简历数据。
 * @param {unknown} raw 未解析的简历对象
 * @returns {{ ok: true, stats: object, warnings: string[] } | { ok: false, error: string }}
 */
export function inspectResume(raw) {
  const result = sanitizeResume(raw)
  if (!result.ok) return result

  const resume = result.value
  const warnings = []
  const add = (message) => warnings.push(message)

  if (!resume.basics.name) add('缺姓名（basics.name）')
  if (!resume.basics.jobTitle) add('缺求职岗位（basics.jobTitle）')
  const hasContact = resume.basics.fields.some(
    (field) => field.icon === 'phone' || field.icon === 'mail',
  )
  if (!hasContact) add('缺联系方式（basics.fields 里没有 phone / mail 图标的项）')
  if (resume.basics.showAvatar && !resume.basics.avatar) add('开了头像位（showAvatar）但没有头像图')

  let entries = 0
  let bullets = 0
  let emptyBullets = 0
  let emptyEntries = 0
  const byType = {}
  for (const section of resume.sections) {
    byType[section.type] = (byType[section.type] || 0) + 1
    if (section.type !== 'entries') continue
    for (const entry of section.items) {
      entries += 1
      const bulletTexts = entry.bullets.filter((bullet) => bullet.text.trim())
      bullets += bulletTexts.length
      emptyBullets += entry.bullets.length - bulletTexts.length
      const hasMeta = entry.meta.some((meta) => meta.value.trim())
      if (!entry.org.trim() && !entry.role.trim() && bulletTexts.length === 0 && !hasMeta) {
        emptyEntries += 1
      }
    }
  }
  if (emptyEntries > 0) add(`有 ${emptyEntries} 条空经历（机构、职位、要点全空）`)
  if (emptyBullets > 0) add(`有 ${emptyBullets} 条空要点`)
  if (resume.sections.length > 7) add(`模块 ${resume.sections.length} 个，超过 7 个很难排进一页`)
  if (bullets > 18) add(`要点共 ${bullets} 条，超出 18 条大概率溢出到第二页`)

  const strings = collectStrings(resume)
  if (strings.some((text) => PLACEHOLDER.test(text))) {
    add('发现疑似占位符（某某/示例/xxx/example.com 等），确认不是样例数据残留')
  }

  const images =
    (resume.basics.avatar ? 1 : 0) +
    resume.sections.reduce(
      (sum, section) =>
        sum + (section.type === 'entries' ? section.items.filter((item) => item.logo).length : 0),
      0,
    )
  const textChars = strings.reduce((sum, text) => sum + text.length, 0)

  return {
    ok: true,
    stats: {
      template: resume.template,
      sections: resume.sections.length,
      byType,
      entries,
      bullets,
      images,
      textChars,
    },
    warnings,
  }
}

function report(name, input) {
  let raw
  try {
    raw = JSON.parse(input)
  } catch (err) {
    console.error(`✖ ${name} —— 不是合法 JSON：${err.message}`)
    return false
  }

  const result = inspectResume(raw)
  if (!result.ok) {
    console.error(`✖ ${name} —— ${result.error}`)
    return false
  }

  const { template, sections, byType, entries, bullets, images, textChars } = result.stats
  const breakdown = Object.entries(byType)
    .map(([type, count]) => `${type} ${count}`)
    .join('、')
  console.log(`✔ ${name}`)
  console.log(
    `  模板 ${template}｜模块 ${sections}（${breakdown}）｜条目 ${entries}｜要点 ${bullets}｜图片 ${images}｜正文约 ${textChars} 字`,
  )
  for (const warning of result.warnings) console.warn(`  ⚠ ${warning}`)
  return true
}

function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('用法：node validate_resume.mjs <resume.json> [...]（"-" 表示读 stdin）')
    process.exit(1)
  }

  let allOk = true
  for (const arg of args) {
    // '-' 表示从 stdin 读；其余按相对当前工作目录的路径读
    const input =
      arg === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(process.cwd(), arg), 'utf8')
    allOk = report(arg, input) && allOk
  }
  process.exit(allOk ? 0 : 1)
}

// 被 vitest 导入时不执行 CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
