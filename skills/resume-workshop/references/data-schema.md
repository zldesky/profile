# resume JSON 数据结构（服务端白名单忠实转述）

本文档与 `server/sanitize.js` 一一对应：这里写明的就是服务端会接受的；没写明的键会被
丢弃，越界的值会被静默钳制或回退默认值——**不会报错**，所以不要依赖越界写法。

顶层只有四个键会被接受（`version` 服务端强制为 2，不用传）：

```jsonc
{
  "template": "classic",       // 模板 id，见下表；非法值回退 classic
  "theme":     { ... },       // 全局样式，全部键都有默认值，可不传
  "basics":    { ... },       // 基本信息
  "sections":  [ ... ]        // 唯一必填字段，缺了直接 400；数组顺序 = 渲染顺序
}
```

不要给任何对象写 `id`：服务端一律重新生成，写了也会被丢弃。

## template 模板（12 选 1）

| id         | 模板                                                                   | 适合                                                                     |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `classic`  | 经典单栏                                                               | 通用稳重（默认）                                                         |
| `sidebar`  | 左侧色栏                                                               | 互联网、设计                                                             |
| `twocol`   | 双栏紧凑                                                               | 经验丰富、内容多                                                         |
| `timeline` | 时间轴                                                                 | 职业路径清晰的成长型简历                                                 |
| `minimal`  | 极简留白                                                               | 学术、研究、外企                                                         |
| `banner`   | `business` / `cards` / `rightbar` / `labelcol` / `flowcols` / `custom` | 其余风格；`custom` 的自由布局参数（customLayout）无法经 API 设置，走默认 |

## theme 全局样式（键：默认值，可钳制范围）

```jsonc
{
  "accent": "#000000", // 主题色，#RRGGBB 六位十六进制；非法回退纯黑
  "text": "#2b2f36", // 正文色
  "fontKey": "yahei", // 字体，可选：yahei sourceHei pingfang dengxian heiti
  //   sourceSong songti fangsong kaiti arial helvetica times georgia calibri
  "fs": 1, // 字号缩放 0.6 ~ 1.6
  "lh": 1.75, // 行高 1 ~ 3
  "gap": 1, // 模块间距 0.3 ~ 3
  "mv": 12,
  "mh": 14, // 页边距（毫米）5 ~ 40；页边距过小会挤爆版面
  "titleStyle": "fill", // 模块标题：fill pill gradient underline bar boxed center leader plain
  "titleMarker": "square", // 标题标记：square diamond circle ring triangle bar none
  "titleGap": 0.5, // 0 ~ 3
  "titleMargin": 0.55, // 0 ~ 3
  "titleBottom": "none", // 标题底边线：none solid dashed dotted gradient double trapezoid ribbon chevron
  "titleBottomWidth": 100, // 5 ~ 100（百分比）
  "titleBottomThickness": 2, // 0.5 ~ 12（px）
  "titleBottomGap": 4, // 0 ~ 40（px）
  "titleBottomAlign": "left", // left center right
}
```

## basics 基本信息

| 字段                           | 类型与限制                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `name`                         | ≤ 40 字                                                                                         |
| `jobTitle`                     | ≤ 60 字，会显示在姓名旁                                                                         |
| `avatar`                       | 头像，仅接受 dataURL（见下）；不用头像传 `""`                                                   |
| `showAvatar`                   | 默认 `true`；无头像时置 `false`                                                                 |
| `avatarShape`                  | `square` / `rounded` / `circle`                                                                 |
| `avatarWidth` / `avatarHeight` | 毫米，10~~80 / 10~~100；默认 25×35（一寸照）                                                    |
| `avatarPos`                    | `{ "dx": -300~300, "dy": -100~200 }`，毫米级位置微调                                            |
| `fields`                       | 联系方式数组（≤ 30 项），每项 `{ "icon", "label", "value" }`，`label` ≤ 60 字，`value` ≤ 300 字 |

`icon` 可选值：`cake user phone mail location briefcase clock coin school star link github award none`

## sections 模块（≤ 40 个）

每个模块的公共字段：

```jsonc
{
  "type": "grid",            // grid | entries | skills | text，非法值回退 text
  "title": "模块标题",        // ≤ 60 字
  "visible": true,           // false = 保留数据但不渲染
  "layout": {
    "align": "inherit",      // inherit left center right
    "indent": 0,             // -40 ~ 80（px）
    "extraGap": 0,           // -40 ~ 80（px）
    "columns": "auto"        // "auto" | "1" | "2" | "3" | "4"（字符串）
  },
  ...按 type 二选一的字段
}
```

### type: `grid` — 键值网格（求职意向、荣誉、证书、作品集）

```jsonc
{ "items": [{ "icon": "briefcase", "label": "求职岗位", "value": "前端开发工程师" }] } // ≤ 60 项
```

### type: `entries` — 条目列表（教育、工作、实习、项目、校园）

```jsonc
{
  "showLogo": false, // 是否渲染机构 logo
  "items": [
    // ≤ 60 条，按时间倒序
    {
      "time": "2022-06 - 至今", // ≤ 60 字
      "org": "公司 / 学校 / 项目名", // ≤ 60 字
      "role": "职位 / 专业", // ≤ 60 字
      "logo": "", // 机构图标 dataURL，可空
      "meta": [{ "label": "专业成绩", "value": "GPA 3.8/4.0" }], // ≤ 20 项，value ≤ 500 字
      "bullets": [{ "text": "动作 + 事项 + 量化结果" }], // ≤ 60 条，每条 ≤ 2000 字
    },
  ],
}
```

### type: `skills` — 技能特长

```jsonc
{
  "showBars": false, // 熟练度进度条开关
  "fields": [{ "label": "技术栈", "value": "≤ 500 字的描述" }], // ≤ 20 项
  "items": [{ "name": "技能名", "level": 80 }], // ≤ 60 项，level 0 ~ 100
}
```

### type: `text` — 段落文本（自我评价）

```jsonc
{ "content": "≤ 2000 字的纯文本" }
```

## 图片规则

只接受内联 dataURL：`data:image/png|jpeg|webp|gif;base64,...`，单张 ≤ 3MB。
外链 URL、SVG、缺 base64 前缀的字符串**一律被清成空**，不会报错。
头像建议 ≤ 300KB，过大显著拖慢渲染。

## 数量与长度上限速查

| 项                      | 上限 | 说明                     |
| ----------------------- | ---- | ------------------------ |
| sections                | 40   | 超出静默截断             |
| 每模块条目              | 60   |                          |
| 每条目要点              | 60   | 一页纸建议全简历 ≤ 18 条 |
| 每条目 meta             | 20   |                          |
| basics.fields           | 30   |                          |
| 长文本（要点/正文）     | 2000 |                          |
| 中文本（meta.value）    | 500  |                          |
| 短文本（label/time 等） | 60   | 姓名 40                  |
| 图片单张                | 3MB  | 仅 dataURL               |
