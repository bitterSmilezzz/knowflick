/**
 * 纯 JS 的 PNG 解码 + 交通灯检测。
 *
 * 用途：判断「截到的那块屏幕区域**确实是 KnowFlick 窗口**」。
 *
 * 判据：macOS 窗口左上角的**红黄绿三个交通灯**。KnowFlick 有它，
 * 别的应用盖上来就没有（那块拍到的是别人的内容）。
 *
 * 为什么需要它：真机像素比对最怕**拍错对象**。整屏截图会把别的应用一起拍进来，
 * 而本机有个在流式输出的窗口——于是「内容变了」恒真，断言恒绿（假通过）。
 * 光靠「指纹稳定」不够：盖住的那块也可能恰好稳定。
 * 交通灯是 KnowFlick **独有**的标记，能确定拍的是它。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const exec = promisify(execFile);

/** 解码 PNG → { width, height, rgb: Uint8Array }（只支持 8 位 RGB/RGBA）。 */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`只支持 8 位深度，实际 ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`不支持的颜色类型 ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rp + x];
      const a = x >= channels ? out[rowStart + x - channels] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = x >= channels && y > 0 ? out[prevStart + x - channels] : 0;
      let value;
      switch (filter) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + a; break;
        case 2: value = rawByte + b; break;
        case 3: value = rawByte + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`未知的行滤波 ${filter}`);
      }
      out[rowStart + x] = value & 0xff;
    }
    rp += stride;
  }
  return { width, height, channels, data: out };
}

/** 数一数「红/黄/绿」交通灯像素。 */
export function countTrafficLights(png) {
  const { width, height, channels, data } = decodePng(png);
  let red = 0;
  let yellow = 0;
  let green = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    if (r > 190 && g < 120 && b < 120) red++;
    else if (r > 200 && g > 150 && b < 100) yellow++;
    else if (r < 130 && g > 150 && b < 130) green++;
  }
  return { red, yellow, green };
}

/**
 * 这块屏幕区域**是不是 KnowFlick 窗口**？
 *
 * 三个交通灯都要在——缺一个就说明拍到的不是它（被盖住 / 还没抬到最前）。
 */
export function looksLikeKnowFlickWindow(pngBytes) {
  const { red, yellow, green } = countTrafficLights(pngBytes);
  return { isKnowFlick: red >= 8 && yellow >= 8 && green >= 8, red, yellow, green };
}

/** 截一小块屏幕并判断是不是 KnowFlick 的标题栏。 */
export async function screenShowsKnowFlick(x, y, w, h, out) {
  await exec("screencapture", ["-x", "-R", `${x},${y},${w},${h}`, out]);
  return looksLikeKnowFlickWindow(readFileSync(out));
}
