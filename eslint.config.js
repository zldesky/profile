import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * 编码规范：ESLint 管代码质量与 Vue 特有陷阱，格式（缩进/引号/换行）
 * 一律交给 Prettier —— 两边抢格式只会互相打架，这是官方推荐的分工。
 *
 * 配置分层：
 *  - 全部源码：js.recommended + vue/essential（拦截响应性丢失、v-html、key 缺失等）；
 *  - .ts 文件：typescript-eslint 的 recommended（见下方说明，缺了它 TS 完全不被 lint）；
 *  - src：浏览器全局（window、localStorage…）；
 *  - server / tests / 根配置：Node 全局（process、import.meta…）；
 *  - prettier 关闭所有与格式化冲突的风格规则，必须放在最后。
 *
 * 约定（ESLint 与 Prettier 都拦不住，只能靠约定）：模板里的行内事件处理器只写单条语句，
 * 多个动作一律包成 script 里的函数（如 TopBar 的 runExport / runImport）。
 * 理由：超长行内表达式会被 Prettier 折成多行，而 Vue 编译器解析不了折行后的多语句
 * 表达式，npm run build 会直接以语法错误失败——lint、typecheck 都不会报，CI 才炸。
 */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'server/.data/**'],
  },

  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],

  /*
   * TypeScript 文件必须单独接管解析器。
   * 没有这段时，ESLint 的默认解析器（espree）不认识 `import type`、类型标注等语法，
   * 而 flat config 里 js.recommended 与 vue/essential 都不匹配 .ts ——
   * 结果是所有 .ts 文件被静默跳过（显式传入只会得到 File ignored 警告），
   * 一旦有配置块覆盖到 .ts 又会直接报 Parsing error。两者都不是想要的状态。
   * 这里只接管 .ts：.vue 目前都是 JS，等组件迁 TS 时再补 vue 的 TS 解析链。
   */
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),

  {
    files: ['src/**'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // 项目对 XSS 的态度是「清洗输入 + 永不 v-html」，用规则把这个约定钉死
      'vue/no-v-html': 'error',
      // App.vue 是约定俗成的根组件名
      'vue/multi-word-component-names': ['error', { ignores: ['App'] }],
      // Vue 组合式 API 的常见失误：ref 用了没 .value，模板里丢 reactivity
      'vue/require-explicit-emits': 'error',
    },
  },

  {
    files: ['server/**', 'tests/**', 'skills/**/*.mjs', '*.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    // 这两个测试自己用 tests/setup/browser-globals.js 装上 localStorage /
    // window / document 桩（刻意不全局装，否则 pdf.js 会误判运行环境），
    // 因此这里把这三个全局声明为只读，而不是把整个 tests 目录当浏览器环境。
    files: [
      'tests/setup/browser-globals.js',
      'tests/resumeStore.test.js',
      'tests/resumePersistence.test.js',
      'tests/resumeHistory.test.js',
      'tests/resumeDocuments.test.js',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        localStorage: 'readonly',
        window: 'readonly',
        document: 'readonly',
      },
    },
  },

  {
    // render 里的 page.evaluate / addInitScript 回调运行在浏览器页面里，
    // 出现 document / window 是正常的
    files: ['server/render.ts'],
    languageOptions: {
      globals: { ...globals.node, window: 'readonly', document: 'readonly' },
    },
  },

  {
    // sanitize 的职责就是清洗控制字符（正文去不可见字符、文件名去 CR/LF），
    // 控制字符正则在这里是业务本身而不是笔误
    files: ['server/sanitize.ts'],
    rules: {
      'no-control-regex': 'off',
    },
  },

  {
    // normalizeResume 的 RawRecord = Record<string, any> 是刻意的：
    // 这个函数的职责就是逐字段收窄完全不可信的导入数据，入口处的 any 正是「尚未校验」的表达。
    // 换成 unknown 会在这里逼出十余处断言，把收窄逻辑本身搅浑，安全性并不会提高
    //（真正的边界是导入后的白名单与 normalizeResume 的产出类型）。
    files: ['src/data/normalizeResume.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  prettierConfig,
]
