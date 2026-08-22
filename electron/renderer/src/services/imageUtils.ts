/**
 * imageUtils — 图片压缩管线（2026-08-21）
 *
 * 目标位置：electron/renderer/src/services/imageUtils.ts
 *（基础目录禁止 AI 新建文件，本文件由 AI 暂存于 workspace，需手动复制到目标位置）
 *
 * 分层设计：
 * - 发送层：自动压缩（最长边 1568px，JPEG q0.85 起步，字节上限 2MB）。
 *   视觉 API 对超过 ~1568px 长边的图本来就会自行缩放，发原尺寸纯浪费；
 *   且会话历史每轮全量重发，超大图片是复利成本。
 * - UI 层：chip 预览用缩略图（最长边 480px），避免 DOM 里挂全尺寸 base64。
 * - 磁盘引用层：拖入/附件图片经 getPathForFile 附带原图路径（MessageImage.path），
 *   消息文本由 InputBox 追加路径引用，agent 需要像素级细节时用 read 工具读原图。
 *
 * 规则：
 * - 小图直通：≤300KB 且最长边 ≤1568px 的原图不二次编码
 * - EXIF 方向按 from-image 校正；GIF 取首帧
 * - 可能含透明的格式（png/webp/gif）压 JPEG 前铺白底，避免透明区变黑
 * - 解码失败（HEIC 等）：≤5MB 原样直通，超过则拒绝（返回 null，调用方 toast）
 *
 * 说明：renderer tsconfig lib=ES2022，无 Promise.withResolvers，
 * 故按代码库现有惯例使用 executor 形式包装 FileReader/canvas 回调。
 */

export interface ProcessedImage {
  /** 发送版 base64（压缩后 ≤~2MB；小图为原图） */
  data: string;
  /** 发送版 MIME（压缩后为 image/jpeg；直通时保持原格式） */
  mimeType: string;
  /** 文件名（展示用） */
  name?: string;
  /** 原图磁盘路径（仅拖入/附件有；粘贴/快照无） */
  path?: string;
  /** chip 预览用完整 data URL（JPEG，最长边 480px） */
  thumbnail?: string;
}

const MAX_SEND_SIDE = 1568;
const MAX_SEND_BYTES = 2 * 1024 * 1024;
const PASS_THROUGH_BYTES = 300 * 1024;
const FALLBACK_PASS_BYTES = 5 * 1024 * 1024;
const THUMB_SIDE = 480;

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      const comma = url.indexOf(',');
      resolve(comma >= 0 ? url.slice(comma + 1) : '');
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader 失败'));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob 失败'))), type, quality);
  });
}

async function decodeBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(blob);
  }
}

function drawScaled(src: ImageBitmap, side: number, whiteBg: boolean): HTMLCanvasElement {
  const scale = Math.min(1, side / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 不可用');
  ctx.imageSmoothingQuality = 'high';
  if (whiteBg) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

async function makeThumbnail(bitmap: ImageBitmap, whiteBg: boolean): Promise<string | undefined> {
  try {
    const canvas = drawScaled(bitmap, THUMB_SIDE, whiteBg);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.7);
    return `data:image/jpeg;base64,${await blobToBase64(blob)}`;
  } catch {
    return undefined;
  }
}

/**
 * 压缩图片为「发送版 + 缩略图」。
 * 返回 null = 拒绝（解码失败且超过 5MB，调用方提示用户）。
 */
export async function compressImageBlob(
  blob: Blob,
  name?: string,
  filePath?: string
): Promise<ProcessedImage | null> {
  const whiteBg =
    blob.type === 'image/png' || blob.type === 'image/webp' || blob.type === 'image/gif';

  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeBitmap(blob);
  } catch {
    // 解码失败（HEIC 等）：小图原样直通，大图拒绝
    if (blob.size <= FALLBACK_PASS_BYTES) {
      return { data: await blobToBase64(blob), mimeType: blob.type || 'image/png', name };
    }
    return null;
  }

  try {
    const maxSide = Math.max(bitmap.width, bitmap.height);
    // 小图直通：不二次编码浪费质量
    if (blob.size <= PASS_THROUGH_BYTES && maxSide <= MAX_SEND_SIDE) {
      return {
        data: await blobToBase64(blob),
        mimeType: blob.type || 'image/png',
        name,
        path: filePath,
        thumbnail: await makeThumbnail(bitmap, whiteBg),
      };
    }

    // 压缩：最长边 1568px，质量阶梯降级
    const canvas = drawScaled(bitmap, MAX_SEND_SIDE, whiteBg);
    let data = '';
    for (const q of [0.85, 0.7, 0.55]) {
      data = await blobToBase64(await canvasToBlob(canvas, 'image/jpeg', q));
      if (data.length * 0.75 <= MAX_SEND_BYTES) break;
    }
    // 仍超限（极高清图）：再缩一档 1024px
    if (data.length * 0.75 > MAX_SEND_BYTES) {
      const small = drawScaled(bitmap, 1024, whiteBg);
      data = await blobToBase64(await canvasToBlob(small, 'image/jpeg', 0.7));
    }
    return { data, mimeType: 'image/jpeg', name, path: filePath, thumbnail: await makeThumbnail(bitmap, whiteBg) };
  } finally {
    try { bitmap.close(); } catch { /* 老 Chromium 无 close */ }
  }
}

/**
 * 文件入口：拖入/附件/粘贴。
 * File 来自原生来源时附带磁盘路径（webUtils.getPathForFile；剪贴板 blob 无路径）。
 */
export async function compressImageFile(file: File): Promise<ProcessedImage | null> {
  let filePath: string | undefined;
  try {
    const p = window.tiffaDesktop?.getPathForFile(file);
    if (typeof p === 'string' && p.length > 0) filePath = p;
  } catch { /* 无路径（剪贴板等） */ }
  const result = await compressImageBlob(file, file.name || undefined, filePath);
  if (result && !result.name) result.name = file.name || 'image';
  return result;
}

/** base64 入口：窗口快照等主进程推送的图片 */
export async function compressImageBase64(
  b64: string,
  mimeType: string,
  name?: string
): Promise<ProcessedImage | null> {
  return compressImageBlob(base64ToBlob(b64, mimeType || 'image/png'), name);
}
