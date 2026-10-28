"""生成启点（QiDian）应用图标 v3「朱砂起点」。

用法：python3 scripts/gen-icons.py --out DIR
设计规范（1024 基准，SS=4 超采样抗锯齿）：
- 底板：暖白瓷质 squircle（左上 #FBF8F2 -> 右下 #E7DFCF 线性渐变），
  叠加左上角柔和白色高光与 7% 墨色内描边，模拟釉面质感。
- 符号：一条墨色圆头斜线自左下升起，末端为直角箭头；起点是一枚朱砂色圆点。
  语义是「从这里出发 / 启动」，构图为单一对角线，缩到 16px 仍然可读。
- 小尺寸分级：<=24px 时符号整体放大 8% 并加粗，避免线条糊成一团。

配色（三色，克制且高对比）：
    瓷白底 #FBF8F2 / #E7DFCF   墨色 #14161A   朱砂 #B4472F
"""

import argparse
import os

from PIL import Image, ImageDraw, ImageFilter

# ── 1024 基准参数（与 src-tauri/icons/qidian.svg 保持一致）──────
RADIUS_RATIO = 236 / 1024          # squircle 圆角半径占比
BASE = 1024.0

BG_TOP = (251, 248, 242)           # #FBF8F2
BG_BOTTOM = (231, 223, 207)        # #E7DFCF
STROKE_INK = (20, 22, 26)          # #14161A
ACCENT = (180, 71, 47)             # #B4472F

DOT_C = (336.0, 688.0)             # 朱砂起点圆心
DOT_R = 64.0
LINE_START = DOT_C
LINE_END = (700.0, 324.0)          # 斜线终点（箭头尖端）
LINE_W = 84.0
HEAD_ELBOW = (510.0, 324.0)        # 箭头折线起点
HEAD_CORNER = (700.0, 324.0)       # 箭头折角
HEAD_END = (700.0, 514.0)          # 箭头下垂终点


def _background(w: int) -> Image.Image:
    """暖白瓷质渐变底（左上亮、右下暖），再叠一层很轻的釉面反光。"""
    base = Image.new("RGB", (256, 256))
    px = base.load()
    for y in range(256):
        for x in range(256):
            t = (0.35 * (x / 255.0) + (y / 255.0)) / 1.35
            px[x, y] = (
                round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
                round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
                round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
            )
    bg = base.resize((w, w), Image.BICUBIC).convert("RGBA")

    sheen = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    sd.ellipse(
        [-w * 0.22, -w * 0.30, w * 0.72, w * 0.52],
        fill=(255, 255, 255, 88),
    )
    sheen = sheen.filter(ImageFilter.GaussianBlur(w * 0.12))
    return Image.alpha_composite(bg, sheen)


def draw_icon(size: int) -> Image.Image:
    """绘制指定尺寸的图标。"""
    SS = 8 if size <= 64 else 4
    w = size * SS
    canvas = Image.new("RGBA", (w, w), (0, 0, 0, 0))

    # 小尺寸放大并加粗符号，保证可读性
    scale = 1.08 if size <= 24 else 1.0
    line_w = LINE_W * (1.06 if size <= 24 else 1.0)

    mask = Image.new("L", (w, w), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, w - 1, w - 1], radius=int(w * RADIUS_RATIO), fill=255
    )
    canvas.paste(_background(w), (0, 0), mask)

    def px(point: tuple[float, float]) -> tuple[float, float]:
        cx = cy = w / 2.0
        return (
            cx + (point[0] - BASE / 2) / BASE * w * scale,
            cy + (point[1] - BASE / 2) / BASE * w * scale,
        )

    unit = w / BASE
    dot_r = DOT_R * unit * scale
    stroke = max(2, int(round(line_w * unit)))

    # 朱砂起点
    draw = ImageDraw.Draw(canvas)
    dc = px(DOT_C)
    draw.ellipse(
        [dc[0] - dot_r, dc[1] - dot_r, dc[0] + dot_r, dc[1] + dot_r], fill=ACCENT
    )

    # 墨色斜线 + 箭头（圆头圆角，端点收在起点圆内）
    draw.line([px(LINE_START), px(LINE_END)], fill=STROKE_INK, width=stroke)
    draw.line(
        [px(HEAD_ELBOW), px(HEAD_CORNER), px(HEAD_END)],
        fill=STROKE_INK,
        width=stroke,
        joint="curve",
    )
    for point in (px(LINE_START), px(LINE_END), px(HEAD_ELBOW), px(HEAD_END)):
        r = stroke / 2.0
        draw.ellipse(
            [point[0] - r, point[1] - r, point[0] + r, point[1] + r], fill=STROKE_INK
        )

    # 7% 墨色内描边，勾出底板轮廓
    edge = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle(
        [0, 0, w - 1, w - 1],
        radius=int(w * RADIUS_RATIO),
        outline=(*STROKE_INK, 18),
        width=max(1, int(round(6 * unit))),
    )
    canvas = Image.alpha_composite(canvas, edge)

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

    ico = draw_icon(256)
    ico_path = os.path.join(out, "icon.ico")
    # NSIS / Explorer 对 BMP 编码的小尺寸更稳；有 ImageMagick 时优先用它，
    # 否则退回 Pillow（全 PNG 编码，Windows 10/11 也能识别）。
    try:
        import subprocess

        tmp = os.path.join(out, "icon-256.tmp.png")
        ico.save(tmp)
        subprocess.run(
            [
                "convert",
                tmp,
                "-define",
                "icon:auto-resize=256,128,64,48,32,24,16",
                ico_path,
            ],
            check=True,
        )
        os.remove(tmp)
    except Exception:
        ico.save(
            ico_path,
            format="ICO",
            sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
        )
    print(f"已生成到 {out}")


if __name__ == "__main__":
    main()
