from PIL import Image
import os

def analyze(path, name):
    img = Image.open(path).convert('RGB')
    img2 = img.resize((100,100))
    px = list(img2.getdata())
    n = len(px)
    avg_r = sum(p[0] for p in px)/n
    avg_g = sum(p[1] for p in px)/n
    avg_b = sum(p[2] for p in px)/n
    brightness = (avg_r*299 + avg_g*587 + avg_b*114)/1000
    dark_pixels = sum(1 for p in px if (p[0]+p[1]+p[2])/3 < 80) / n * 100
    bright_pixels = sum(1 for p in px if (p[0]+p[1]+p[2])/3 > 180) / n * 100
    print(f'{name}: size={img.size} avgRGB=({avg_r:.0f},{avg_g:.0f},{avg_b:.0f}) brightness={brightness:.1f} dark%={dark_pixels:.1f} bright%={bright_pixels:.1f}')

session_dir = 'G:/Tiffa/data/agent/sessions/--wks-Tiffa开发--/2026-08-10T14-10-48-787Z_019fec03-0552-7000-b1ac-0d11be210db2/local'
analyze(os.path.join(session_dir, 'image-463487b446d42704.webp'), 'new1')
analyze(os.path.join(session_dir, 'image-fd3fe7b4bb168324.webp'), 'new2')
analyze('G:/Tiffa/electron/renderer/assets/tiffa-muse.png', 'orig_dark')
analyze('G:/Tiffa/electron/renderer/assets/tiffa-muse-light.png', 'orig_light')
