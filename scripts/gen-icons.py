#!/usr/bin/env python3
"""生成启点（QiDian）应用图标 v2「极光起点」。

用法：python3 scripts/gen-icons.py --out DIR
设计规范（512 基准，SS=4 超采样抗锯齿）：
- 背景：深蓝黑 -> 靛蓝 的径向渐变（中心偏左上、四周渐深，纵深更强），
  顶部叠加一道极淡的玻璃高光，底部轻微暗角。
- 符号：三枚圆角方块（左下 / 左上 / 右下，应用网格语义，白色 88% 带投影）；
  右上「起点」为青 -> 蓝 渐变球体，外发光 + 白色高光 + 一圈细轨道环。
- 小尺寸分级：符号整体放大、光晕与轨道收敛，保证 16/24/32px 可读性。
"""

import argparse
import math
import os

from PIL import Image, ImageDraw, ImageFilter

# ── 512 基准参数 ──────────────────────────────────────────────
RADIUS_RATIO = 0.226            # 圆角半径 / 尺寸（Fluent 大圆角）
GRID_D = 88                     # 方块中心到中心的偏移
TILE_R = 34                     # 圆角方块半径（半边长）
TILE_RADIUS_R = 11              # 方块圆角
TILE_ALPHA = 224                # 方块透明度（约 88%）
HOT_R = 46                      # 起点球体半径
HOT_CORE_R = 30                 # 球体亮区半径
RING_R = 58                     # 轨道环半径
RING_W = 3.5                    # 轨道环线宽

# 背景：深蓝黑 -> 靛蓝（径向）
BG_DEEP = (8, 13, 44)           # 边缘
BG_MID = (19, 39, 112)          # 中段
BG_GLOW = (38, 74, 178)         # 中心偏上亮区
# 符号
TILE_COLOR = (255, 255, 255, TILE_ALPHA)
TILE_SHADOW = (0, 0, 10, 90)
HOT_EDGE = (8, 90, 186)         # 球体底部深蓝
HOT_MID = (21, 176, 255)        # 球体中段蓝
HOT_TOP = (82, 244, 255)        # 球体上部青
HOT_SPOT = (255, 255, 255, 255)  # 高光
GLOW_CYAN = (64, 240, 255, 255)  # 外发光
RING_COLOR = (110, 245, 255, 110)


def _grad256(top, mid, bottom, cx, cy, r_in, r_out) -> Image.Image:
    """256 基准径向渐变：中心(cx,cy)由内到外 top->mid->bottom。"""
    img = Image.new("RGB", (256, 256))
    px = img.load()
    r_out2 = r_out * r_out
    r_in2 = r_in * r_in
    for y in range(256):
        dy = y - cy
        for x in range(256):
            dx = x - cx
            d2 = dx * dx + dy * dy
            t = 0.0
            if d2 >= r_out2:
                t = 1.0
            elif d2 <= r_in2:
                t = 0.0
            else:
                t = (math.sqrt(d2) - r_in) / (r_out - r_in)
            if t < 0.5:
                k = t / 0.5
                r = round(top[0] + (mid[0] - top[0]) * k)
                g = round(top[1] + (mid[1] - top[1]) * k)
                b = round(top[2] + (mid[2] - top[2]) * k)
            else:
                k = (t - 0.5) / 0.5
                r = round(mid[0] + (bottom[0] - mid[0]) * k)
                g = round(mid[1] + (bottom[1] - mid[1]) * k)
                b = round(mid[2] + (bottom[2] - mid[2]) * k)
            px[x, y] = (r, g, b)
    return img


def draw_icon(size: int) -> Image.Image:
    """绘制一个尺寸的图标（SS 倍绘制后缩小抗锯齿）。"""
    SS = 4
    w = size * SS
    canvas = Image.new("RGBA", (w, w), (0, 0, 0, 0))

    # ── 小尺寸分级：符号放大、光晕/轨道收敛 ──
    if size <= 16:
        scale = 1.5
        blur_factor = 0.5
        ring_factor = 0.0       # 16px 隐藏轨道环，避免与方块糊成一团
        simplify_sphere = True
    elif size <= 24:
        scale = 1.3
        blur_factor = 0.62
        ring_factor = 0.0       # 24px 也隐藏轨道环，保证核心元素可辨
        simplify_sphere = True
    elif size <= 32:
        scale = 1.18
        blur_factor = 0.72
        ring_factor = 0.0       # 32px 也隐藏轨道环：小尺寸只保留 3 方块 + 青亮点，辨识度最高
        simplify_sphere = True
    else:
        scale = 1.0
        blur_factor = 0.85
        ring_factor = 1.0
        simplify_sphere = False

    # ── 背景：径向渐变（256 基准放大）──
    bg = _grad256(BG_GLOW, BG_MID, BG_DEEP, cx=118, cy=104, r_in=46, r_out=196)
    bg = bg.resize((w, w), Image.LANCZOS)

    mask = Image.new("L", (w, w), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, w - 1, w - 1], radius=int(w * RADIUS_RATIO), fill=255
    )
    canvas.paste(bg, (0, 0), mask)

    # ── 顶部玻璃高光（极淡，叠在背景上）──
    gloss = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    gw = w * 0.92
    gd.ellipse([w * 0.04, -w * 0.30, w * 0.96, w * 0.42], fill=(180, 215, 255, 46))
    gloss = gloss.filter(ImageFilter.GaussianBlur(w * 0.09))
    canvas = Image.alpha_composite(canvas, gloss)

    # 底部暗角（纵向渐变遮罩，加深底部）
    v = Image.new("L", (w, w), 0)
    vp = v.load()
    for y in range(w):
        t = max(0.0, (y / w - 0.45) / 0.55)
        val = int(t * 78)
        for x in range(w):
            vp[x, y] = val
    v = v.filter(ImageFilter.GaussianBlur(w * 0.08))
    shade = Image.new("RGBA", (w, w), (2, 6, 26, 255))
    canvas = Image.alpha_composite(canvas, Image.composite(shade, Image.new("RGBA", (w, w), (0, 0, 0, 0)), v))

    draw = ImageDraw.Draw(canvas)
    c = w / 2.0
    d = GRID_D / 512.0 * w * scale
    tile_r = TILE_R / 512.0 * w * scale
    tile_corner = max(3, int(TILE_RADIUS_R / 512.0 * w * scale))

    # ── 三枚圆角方块 + 投影（小尺寸不透明、无投影，最大化对比）──
    tiles = [(-1, -1), (-1, 1), (1, 1)]
    tile_fill = (255, 255, 255, 255) if simplify_sphere else TILE_COLOR
    shadow_layer = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    body_layer = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body_layer)
    for dx, dy in tiles:
        x, y = c + dx * d, c + dy * d
        box = [x - tile_r, y - tile_r, x + tile_r, y + tile_r]
        if not simplify_sphere:
            sd.rounded_rectangle(
                [box[0], box[1] + tile_r * 0.16, box[2], box[3] + tile_r * 0.16],
                radius=tile_corner,
                fill=TILE_SHADOW,
            )
        bd.rounded_rectangle(box, radius=tile_corner, fill=tile_fill)
    if not simplify_sphere:
        shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(w * 0.012))
    canvas = Image.alpha_composite(canvas, shadow_layer)
    canvas = Image.alpha_composite(canvas, body_layer)

    # ── 右上起点：外发光 + 青蓝渐变球体 + 高光 + 轨道环 ──
    hx, hy = c + d, c - d
    hot = HOT_R / 512.0 * w * scale

    # 外发光（青色，多层高斯衰减）
    glow_layer = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    gld = ImageDraw.Draw(glow_layer)
    gld.ellipse([hx - hot, hy - hot, hx + hot, hy + hot], fill=GLOW_CYAN)
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(hot * blur_factor))
    canvas = Image.alpha_composite(canvas, glow_layer)

    # 球体（大尺寸：上青下蓝渐变球体；小尺寸：高对比实心亮点）
    body = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    bd2 = ImageDraw.Draw(body)
    if simplify_sphere:
        bd2.ellipse([hx - hot, hy - hot, hx + hot, hy + hot], fill=HOT_TOP)
    else:
        bd2.ellipse([hx - hot, hy - hot, hx + hot, hy + hot], fill=HOT_EDGE)
        bd2.ellipse(
            [hx - hot, hy - hot * 0.55, hx + hot, hy + hot], fill=HOT_MID
        )
        bd2.ellipse(
            [hx - hot, hy - hot, hx + hot * 0.98, hy + hot * 0.45], fill=HOT_TOP
        )
    canvas = Image.alpha_composite(canvas, body)

    # 中心高光（大尺寸保留，小尺寸纯色亮点已足够）
    if not simplify_sphere:
        spot_r = HOT_CORE_R / 512.0 * w * scale
        spot = Image.new("RGBA", (w, w), (0, 0, 0, 0))
        spd = ImageDraw.Draw(spot)
        spd.ellipse(
            [hx - spot_r * 0.55, hy - spot_r * 0.75, hx + spot_r * 0.95, hy + spot_r * 0.75],
            fill=HOT_SPOT,
        )
        spot = spot.filter(ImageFilter.GaussianBlur(w * 0.006))
        canvas = Image.alpha_composite(canvas, spot)

    # 轨道环（起点外一圈细环，小尺寸隐藏）
    if ring_factor > 0:
        ring_r = RING_R / 512.0 * w * scale * ring_factor
        ring_w = max(1.2, RING_W / 512.0 * w * scale)
        ring = Image.new("RGBA", (w, w), (0, 0, 0, 0))
        rd = ImageDraw.Draw(ring)
        rd.ellipse(
            [hx - ring_r, hy - ring_r, hx + ring_r, hy + ring_r],
            outline=RING_COLOR,
            width=int(ring_w * SS * 0.5),
        )
        canvas = Image.alpha_composite(canvas, ring)

    return canvas.resize((size, size), Image.LANCZOS)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="icon-preview", help="输出目录")
    args = parser.parse_args()

    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    for size in (16, 24, 32, 48, 64, 128, 256, 512):
        draw_icon(size).save(os.path.join(out, f"{size}x{size}.png"))
    draw_icon(256).save(os.path.join(out, "128x128@2x.png"))
    draw_icon(512).save(os.path.join(out, "icon.png"))
    draw_icon(256).save(
        os.path.join(out, "icon.ico"),
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"已生成到 {out}")


if __name__ == "__main__":
    main()
