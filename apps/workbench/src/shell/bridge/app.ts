/** 应用元信息。打包时版本由 apps/workbench/package.json 决定；这里保持与发布版本一致。 */
export async function getVersion(): Promise<string> {
  return "0.1.0";
}

export async function getName(): Promise<string> {
  return "KnowFlick";
}
