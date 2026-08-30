'use strict';
// 宠物动画黑底遮罩生成器（离线脚本，dsh-desktop 内运行以解析 sharp）：
// 对每个 thumb webm 取首帧，从所有边框像素做洪水填充（max(r,g,b) <= 12 视为背景），
// 未被填充的区域 = 角色 → mask。1 遍 3x3 盒模糊柔化边缘，输出 <name>.mask.png。
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

async function main() {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node scripts/pet-mask.cjs <thumb-dir>'); process.exit(1); }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.webm'));
  for (const f of files) {
    const name = f.slice(0, -'.webm'.length);
    const out = path.join(dir, name + '.mask.png');
    const png = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(dir, f), '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 64 * 1024 * 1024 });
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const isBg = (i) => Math.max(data[i], data[i + 1], data[i + 2]) <= 12;
    const idx = (x, y) => (y * width + x) * channels;
    const visited = new Uint8Array(width * height);
    const stack = [];
    const tryPush = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const p = y * width + x;
      if (visited[p]) return;
      if (!isBg(idx(x, y))) return;
      visited[p] = 1;
      stack.push([x, y]);
    };
    for (let x = 0; x < width; x++) { tryPush(x, 0); tryPush(x, height - 1); }
    for (let y = 0; y < height; y++) { tryPush(0, y); tryPush(width - 1, y); }
    while (stack.length) {
      const [x, y] = stack.pop();
      tryPush(x + 1, y); tryPush(x - 1, y); tryPush(x, y + 1); tryPush(x, y - 1);
    }
    const alpha = new Float32Array(width * height);
    for (let p = 0; p < width * height; p++) alpha[p] = 1 - visited[p];
    const blurred = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          s += alpha[ny * width + nx]; n++;
        }
        blurred[y * width + x] = s / n;
      }
    }
    const outData = Buffer.alloc(width * height * 4);
    for (let p = 0; p < width * height; p++) {
      const a = Math.round(blurred[p] * 255);
      outData[p * 4] = 255; outData[p * 4 + 1] = 255; outData[p * 4 + 2] = 255; outData[p * 4 + 3] = a;
    }
    await sharp(outData, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(out);
    console.log('mask:', name + '.mask.png');
  }
  console.log('done:', files.length, 'masks');
}
main().catch((e) => { console.error(e); process.exit(1); });
