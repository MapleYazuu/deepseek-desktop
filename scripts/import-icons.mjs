/**
 * 图标导入脚本（纯 Node，无第三方依赖）：
 * 把用户提供的源图标 PNG 解码后，等比居中裁剪并缩放到多尺寸，生成：
 *   assets/icon.png   256x256（窗口/界面展示图标）
 *   assets/tray.png   32x32（托盘备用图标）
 *   assets/icon.ico   16/24/32/48/64/128/256 多尺寸（应用 + 托盘，Windows 自动选最清晰的）
 * 用法：
 *   node scripts/import-icons.mjs <源图片路径>
 *   例：node scripts/import-icons.mjs C:/Users/weila/Desktop/Workbench/icon.png
 */
import { inflateSync, deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'assets');
mkdirSync(assetsDir, { recursive: true });

const src = process.argv[2];
if (!src) {
  console.error('[icons-import] 用法: node scripts/import-icons.mjs <源图片路径>');
  process.exit(1);
}

/* ---------------- PNG 解码器（8 位、RGB/RGBA、非隔行） ---------------- */

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是有效的 PNG 文件');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatParts = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`不支持的 PNG 格式（位深 ${bitDepth}、颜色类型 ${colorType}、隔行 ${interlace}）`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idatParts));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let i = 0; i < stride; i++) cur[i] = raw[p++];
    for (let i = 0; i < stride; i++) {
      const a = cur[i];
      const b = i >= channels ? cur[i - channels] : 0;
      const c = prev[i];
      const d = i >= channels ? prev[i - channels] : 0;
      let v = a;
      if (filter === 1) v = a + b;
      else if (filter === 2) v = a + c;
      else if (filter === 3) v = a + ((b + c) >> 1);
      else if (filter === 4) v = a + paeth(b, c, d);
      cur[i] = v & 0xff;
    }
    const rowBase = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (channels === 4) {
        rgba[rowBase + x * 4] = cur[x * 4];
        rgba[rowBase + x * 4 + 1] = cur[x * 4 + 1];
        rgba[rowBase + x * 4 + 2] = cur[x * 4 + 2];
        rgba[rowBase + x * 4 + 3] = cur[x * 4 + 3];
      } else {
        rgba[rowBase + x * 4] = cur[x * 3];
        rgba[rowBase + x * 4 + 1] = cur[x * 3 + 1];
        rgba[rowBase + x * 4 + 2] = cur[x * 3 + 2];
        rgba[rowBase + x * 4 + 3] = 255;
      }
    }
    prev.set(cur);
  }
  return { width, height, rgba };
}

/* ---------------- 居中裁剪 + 双线性缩放 ---------------- */

function centerCropSquare(rgba, width, height) {
  const side = Math.min(width, height);
  const ox = Math.floor((width - side) / 2);
  const oy = Math.floor((height - side) / 2);
  const out = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    const srcRow = ((oy + y) * width + ox) * 4;
    const dstRow = y * side * 4;
    for (let x = 0; x < side; x++) {
      out[dstRow + x * 4] = rgba[srcRow + x * 4];
      out[dstRow + x * 4 + 1] = rgba[srcRow + x * 4 + 1];
      out[dstRow + x * 4 + 2] = rgba[srcRow + x * 4 + 2];
      out[dstRow + x * 4 + 3] = rgba[srcRow + x * 4 + 3];
    }
  }
  return { width: side, height: side, rgba: out };
}

function sample(rgba, width, height, x, y, ch) {
  const xi = Math.max(0, Math.min(width - 1, x));
  const yi = Math.max(0, Math.min(height - 1, y));
  return rgba[(yi * width + xi) * 4 + ch];
}

/** 双线性插值缩放（RGBA 四通道） */
function resize(rgba, width, height, targetW, targetH) {
  const out = new Uint8Array(targetW * targetH * 4);
  for (let ty = 0; ty < targetH; ty++) {
    const sy = ((ty + 0.5) * height) / targetH - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let tx = 0; tx < targetW; tx++) {
      const sx = ((tx + 0.5) * width) / targetW - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const i = (ty * targetW + tx) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const p00 = sample(rgba, width, height, x0, y0, ch);
        const p10 = sample(rgba, width, height, x0 + 1, y0, ch);
        const p01 = sample(rgba, width, height, x0, y0 + 1, ch);
        const p11 = sample(rgba, width, height, x0 + 1, y0 + 1, ch);
        const top = p00 + (p10 - p00) * fx;
        const bottom = p01 + (p11 - p01) * fx;
        out[i + ch] = Math.round(top + (bottom - top) * fy);
      }
    }
  }
  return out;
}

/* ---------------- PNG 编码器 ---------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * stride + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- ICO 打包器（PNG 内嵌） ---------------- */

function packIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

/* ---------------- 生成 ---------------- */

const source = readFileSync(src);
const { width, height, rgba } = decodePng(source);
console.log(`[icons-import] 源图: ${width}x${height} RGBA`);
const sq = centerCropSquare(rgba, width, height);

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((size) => ({
  size,
  buf: encodePng(size, size, resize(sq.rgba, sq.width, sq.height, size, size)),
}));

writeFileSync(join(assetsDir, 'icon.png'), pngs.find((p) => p.size === 256).buf);
writeFileSync(join(assetsDir, 'tray.png'), pngs.find((p) => p.size === 32).buf);
writeFileSync(join(assetsDir, 'icon.ico'), packIco(pngs));

console.log('[icons-import] 已生成 assets/icon.ico（16~256）、assets/icon.png（256）、assets/tray.png（32）');
