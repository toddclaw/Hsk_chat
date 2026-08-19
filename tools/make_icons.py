#!/usr/bin/env python3
"""Generate the PWA icons. Run only when the icon design changes."""
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
BG, FG, RING = (15, 19, 23), (232, 237, 242), (106, 169, 255)

def make(size, path):
    scale = 4
    s = size * scale
    img = Image.new("RGBA", (s, s), BG + (255,))
    d = ImageDraw.Draw(img)
    pad = int(s * 0.09)
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=int(s * 0.16),
                        outline=RING + (255,), width=max(2, int(s * 0.03)))
    f = ImageFont.truetype(FONT, int(s * 0.5))
    box = d.textbbox((0, 0), "话", font=f)
    d.text(((s - box[2] - box[0]) / 2, (s - box[3] - box[1]) / 2 - int(s * 0.01)),
           "话", font=f, fill=FG + (255,))
    img.resize((size, size), Image.LANCZOS).save(path)
    print(path, size)

if __name__ == "__main__":
    make(192, "icon-192.png")
    make(512, "icon-512.png")
