/** Tauri app 插件在 Wails 预览里的最小实现；项目页只用到版本号。 */
export async function getVersion(): Promise<string> {
  return "0.1.0";
}

export async function getName(): Promise<string> {
  return "KnowFlick";
}

export async function getTauriVersion(): Promise<string> {
  return "2";
}
