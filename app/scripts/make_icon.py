# -*- coding: utf-8 -*-
"""生成墨纸应用图标：暖纸底圆角 + 朱砂印章「墨」"""
from PIL import Image, ImageDraw, ImageFont

SZ = 256
ROUND = 56
PAPER = (245, 239, 227, 255)     # #F5EFE3 暖纸
SEAL = (181, 64, 42, 255)        # #B5402A 朱砂

img = Image.new("RGBA", (SZ, SZ), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角纸底
d.rounded_rectangle([0, 0, SZ - 1, SZ - 1], radius=ROUND, fill=PAPER)

# 朱砂印章方框（细边、内嵌）
inset = 44
box = [inset, inset, SZ - 1 - inset, SZ - 1 - inset]
d.rounded_rectangle(box, radius=14, outline=SEAL, width=10)

# 「墨」楷体、居中
font = ImageFont.truetype(r"C:\Windows\Fonts\simkai.ttf", 108)
tb = d.textbbox((0, 0), "墨", font=font)
w, h = tb[2] - tb[0], tb[3] - tb[1]
d.text(((SZ - w) / 2 - tb[0], (SZ - h) / 2 - tb[1]), "墨", font=font, fill=SEAL)

# 右下小点（未读徽记意象）
d.ellipse([SZ - 64, SZ - 64, SZ - 40, SZ - 40], fill=SEAL)

out = r"D:\Workspace\personal\reader\app\resources"
import os
os.makedirs(out, exist_ok=True)
img.save(os.path.join(out, "icon.png"))
# 托盘专用小图
img.resize((32, 32), Image.LANCZOS).save(os.path.join(out, "tray.png"))
img.resize((16, 16), Image.LANCZOS).save(os.path.join(out, "tray-16.png"))
print("ok", os.listdir(out))
