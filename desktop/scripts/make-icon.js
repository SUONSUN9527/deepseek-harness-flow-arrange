// 用 Electron 离屏渲染 icon.html，导出多尺寸 app.ico（PNG 压缩条目，Vista+ 支持）。
// 运行：node_modules\.bin\electron scripts\make-icon.js
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 类型：icon
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  const blobs = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);  // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(buf.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(entry);
    blobs.push(buf);
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false,
      width: 256,
      height: 256,
      frame: false,
      transparent: true,
      webPreferences: { offscreen: true },
    });
    await win.loadFile(path.join(__dirname, 'icon.html'));
    await new Promise((r) => setTimeout(r, 800)); // 等待离屏首帧绘制
    let img = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
    if (img.getSize().width !== 256) {
      img = img.resize({ width: 256, height: 256, quality: 'best' }); // 高 DPI 显示器矫正
    }
    fs.writeFileSync(path.join(__dirname, 'icon-256.png'), img.toPNG());
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const pngs = sizes.map((size) => ({
      size,
      buf: (size === 256 ? img : img.resize({ width: size, height: size, quality: 'best' })).toPNG(),
    }));
    fs.writeFileSync(path.join(__dirname, '..', 'app.ico'), buildIco(pngs));
    console.log('[icon] app.ico + scripts/icon-256.png written');
    app.exit(0);
  } catch (err) {
    console.error('[icon] FAILED: ' + err.message);
    app.exit(1);
  }
});
