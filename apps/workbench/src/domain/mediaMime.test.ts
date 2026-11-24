import { describe, expect, it } from "vitest";
import { imageMimeOf, mediaMimeOfExtension } from "./mediaMime";

/**
 * 落盘时扩展名由 MIME 决定，恢复时又要由扩展名反推 MIME。
 * 判错的后果很具体：JPEG 存成 .png，内容与扩展名不符，有些查看器直接打不开。
 */
describe("附件 MIME 推断", () => {
  it("浏览器没给 MIME 时按扩展名推断", () => {
    expect(imageMimeOf("photo.jpg", "")).toBe("image/jpeg");
    expect(imageMimeOf("photo.jpeg", "")).toBe("image/jpeg");
    expect(imageMimeOf("photo.heic", "")).toBe("image/heic");
    expect(imageMimeOf("photo.webp", "")).toBe("image/webp");
    expect(imageMimeOf("photo.gif", "")).toBe("image/gif");
    expect(imageMimeOf("photo.png", "")).toBe("image/png");
  });

  it("扩展名优先于浏览器给的类型", () => {
    // 浏览器有时会给出不准确或空泛的类型，扩展名更接近「文件本来是什么」。
    expect(imageMimeOf("photo.jpg", "image/png")).toBe("image/jpeg");
    expect(imageMimeOf("photo.png", "")).toBe("image/png");
  });

  it("扩展名不认识时退回浏览器给的类型", () => {
    expect(imageMimeOf("photo.unknown", "image/avif")).toBe("image/avif");
  });

  it("扩展名与类型都没有时兜底 PNG", () => {
    expect(imageMimeOf("photo", "")).toBe("image/png");
    expect(imageMimeOf("photo", "application/octet-stream")).toBe("image/png");
  });

  it("大写扩展名也认", () => {
    expect(imageMimeOf("PHOTO.JPG", "")).toBe("image/jpeg");
    expect(imageMimeOf("PHOTO.HEIC", "")).toBe("image/heic");
  });

  it("恢复附件时按扩展名反查 MIME，不认识就返回 undefined", () => {
    expect(mediaMimeOfExtension("png")).toBe("image/png");
    expect(mediaMimeOfExtension("jpg")).toBe("image/jpeg");
    expect(mediaMimeOfExtension("heif")).toBe("image/heic");
    expect(mediaMimeOfExtension("webm")).toBe("audio/webm");
    expect(mediaMimeOfExtension("json")).toBe("application/json");
    expect(mediaMimeOfExtension("exe")).toBeUndefined();
  });
});
