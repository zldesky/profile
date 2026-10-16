"""简历工坊 favicon —— 定稿方案。

设计：蓝色底 + 纸色竖长纸张（A4 比例），纸上是挖空的标题条与正文行。
      读作「一张写好的简历」，而不是「深色圆角块 + 白色线性图标」那套通用语法。

历程与淘汰记录（避免以后重复踩）：
  - 汉字「简」做字形：16px 下笔画糊成一团，不可读 → 淘汰；
  - 文档 + 折角：折角在 16px 下不足 1px，看不出 → 淘汰；
  - 「圆角块 + 细线 layout 线框」：AI 生成图标的默认配方，且 layout 在应用里是
    编辑器模块图标、并非品牌符号 → 淘汰；
  - 纸色底 + 墨色文档：纸 #F7F4ED 对白色标签栏只有 1.10:1，图标外沿在浅色浏览器里
    完全消失 → 淘汰。标签栏有深有浅，必须选「大面积元素与两种底色都能区分」的一方。
  - 底板最终由墨色改为蓝色（用户要求）。选 #1C3A6E 而非更亮的蓝：亮蓝（如 #3B82F6）
    是 AI 生成配色里最泛滥的色相，且越亮纸/底对比越低（#1E64BE 只剩 5.28:1）。

配色：蓝 #1C3A6E、纸 #F7F4ED（纯平面、无渐变）。
      实测 纸/蓝 10.17:1、蓝/白标签栏 11.17:1、纸/深标签栏 14.66:1。
"""

import os

from PIL import Image, ImageDraw

SS = 16  # 超采样倍率

PLATE = (28, 58, 110)  # #1C3A6E 底板
PAPER = (247, 244, 237)  # #F7F4ED 纸张
PLATE_RADIUS = 0.17  # 底圆角占画布比例
PAGE_H = 20.4  # 纸张高度（24 单位视图盒）
PAGE_RATIO = 1.414  # A4 高宽比

ICO_SIZES = [16, 24, 32, 48, 64]


def page_mark(n):
    """纸色纸张剪影 + 挖空的标题条与两行正文；每条在 16px 下都占满整像素行。"""
    layer = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    k = n / 24.0

    h = PAGE_H
    w = h / PAGE_RATIO
    x0 = (24.0 - w) / 2
    y0 = (24.0 - h) / 2
    x1, y1 = x0 + w, y0 + h

    d.rounded_rectangle(
        (x0 * k, y0 * k, x1 * k, y1 * k), radius=1.6 * k, fill=(*PAPER, 255)
    )

    # 标题条粗而长、正文行细而短，靠粗细对比表达「标题 + 内容」
    pad = w * 0.17
    tx0, tx1 = x0 + pad, x1 - pad
    cy = y0 + h * 0.29
    d.rectangle(
        [tx0 * k, cy * k, (tx0 + (tx1 - tx0) * 0.88) * k, (cy + h * 0.09) * k],
        fill=(0, 0, 0, 0),
    )
    for i, ratio in enumerate((1.0, 0.62)):
        ly = cy + h * (0.19 + i * 0.135)
        d.rectangle(
            [tx0 * k, ly * k, (tx0 + (tx1 - tx0) * ratio) * k, (ly + h * 0.062) * k],
            fill=(0, 0, 0, 0),
        )
    return layer


def compose(size):
    n = size * SS
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle(
        (0, 0, n - 1, n - 1), radius=n * PLATE_RADIUS, fill=(*PLATE, 255)
    )
    img.alpha_composite(page_mark(n))
    return img.resize((size, size), Image.LANCZOS)


def build(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    icons = {s: compose(s) for s in ICO_SIZES}
    # ICO 内嵌多尺寸：标签栏取 16、书签与桌面快捷方式取 32/48，避免大尺寸被拉伸
    icons[ICO_SIZES[-1]].save(
        os.path.join(out_dir, 'favicon.ico'),
        format='ICO',
        sizes=[(s, s) for s in ICO_SIZES],
    )
    return icons


if __name__ == '__main__':
    import sys

    target = sys.argv[1] if len(sys.argv) > 1 else 'public'
    icons = build(target)
    for s in icons:
        print(f'{target}/favicon.ico 内嵌 {s}x{s} ok')
    print('favicon.ico bytes:', os.path.getsize(os.path.join(target, 'favicon.ico')))