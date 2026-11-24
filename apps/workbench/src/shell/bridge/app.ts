import { version } from "../../../package.json";

export const appVersion = version;

export async function getVersion(): Promise<string> {
  return appVersion;
}

export async function getName(): Promise<string> {
  return "KnowFlick";
}
