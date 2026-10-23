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
   */
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),

  {
    /*
     * 组件开始迁 TS 后，`<script setup lang="ts">` 里的 `import type` 会让
     * vue-eslint-parser 直接报 Parsing error（它默认用 espree 解析 script 块）。
     * 这里给 .vue 指定内层解析器为 @typescript-eslint/parser：
     * 外层仍是 vue-eslint-parser（模板语法靠它），script 块交给 TS 解析器。
     * 只设 parser、不带 TS 规则集，避免 .vue 的 JS 部分被 TS 规则误伤。
     */
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
      },
    },
  },

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
    /*
     * tools/ 下的审计脚本同时活在两个环境里：
     *  - 脚本本体跑在 Node（process、console）；
     *  - 传给 page.evaluate 的那个函数体是在**浏览器**里求值的，里面用 document、
     *    getComputedStyle、elementFromPoint 都是正确的。
     * 所以这里两套全局都给，而不是把其中一半报成 no-undef 再逐行加豁免。
     */
    files: ['tools/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
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
      'tests/aiKeyStore.test.js',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        localStorage: 'readonly',
        sessionStorage: 'readonly',
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

  /*
   * ---------------- 分层依赖护栏 ----------------
   *
   * 下面两组规则把 README / .agent/conventions.md 里靠口头约定的分层**变成机器校验**。
   * 约定写进文档只会被读一次，写进 lint 才会被每一次改动拦住。
   *
   * 三条边界的理由：
   *  - 模板必须纯渲染：同一套模板组件被编辑器、分享页（/share/:id）与 PDF 渲染服务
   *    三处复用。模板一旦 import store 或组合式函数，分享页就会连带把整个编辑器
   *    状态机拉进公开页面，PDF 渲染也可能读到上一个请求的残留状态。
   *  - 纯逻辑层必须可单测：src/utils 在 Node 里被 tests/ 直接 import。
   *    引用组件或 store 会让它拖进 Vue 运行时，测试就必须装 DOM 桩。
   *  - 网络只能有一个出口：手写 fetch 散开之后，401/非 JSON/超时的处理会各写一套
   *    （本项目历史上 20 处手写 fetch 演变成四五种错误语义），统一走 utils/api.ts。
   *    这一条由下面的 no-restricted-globals 配 no-restricted-imports 双重兜住：
   *    既拦「新写的 fetch」，也拦「绕过 api.ts 直连其他请求封装」。
   */
  {
    files: ['src/templates/**/*.vue'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/stores/*'],
              message: '模板只负责渲染：不要把 store 引进来。数据一律走 props。',
            },
            {
              group: ['@/composables/*'],
              message: '模板只负责渲染：分享页与 PDF 渲染不需要编辑器状态机。',
            },
            {
              group: ['@/utils/api', '@/utils/api.ts'],
              message: '模板不发请求：需要的数据由调用方传入。',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/utils/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/components/*'],
              message: 'src/utils 是纯逻辑层，必须能在 Node 里直接单测，不要依赖组件。',
            },
            {
              group: ['@/stores/*'],
              message: 'src/utils 不认识 Pinia：数据以参数传入、以返回值传出。',
            },
            {
              group: ['vue'],
              message: 'src/utils 应保持框架无关，才能在 Node 测试里直接跑。',
            },
          ],
        },
      ],
    },
  },

  {
    /*
     * components / pages / composables 一律走 @/utils/api 的 request()/requestBlob()。
     * 这里用 no-restricted-globals 而不是 no-restricted-imports：fetch 是浏览器全局，
     * 拦它才拦得住「手写一遍 fetch + 自己定义一套错误语义」这种漂移
     * （本项目历史上 20 处手写 fetch 演变成四五种错误语义）。
     * stores/ 与 utils/ 不在此列 —— 它们本来就该保持框架无关、网络无关。
     */
    files: ['src/components/**', 'src/pages/**', 'src/composables/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: '请走 @/utils/api 的 request()/requestBlob()：它统一了错误码与降级。',
        },
      ],
    },
  },

  {
    /*
     * 组件与页面里禁止 console：线上 console.error 会原样出现在用户浏览器里，
     * 且没有任何采集。需要提示用户的一律走 useToast；确实要给开发者的用 console.warn
     * 并在调用点写清为什么留。
     * tools/、server/、tests/ 不受此限（它们本来就跑在 Node，输出是产物）。
     */
    files: ['src/**/*.{js,ts,vue}'],
    rules: {
      'no-console': ['error', { allow: ['warn'] }],
    },
  },

  /*
   * no-console 的两处具名豁免。
   *
   * 这两处的 console.error 是**降级路径的信号**，不是调试残留：
   *  - templates/index.js：某个模板 chunk 加载失败（网络/缓存）时回退经典单栏，
   *    不报出来就变成「切模板没反应」这种查不到的静默失效；
   *  - utils/avatarStore.js：IndexedDB 不可用（隐私模式/配额满）时回退内联存储，
   *    用户看不到任何界面变化，只有控制台能说明存储条数为什么突然变大。
   * 其余位置一律走 useToast，不允许新增 console。
   */
  {
    files: ['src/templates/index.js', 'src/utils/avatarStore.js'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    // normalizeResume 的 RawRecord = Record<string, any> 是刻意的：    // 这个函数的职责就是逐字段收窄完全不可信的导入数据，入口处的 any 正是「尚未校验」的表达。
    // 换成 unknown 会在这里逼出十余处断言，把收窄逻辑本身搅浑，安全性并不会提高
    //（真正的边界是导入后的白名单与 normalizeResume 的产出类型）。
    files: ['src/data/normalizeResume.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  prettierConfig,
]
