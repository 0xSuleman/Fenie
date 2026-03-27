/**
 * Generate Fenie PNG icons — Genie lamp with chart smoke.
 * Run: node icons/generate.js
 */

const { writeFileSync } = require('fs');
const { deflateSync } = require('zlib');
const path = require('path');

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createPNG(width, height, pixels) {
  const chunks = [];
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  function addChunk(type, data) {
    const typeBytes = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const combined = Buffer.concat([typeBytes, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(combined));
    chunks.push(len, combined, crc);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  addChunk('IHDR', ihdr);

  const rawData = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rawData[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * (width * 4 + 1) + 1 + x * 4;
      rawData[dstIdx] = pixels[srcIdx];
      rawData[dstIdx + 1] = pixels[srcIdx + 1];
      rawData[dstIdx + 2] = pixels[srcIdx + 2];
      rawData[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }
  addChunk('IDAT', deflateSync(rawData));
  addChunk('IEND', Buffer.alloc(0));
  return Buffer.concat(chunks);
}

function setPixel(pixels, size, x, y, r, g, b, a = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const idx = (y * size + x) * 4;
  const srcA = a / 255;
  const dstA = pixels[idx + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA > 0) {
    pixels[idx] = Math.round((r * srcA + pixels[idx] * dstA * (1 - srcA)) / outA);
    pixels[idx + 1] = Math.round((g * srcA + pixels[idx + 1] * dstA * (1 - srcA)) / outA);
    pixels[idx + 2] = Math.round((b * srcA + pixels[idx + 2] * dstA * (1 - srcA)) / outA);
    pixels[idx + 3] = Math.round(outA * 255);
  }
}

function drawCircle(pixels, size, cx, cy, r, R, G, B, A = 255) {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d <= r) {
        const edge = Math.max(0, Math.min(1, r - d + 0.5));
        setPixel(pixels, size, x, y, R, G, B, Math.round(A * edge));
      }
    }
  }
}

function drawLine(pixels, size, x1, y1, x2, y2, R, G, B, thick = 1, A = 255) {
  const dx = x2 - x1, dy = y2 - y1;
  const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 3;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + dx * t;
    const y = y1 + dy * t;
    for (let tx = -thick; tx <= thick; tx += 0.5) {
      for (let ty = -thick; ty <= thick; ty += 0.5) {
        if (tx * tx + ty * ty <= thick * thick) {
          setPixel(pixels, size, x + tx, y + ty, R, G, B, A);
        }
      }
    }
  }
}

function drawRect(pixels, size, x, y, w, h, R, G, B, A = 255) {
  for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
      setPixel(pixels, size, px, py, R, G, B, A);
    }
  }
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4, 0);
  const s = size;

  // Background circle
  drawCircle(pixels, s, s / 2, s / 2, s * 0.47, 13, 13, 30);

  // Accent ring
  const ringR = s * 0.45;
  for (let a = 0; a < 360; a += 0.3) {
    const rad = a * Math.PI / 180;
    setPixel(pixels, s, s / 2 + Math.cos(rad) * ringR, s / 2 + Math.sin(rad) * ringR, 0, 212, 170, 140);
  }

  // Genie lamp
  const lampCx = s * 0.5;
  const lampBy = s * 0.74;
  const lampW = s * 0.32;

  // Lamp base ellipse
  for (let a = 0; a < 360; a += 1) {
    const rad = a * Math.PI / 180;
    setPixel(pixels, s, lampCx + Math.cos(rad) * lampW * 0.5, lampBy + Math.sin(rad) * s * 0.03, 255, 215, 0, 200);
    if (s >= 32) setPixel(pixels, s, lampCx + Math.cos(rad) * lampW * 0.48, lampBy + Math.sin(rad) * s * 0.025, 255, 215, 0, 180);
  }

  // Lamp body
  const bodyTop = lampBy - s * 0.12;
  drawRect(pixels, s, lampCx - lampW * 0.35, bodyTop, lampW * 0.7, s * 0.12, 255, 215, 0, 180);
  // Lamp neck
  drawRect(pixels, s, lampCx - lampW * 0.15, bodyTop - s * 0.04, lampW * 0.3, s * 0.05, 255, 215, 0, 150);

  // Spout
  const spoutStart = { x: lampCx + lampW * 0.25, y: bodyTop + s * 0.02 };
  const spoutEnd = { x: s * 0.75, y: s * 0.4 };
  drawLine(pixels, s, spoutStart.x, spoutStart.y, spoutEnd.x, spoutEnd.y, 255, 215, 0, Math.max(0.5, s * 0.015), 180);

  // Chart line emerging from spout (the magic smoke = price action)
  const lw = Math.max(0.8, s * 0.02);
  const chartPoints = [
    [0.75, 0.4],
    [0.68, 0.3],
    [0.6, 0.34],
    [0.5, 0.22],
    [0.42, 0.26],
    [0.34, 0.17]
  ];

  for (let i = 0; i < chartPoints.length - 1; i++) {
    drawLine(pixels, s,
      s * chartPoints[i][0], s * chartPoints[i][1],
      s * chartPoints[i + 1][0], s * chartPoints[i + 1][1],
      0, 212, 170, lw, 220
    );
  }

  // Arrow tip at end of chart
  const tipX = s * chartPoints[chartPoints.length - 1][0];
  const tipY = s * chartPoints[chartPoints.length - 1][1];
  drawLine(pixels, s, tipX, tipY, tipX + s * 0.04, tipY + s * 0.03, 0, 212, 170, lw * 0.7, 220);
  drawLine(pixels, s, tipX, tipY, tipX + s * 0.01, tipY + s * 0.05, 0, 212, 170, lw * 0.7, 220);

  // Sparkles
  drawCircle(pixels, s, s * 0.78, s * 0.32, s * 0.015, 255, 255, 255, 200);
  drawCircle(pixels, s, s * 0.72, s * 0.24, s * 0.012, 0, 212, 170, 150);
  drawCircle(pixels, s, s * 0.3, s * 0.15, s * 0.01, 255, 255, 255, 130);
  if (s >= 48) {
    drawCircle(pixels, s, s * 0.82, s * 0.38, s * 0.008, 255, 215, 0, 120);
    drawCircle(pixels, s, s * 0.25, s * 0.22, s * 0.008, 0, 212, 170, 100);
  }

  return createPNG(size, size, pixels);
}

[16, 32, 48, 128].forEach(size => {
  const png = drawIcon(size);
  const filePath = path.join(__dirname, `icon${size}.png`);
  writeFileSync(filePath, png);
  console.log(`Created icon${size}.png (${png.length} bytes)`);
});

console.log('All Fenie icons generated!');
