import { configPath } from "./paths";
import { isRec } from "./utils";
import { readSection, writeSection } from "./pi-craft-settings";

export interface Config {
  autoRead: boolean;
  anchorGrepEnabled: boolean;
}

const DEFAULT_CONFIG: Config = {
  autoRead: true,
  anchorGrepEnabled: false
};

function parseObject(parsed: unknown): Config {
  const autoRead = isRec(parsed) ? parsed.autoRead : undefined;
  if (typeof autoRead !== "boolean") {
    throw new Error("config.json must be an object with a boolean autoRead field");
  }
  const anchorGrepEnabled = isRec(parsed) ? parsed.anchorGrepEnabled : undefined;
  return {
    autoRead,
    anchorGrepEnabled: typeof anchorGrepEnabled === "boolean" ? anchorGrepEnabled : DEFAULT_CONFIG.anchorGrepEnabled,
  };
}


export async function readConfig(): Promise<Config> {
  const section = readSection("hashline", configPath());
  if (Object.keys(section).length === 0) return { ...DEFAULT_CONFIG };
  try {
    return parseObject(section);
  } catch (error: unknown) {
    console.error("Config section corrupted, using defaults:", error);
    return { ...DEFAULT_CONFIG };
  }
}

export async function writeConfig(config: Config): Promise<void> {
  writeSection("hashline", { ...config });
}


export async function toggleAutoRead(): Promise<boolean> {
  const config = await readConfig();
  config.autoRead = !config.autoRead;
  await writeConfig(config);
  return config.autoRead;
}

export async function toggleAnchorGrep(): Promise<boolean> {
  const config = await readConfig();
  config.anchorGrepEnabled = !config.anchorGrepEnabled;
  await writeConfig(config);
  return config.anchorGrepEnabled;
}
