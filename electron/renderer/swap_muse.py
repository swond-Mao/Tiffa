from PIL import Image
import os

session_dir = 'G:/Tiffa/data/agent/sessions/--wks-Tiffa开发--/2026-08-10T14-10-48-787Z_019fec03-0552-7000-b1ac-0d11be210db2/local'

# 新图1(暗底) -> tiffa-muse.png
img1 = Image.open(os.path.join(session_dir, 'image-463487b446d42704.webp')).convert('RGB')
img1.save('G:/Tiffa/electron/renderer/assets/tiffa-muse.png', 'PNG')
print('tiffa-muse.png replaced:', img1.size)

# 新图2(浅底) -> tiffa-muse-light.png
img2 = Image.open(os.path.join(session_dir, 'image-fd3fe7b4bb168324.webp')).convert('RGB')
img2.save('G:/Tiffa/electron/renderer/assets/tiffa-muse-light.png', 'PNG')
print('tiffa-muse-light.png replaced:', img2.size)
