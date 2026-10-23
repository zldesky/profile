# CLAUDE.md

本仓库的 AI 协作规则**只有一份**，在 [`.agent/AGENTS.md`](./.agent/AGENTS.md)。

动代码前按顺序读：`.agent/AGENTS.md` → `README.md` → `PITFALLS.md` → 你要改的那个文件。

请**不要**在这个文件里追加规则。规则只改 `.agent/AGENTS.md`，否则两份迟早互相矛盾，
而矛盾的规则比没有规则更容易让 AI 做出错误决定。

## 改完必须跑

```sh
npm run check        # typecheck + lint + test
npm run build        # 动过 .vue 就要跑：多语句行内事件只有 build 才会报
npm run format:check
```

`src/` 的样式一律从 `src/styles/paper.css` 的 `:root` 取 `--ed-*` 令牌，不要写字面量。
