# 在外编辑器里写简历（Markdown 内容源）

同一份 Markdown 简历，三种用法：

| 方式 | 编辑器         | 你要装什么             | 导出 PDF 靠什么                |
| ---- | -------------- | ---------------------- | ------------------------------ |
| A    | **VSCode**     | Markdown PDF 扩展      | 扩展自带（内部用 Chromium）    |
| B    | **Typora**     | 无（复制一个主题文件） | Typora 的「文件 → 导出 → PDF」 |
| C    | **Obsidian**   | 无（复制一个片段文件） | Obsidian 的「导出为 PDF」      |
| D    | **Web 编辑器** | 无                     | 一键导出矢量 PDF（文本可选中） |

前三种是「不想开浏览器 / 习惯在自己的笔记软件里维护」时的那条路，
与 Web 编辑器读的是**同一份 `.md`**：在 VSCode 里改完，导回 Web 编辑器就能可视化编辑与出矢量 PDF。

> **格式由代码定义，不靠约定人情。** 约定写在
> [`src/utils/markdownSource.ts`](../src/utils/markdownSource.ts) 的文件头，
> 而模板文件 [`templates/resume.md`](./templates/resume.md) 是**由应用自己的导出器生成的**
> （`npm run build:host-template`）—— 手写模板一定会与格式漂移。

---

## 格式速览

```markdown
# 姓名 一级标题 = 姓名块

**职位** 独占一行的粗体 = 职位

- **标签**：值 基本信息字段

## 模块标题 二级标题 = 模块（栏）

<!-- resume:type=entries --> 类型提示（渲染时不可见，导回应用时用它精确还原）

### 机构 · 职位 三级标题 = 条目（「 · 」分隔机构与职位）

2022-06 - 至今 紧跟标题的普通行 = 时间

- **标签**：值 条目的补充字段
- 要点文本 条目的要点
- **标签**：值 网格项 / 技能的描述字段
- 技能名 技能条目（没有冒号）
  普通段落 文本模块（自我评价）
  --- 分页标记（多页简历时手动指定分页位置）
```

### 两条容易踩的规则

1. **键值行的标签必须加粗**（`- **标签**：值`）。
   中文要点里出现冒号很常见（「重构了构建流程：耗时降 90%」）。
   如果不加粗，导入时无法区分「补充字段」和「要点」——
   往返一次，带冒号的要点会被**静默改成补充字段**：改了你的数据还不报错。
   加粗是那个无歧义的标记。加粗对 ATS 纯文本提取没有影响。

2. **别删 `<!-- resume:type=… -->` 那几行。**
   它们在渲染结果里不可见（HTML 注释），但导入时用来确定模块类型。
   删掉之后类型只能靠内容猜：纯键值的会被当成「键值网格」，
   而带冒号的要点会被当成补充字段。

---

## A. VSCode

1. 在本目录打开（`code markdown-hosts`），或把 `resume.css` 与 `templates/resume.md` 复制进你的项目。
2. 安装扩展 **Markdown PDF**（`yzane.markdown-pdf`）。
3. 打开 `templates/resume.md`，右上角点预览图标可以实时看排版。
4. 右键 → **Markdown PDF: Export (pdf)** 导出。

本目录已经带好 `.vscode/settings.json`：它会加载 `resume.css`，并把页面边距设成与版心匹配。

> 注意：其他 Markdown 插件可能会影响预览效果。若预览与导出的 PDF 不一致，
> 先排查是不是别的插件改了渲染。

## B. Typora

1. Typora 菜单 **偏好设置 → 外观 → 打开主题文件夹**。
2. 把 `resume.css` 复制进去，改名成 `resume-workshop.css`（Typora 的主题名取自文件名）。
3. 重启 Typora，在 **主题** 菜单里选 `Resume Workshop`。
4. 打开 `templates/resume.md` 编辑，**文件 → 导出 → PDF**。

## C. Obsidian

1. 把 `markdown-hosts` 目录作为一个 **Vault** 打开（或复制文件进你现有的 Vault）。
2. **设置 → 外观 → CSS 片段 → 打开片段文件夹**，把 `resume.css` 复制进去。
3. 回到设置里刷新片段列表，启用 `resume`。
4. 打开 `templates/resume.md`，用 **导出为 PDF** 出文件。

> Obsidian 的导出用的是预览样式，所以片段启用后导出效果与预览一致。

## D. 导回 Web 编辑器

编辑器顶栏 **导入数据 → Markdown 简历导入**，选中你的 `.md` 即可。

**它只还原内容。** 主题（颜色 / 字体 / 字号 / 页边距）、模板 id、模块布局（对齐 / 缩进 / 列数）、
头像**都不在 Markdown 里**，导入后会取默认值 —— 也就是说
**Markdown 是「内容的源」，不是「整份文档的源」**。
想要完全复原，用 **导出数据 → JSON 数据备份**。

反过来，编辑器顶栏 **导出数据 → Markdown 内容源** 会把当前简历写成符合上面格式的 `.md`，
可以直接拿去在这三个编辑器里继续维护。

---

## 自定义样式

改 [`resume.css`](./resume.css) 顶部的 `:root` 变量即可，版面细节都从这些变量推导：

```css
:root {
  --text-size: 10.5pt; /* 正文字号 */
  --line-height: 1.7; /* 行高 */
  --text-color: #2b2f36; /* 正文颜色（要打印建议改纯黑） */
  --accent: #1f2937; /* 主题色：姓名下划线、栏标题竖条、列表点 */
  --muted: #6b7280; /* 次级文字：职位、时间、联系方式 */
  --content-width: 200mm; /* 版心宽度 */
  --section-gap: 1.1em; /* 栏与栏之间 */
  --entry-gap: 0.75em; /* 条目与条目之间 */
  --print-margin: 14mm 14mm 14mm 14mm; /* 打印页边距：上 右 下 左 */
}
```

各宿主的挂载点不同（Typora 的 `#write`、Obsidian 的 `.markdown-preview-view`、VSCode 的 `body`），
但渲染出来的 HTML 是同一套标签，所以样式规则以标准标签为主，只在必要处补宿主专属作用域。

## 文件说明

| 文件                    | 用途                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `resume.css`            | 主题样式，三个宿主共用一份                                            |
| `templates/resume.md`   | 起始模板，由应用导出器生成（`npm run build:host-template`）           |
| `.vscode/settings.json` | VSCode 下加载主题、设定页边距                                         |
| `preview/`              | 主题的本地预览（`npm run preview:host-theme` 生成，用于肉眼检查排版） |
