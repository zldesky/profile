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
import { readFileSync, existsSync, readdirSync } from 'node:fs'
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
   * 数的是**工作区**的 .js，不是 git HEAD 里的。
   *
   * 原先这里用 `git ls-tree -r --name-only HEAD`，读的是**已提交**状态 ——
   * 于是把 `.js` 迁成 `.ts` 之后、提交之前，脚本照样报「一致」，
   * 而文档里那个数字已经错了。这个盲点在本项目真实发生过一次
   * （一次迁移改了 4 个文件，本地校验全绿，提交后 CI 才红）。
   *
   * 用递归读目录而不是 glob 字符串，顺带避开 `src/**` 这类 pathspec
   * 要求至少一层子目录、会漏掉顶层 `src/main.js` 的老问题。
   */
  function countJsFiles(dir) {
    let total = 0
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return 0
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        total += countJsFiles(path.join(dir, entry.name))
      } else if (entry.name.endsWith('.js')) {
        total += 1
      }
    }
    return total
  }

  const actual = countJsFiles(path.join(root, 'src'))
  if (actual !== claimedCount) {
    fail(
      `conventions.md 写的是「${claimedCount} 个 .js 文件不受类型检查」，工作区实际是 ${actual} 个`,
      '改掉那个数字（或确认 tsconfig 的 include 是否变了）',
    )
  } else {
    ok(`未受类型检查的 .js 数量与文档一致（${actual}）`)
  }

  /*
   * 分布表必须自己加得起来。
   *
   * 加这条是因为真踩过：分布表里写 `src/utils/ 15 个`，而那一行后面列出的名字
   * 数一遍只有 13 个；9+15+2+1+1=28 也不等于它自己声称的 26。
   * 总数对了、分布错了，比两个都错更难发现 —— 读者看到总数正确就会信整张表。
   * 这正是本文档反复警告的「分母没对」。
   */
  const distBlock = conventions.match(/```\n(src\/composables\/[\s\S]*?)```/)
  if (distBlock) {
    const rows = [...distBlock[1].matchAll(/^(src\/[\w./-]+|src\/main\.js)\s+(\d+)\s*个/gm)]
    const sum = rows.reduce((acc, m) => acc + Number(m[2]), 0)
    if (rows.length && sum !== claimedCount) {
      fail(
        `conventions.md 的分布表加总是 ${sum}，但总数写的是 ${claimedCount}（差 ${sum - claimedCount}）`,
        '逐行核对每个目录的真实 .js 数量：直接数 src 下各目录',
      )
    } else if (rows.length) {
      ok(`分布表加总与总数一致（${rows.length} 个目录，合计 ${sum}）`)
    }
  }
}

/* ---------------- 3b. README 声称的 `.vue` 组件数量 ---------------- */

/*
 * README 的「工程约定」里有一张表写着「64 / 64 全部完成」，而实际是 67 个 `.vue`，
 * 一直没人发现 —— 因为上面第 3 步只核对 `.js`，`.vue` 的数字从来没有校验过。
 * 这正是文档漂移最典型的形态：数字写下的那天是对的，之后新增组件就悄悄过期了。
 */
{
  let vueCount = 0
  function countVue(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) countVue(path.join(dir, entry.name))
      else if (entry.name.endsWith('.vue')) vueCount += 1
    }
  }
  countVue(path.join(root, 'src'))

  const readme = read('README.md')
  // 只认「N / N 全部完成」这种带分母的写法，这是 README 里真实的表述
  const claims = [...readme.matchAll(/(\d+)\s*\/\s*(\d+)\s*全部完成/g)]
  const wrong = claims.filter((m) => Number(m[1]) !== vueCount || Number(m[2]) !== vueCount)
  if (wrong.length) {
    fail(
      `README 写的是「${wrong[0][1]} / ${wrong[0][2]} 全部完成」，实际有 ${vueCount} 个 .vue`,
      '把 README 里那个分数改成实际组件数（两处：<script setup> 与 lang="ts"）',
    )
  } else if (claims.length) {
    ok(`README 的 .vue 组件数与实际一致（${vueCount}）`)
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
    label: 'PITFALLS.md 每个分类标题里声明的条数与实际条目数一致',
    run() {
      /*
       * 所有分类一起核对，不再只盯 A 类。
       *
       * 原先这条只断言「A 类仍是 18 条」，于是 B/C/D/E 的分类标题
       * （`## E. 改代码方式上的坑（5 条）`）从来没有被校验过 ——
       * 加了两条 E 类之后，那个「5 条」就变成了假话，而脚本照样全绿。
       * 数与实际不符比缺失更危险：读者看到"共 5 条"会以为已经读完。
       */
      const md = read('PITFALLS.md')
      // 分类标题形如 `## A. xxx（18 条）`，取字母与声明的条数
      const sections = [...md.matchAll(/^## ([A-F])\. [^\n]*?（(\d+) 条）/gm)]
      if (!sections.length) return false
      for (const [, letter, claimed] of sections) {
        const actual = (md.match(new RegExp(`^### ${letter}\\d`, 'gm')) || []).length
        if (actual !== Number(claimed)) {
          console.log(`      ${letter} 类声明 ${claimed} 条，实际 ${actual} 条`)
          return false
        }
      }
      return true
    },
    hint: 'PITFALLS.md 的分类标题括号里要写该类的实际条数',
  },
  {
    label: 'AGENTS.md 引用 PITFALLS.md 的 A 类条数与实际一致',
    run() {
      /*
       * AGENTS.md 里写死了「A 类有 18 条」。这条独立性是有意的：
       * 它校验的是**跨文件引用**，而不是 PITFALLS 自己的标题。
       * 两处一起改才算完成，所以分开断言、分别给提示。
       */
      const actual = (read('PITFALLS.md').match(/^### A\d/gm) || []).length
      const claimed = Number((read('.agent/AGENTS.md').match(/A 类有 \*\*(\d+) 条\*\*/) || [])[1] || 0)
      if (!claimed) return false
      return claimed === actual
    },
    hint: 'A 类条数变了就把 AGENTS.md 里那个数字一起改',
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
  // 枚举的单一来源：sanitize.ts 从这里跨端 import，加枚举字段必须动它。
  // 这一条是漏过的 —— 最初的新增字段清单里完全没有它。
  'src/data/presets.ts',
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

/* ---------------- 6. sanitize 的枚举来源仍是 presets.ts ---------------- */

/*
 * conventions.md 现在写着「枚举从 presets.ts 来，改 ALLOW 是改错了地方」。
 * 这个断言依赖 sanitize.ts 真的还在跨端 import presets；哪天它改成自己写字面量，
 * 文档那句话就变成误导，必须一起改。
 */
{
  const sanitize = read('server/sanitize.ts')
  const importsPresets = /from '\.\.\/src\/data\/presets\.ts'/.test(sanitize)
  if (importsPresets) {
    ok('sanitize.ts 的枚举仍来自 presets.ts（文档的新增字段流程成立）')
  } else {
    fail(
      'sanitize.ts 不再从 presets.ts 导入枚举',
      'conventions.md 里「枚举字段要改 presets.ts、改 ALLOW 是改错地方」那段要重写',
    )
  }
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
