const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// 项目根目录（本脚本位于 electron/ 下）
const ROOT = path.resolve(__dirname, '..');
const PYTHON = path.join(ROOT, 'python', 'python.exe');
const NODE = path.join(ROOT, 'node', 'node.exe');
const ResEdit = require(path.join(ROOT, 'electron', 'node_modules', 'resedit'));

const srcPng = path.join(ROOT, 'electron', 'assets', 'tiffa-icon.png');
const outIco = path.join(ROOT, 'electron', 'assets', 'tiffa-icon.ico');
const outIconsDir = path.join(ROOT, 'electron', 'assets', 'icons');
const exePath = path.join(ROOT, 'tiffa-desktop.exe');
const bakPath = exePath + '.bak';

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngVariants = [16, 32, 48, 64, 128, 256, 512];

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || 'unknown error');
    throw new Error(`${cmd} ${args.join(' ')} failed with ${r.status}`);
  }
  return r.stdout || '';
}

function generateIco() {
  const pyScript = `
import os, struct, io
from PIL import Image

src = Image.open(r'${srcPng.replace(/\\/g, '\\\\')}', 'r').convert('RGBA')
size = max(src.size)
square = Image.new('RGBA', (size, size), (0,0,0,0))
square.paste(src, ((size - src.width) // 2, (size - src.height) // 2), src)

sizes = [${sizes.join(', ')}]
imgs = [square.resize((s, s), Image.Resampling.LANCZOS) for s in sizes]

os.makedirs(r'${outIconsDir.replace(/\\/g, '\\\\')}', exist_ok=True)
for s in [${pngVariants.join(', ')}]:
    square.resize((s, s), Image.Resampling.LANCZOS).save(
        os.path.join(r'${outIconsDir.replace(/\\/g, '\\\\')}', f'icon-{s}.png')
    )

pngs = []
for im in imgs:
    buf = io.BytesIO()
    im.save(buf, format='PNG')
    pngs.append(buf.getvalue())

header = struct.pack('<HHH', 0, 1, len(imgs))
dir_size = 16 * len(imgs)
offset = 6 + dir_size
entries = b''
data = b''
for im, png in zip(imgs, pngs):
    w, h = im.size
    wb = 0 if w >= 256 else w
    hb = 0 if h >= 256 else h
    entries += struct.pack('<BBBBHHII', wb, hb, 0, 0, 1, 32, len(png), offset)
    data += png
    offset += len(png)

with open(r'${outIco.replace(/\\/g, '\\\\')}', 'wb') as f:
    f.write(header + entries + data)
print('OK: wrote', r'${outIco.replace(/\\/g, '\\\\')}')
`;
  const tmpPy = path.join(ROOT, 'local_cache', '_build_icon.py');
  fs.mkdirSync(path.dirname(tmpPy), { recursive: true });
  fs.writeFileSync(tmpPy, pyScript, 'utf8');
  try {
    run(PYTHON, [tmpPy], ROOT);
  } finally {
    try { fs.unlinkSync(tmpPy); } catch {}
  }
}

function patchExeIcon() {
  if (!fs.existsSync(bakPath)) {
    fs.copyFileSync(exePath, bakPath);
    console.log('backup ->', bakPath);
  }

  const data = fs.readFileSync(exePath);
  const exe = ResEdit.NtExecutable.from(data, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const icoBuf = fs.readFileSync(outIco);
  const iconFile = ResEdit.Data.IconFile.from(icoBuf);
  console.log('ico sub-images:', iconFile.icons.length);

  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1,
    0,
    iconFile.icons.map((item) => item.data)
  );

  res.outputResource(exe);
  const newBinary = exe.generate();
  const buf = Buffer.from(newBinary);

  if (buf[0] !== 0x4d || buf[1] !== 0x5a) {
    throw new Error('result is not a valid PE (missing MZ header)');
  }

  const exe2 = ResEdit.NtExecutable.from(buf, { ignoreCert: true });
  const res2 = ResEdit.NtExecutableResource.from(exe2);
  const hasIcon = res2.entries.some((e) => e.type === 14);
  if (!hasIcon) {
    throw new Error('icon group was not written');
  }

  const tmpPath = exePath + '.new';
  fs.writeFileSync(tmpPath, buf);
  fs.copyFileSync(tmpPath, exePath);
  try { fs.unlinkSync(tmpPath); } catch {}
  console.log('OK: embedded icon into', exePath, '| new size:', buf.length, 'bytes');
}

function main() {
  if (!fs.existsSync(srcPng)) {
    console.error('source icon not found:', srcPng);
    process.exit(1);
  }
  if (!fs.existsSync(PYTHON)) {
    console.error('project python not found:', PYTHON);
    process.exit(1);
  }

  console.log('Generating multi-resolution ICO and PNG variants...');
  generateIco();

  console.log('Embedding icon into', exePath, '...');
  patchExeIcon();

  console.log('All done.');
}

main();
