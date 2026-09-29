import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

/**
 * 编码规范：ESLint 管代码质量与 Vue 特有陷阱，格式（缩进/引号/换行）
 * 一律交给 Prettier —— 两边抢格式只会互相打架，这是官方推荐的分工。
 *
 * 配置分层：
 *  - 全部源码：js.recommended + vue/essential（拦截响应性丢失、v-html、key 缺失等）；
 *  - src：浏览器全局（window、localStorage…）；
 *  - server / tests / 根配置：Node 全局（process、import.meta…）；
 *  - prettier 关闭所有与格式化冲突的风格规则，必须放在最后。
 */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'server/.data/**'],
  },

  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],

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
    files: ['server/**', 'tests/**', '*.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    // render.js 里的 page.evaluate / addInitScript 回调运行在浏览器页面里，
    // 出现 document / window 是正常的
    files: ['server/render.js'],
    languageOptions: {
      globals: { ...globals.node, window: 'readonly', document: 'readonly' },
    },
  },

  {
    // sanitize.js 的职责就是清洗控制字符（正文去不可见字符、文件名去 CR/LF），
    // 控制字符正则在这里是业务本身而不是笔误
    files: ['server/sanitize.js'],
    rules: {
      'no-control-regex': 'off',
    },
  },

  prettierConfig,
]
