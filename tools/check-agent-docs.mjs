/**
 * 校验 `.agent/` 下的文档没有与代码漂移。
 *
 * 为什么需要这个：AI 协作文档最危险的失效方式不是"写错"，而是**写的时候对、之后悄悄过期**。
 * 过期的文档会让 AI 产生"幻读"——照着一段看起来权威的描述去改，而那段描述已经不成立。
 * 本项目已经有过先例：README 里写着「HOST=0.0.0.0 且未设口令则拒绝启动」，
 * 而代码里从来没有这个校验（Docker 部署路径反而会因此起不来）。
 *
 * 所以这里只做一件事：把文档里**可机械核对**的断言抽出来跑一遍。
 * 不核对措辞、不核对风格，只核对「文件在不在、字段在不在、脚本在不在」。
 *
 * 用法：
 *   node tools/check-agent-docs.mjs
 * 退出码 0 = 全部一致；1 = 有漂移，逐条打印怎么修。
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
let checks = 0

function fail(message, hint) {
  failures += 1
  console.log(`FAIL  ${message}`)
  if (hint) console.log(`      → ${hint}`)
}

function ok(message) {
  checks += 1
  console.log(`ok    ${message}`)
}

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8')
}

/* ---------------- 1. 文档里引用的路径必须存在 ---------------- */

const docs = ['.agent/AGENTS.md', '.agent/conventions.md', '.agent/testing.md', '.agent/prompts.md']

/** 从 markdown 里抠出所有相对链接目标（排除 http、锚点） */
function linkTargets(markdown) {
  const out = new Set()
  for (const m of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const target = m[1].trim()
    if (/^(https?:|#|mailto:)/.test(target)) continue
    out.add(target.split('#')[0])
  }
  return out
}

for (const doc of docs) {
  if (!existsSync(path.join(root, doc))) {
    fail(`文档缺失：${doc}`, 'AGENTS.md 是入口，其余三份是它的子页')
    continue
  }
  const markdown = read(doc)
  const base = path.dirname(path.join(root, doc))
  for (const target of linkTargets(markdown)) {
    if (!target) continue
    const resolved = path.resolve(base, target)
    if (!existsSync(resolved)) {
      fail(`${doc} 里的链接指向不存在的路径：${target}`, '改链接，或补上那个文件')
    }
  }
}
if (failures === 0) ok('四份文档齐全，内部链接全部可达')

/* ---------------- 2. 文档声称的脚本必须在 package.json 里 ---------------- */

const pkg = JSON.parse(read('package.json'))
const scripts = pkg.scripts || {}
const docText = docs.map((d) => (existsSync(path.join(root, d)) ? read(d) : '')).join('\n')

/** 文档里以 npm run X / npm run X 形式出现的脚本名 */
const mentioned = new Set()
for (const m of docText.matchAll(/npm run ([a-z:][\w:-]*)/g)) mentioned.add(m[1])

for (const name of mentioned) {
  if (!scripts[name]) {
    fail(`文档提到 npm run ${name}，但 package.json 里没有这个脚本`, '删掉该引用，或补上脚本')
  }
}
if (mentioned.size > 0) ok(`文档提到的 ${mentioned.size} 个 npm 脚本都存在`)

/* ---------------- 3. conventions.md 声称的「未受类型检查的 .js」数量 ---------------- */

const conventions = read('.agent/conventions.md')
const claimedCount = Number((conventions.match(/(\d+) 个 `\.js` 文件/) || [])[1] || 0)
if (claimedCount > 0) {
  /*
   * 用 ls-tree 而不是 git ls-files 配 "src 双星号 斜杠 双星号点 js" 这种 pathspec：
   * 后者要求至少一层子目录，**顶层 src/main.js 会被漏掉**（实测 25 vs 实际 26）。
   * 这个差一本身很难发现，所以留这条注释，免得以后有人"优化"回去又悄悄少算一个。
   */
  const { execSync } = await import('node:child_process')
  // git 不可用时给 -1，下面按「没法核对」跳过，而不是误报成漂移
  let actual
  try {
    actual = execSync('git ls-tree -r --name-only HEAD -- src', { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter((line) => line.endsWith('.js')).length
  } catch {
    actual = -1
  }
  if (actual > 0 && actual !== claimedCount) {
    fail(
      `conventions.md 写的是「${claimedCount} 个 .js 文件不受类型检查」，实际现在是 ${actual} 个`,
      '改掉那个数字（或确认 tsconfig 的 include 是否变了）',
    )
  } else {
    ok(`未受类型检查的 .js 数量与文档一致（${actual}）`)
  }
}

/* ---------------- 4. 关键约定在代码里仍然成立 ---------------- */

const checks4 = [
  {
    label: 'server 相对导入必须写 .ts（tsconfig 开了 allowImportingTsExtensions）',
    run() {
      const tsconfig = read('tsconfig.json')
      return /"allowImportingTsExtensions"\s*:\s*true/.test(tsconfig)
    },
    hint: '若关掉了它，conventions.md 里那条硬约束要一起改',
  },
  {
    label: 'tsconfig 仍是 checkJs: false（文档据此说 JS 不受检查）',
    run() {
      return /"checkJs"\s*:\s*false/.test(read('tsconfig.json'))
    },
    hint: '若打开了 checkJs，conventions.md 的整节都要重写',
  },
  {
    label: 'vitest 仍不全局安装 DOM（否则 pdf.js 会误判环境）',
    run() {
      /*
       * 只看 `test:` 块里有没有真正的 setupFiles 配置项，不能对整份文件做正则匹配 ——
       * vitest.config.js 的**注释里**就写着「刻意不配 setupFiles」，
       * 第一版检查因此把它误判成"已经配了"（自己踩了一次，正好是本文档警告的那类错误：
       * 判据选错，实测对象其实是对的）。
       */
      const config = read('vitest.config.js')
      const withoutComments = config
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
      return !/setupFiles\s*:/.test(withoutComments)
    },
    hint: '若真加了 setupFiles，testing.md 那条警告要改',
  },
  {
    label: 'server/sanitize.ts 仍有 clampNumber 与 ALLOW 白名单',
    run() {
      const s = read('server/sanitize.ts')
      return /function clampNumber/.test(s) && /const ALLOW = \{/.test(s)
    },
    hint: 'conventions.md 的新增字段流程引用了这两个东西',
  },
  {
    label: 'tests/setup/browser-globals.js 导出 installBrowserGlobals / uninstallBrowserGlobals',
    run() {
      const s = read('tests/setup/browser-globals.js')
      return /installBrowserGlobals/.test(s) && /uninstallBrowserGlobals/.test(s)
    },
    hint: 'testing.md 让读者调用这两个函数，改名了就要同步',
  },
  {
    label: 'eslint.config.js 仍豁免 src/data/normalizeResume.ts 的 no-explicit-any',
    run() {
      return /normalizeResume\.ts/.test(read('eslint.config.js'))
    },
    hint: 'conventions.md 说这是"刻意的单点豁免"',
  },
  {
    label: 'PITFALLS.md 的 A 类仍是 18 条（AGENTS.md 引用了这个数字）',
    run() {
      const md = read('PITFALLS.md')
      const count = (md.match(/^### A\d/gm) || []).length
      return count === 18
    },
    hint: '条数变了就把 AGENTS.md 里那个「18 条」一起改',
  },
]

for (const item of checks4) {
  // 断言自身抛错算失败：这条检查没能证明「约定仍成立」，就不能算通过
  let passed
  try {
    passed = item.run()
  } catch {
    passed = false
  }
  if (passed) ok(item.label)
  else fail(item.label, item.hint)
}

/* ---------------- 5. 文档里点名的关键文件都在 ---------------- */

const keyFiles = [
  'src/types/resume.ts',
  'src/data/normalizeResume.ts',
  'src/data/defaultResume.ts',
  'src/styles/paper.css',
  'server/sanitize.ts',
  'server/render.ts',
  'server/renderTarget.ts',
  'server/aiGuard.ts',
  'server/imageProxy.ts',
  'tests/setup/browser-globals.js',
  'skills/resume-workshop/references/data-schema.md',
  'PITFALLS.md',
  'README.md',
  'server/README.md',
]
const missing = keyFiles.filter((f) => !existsSync(path.join(root, f)))
if (missing.length) {
  fail(`文档点名的文件不存在：${missing.join('、')}`, '改名或移动后要同步文档')
} else {
  ok(`文档点名的 ${keyFiles.length} 个关键文件都在`)
}

/* ---------------- 汇总 ---------------- */

console.log('')
if (failures === 0) {
  console.log(`.agent 文档校验通过：${checks} 项一致。`)
} else {
  console.log(`.agent 文档有 ${failures} 处漂移（共 ${checks + failures} 项检查）。`)
  console.log('修完再提交 —— 过期的 AI 文档比没有更危险。')
  process.exitCode = 1
}
