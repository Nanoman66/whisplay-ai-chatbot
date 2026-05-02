import fs from "fs";
import path from "path";

export const AWAKE_BRIGHTNESS_OPTIONS = [20, 35, 50, 75, 100] as const;

export type AppSettings = {
  soundEnabled: boolean;
  awakeBrightness: number;
  dormantTimeoutSeconds: number;
  incomingWakeSeconds: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  soundEnabled: true,
  awakeBrightness: 75,
  dormantTimeoutSeconds: 45,
  incomingWakeSeconds: 6,
};

type PersistedSettingsFile = Partial<AppSettings>;

const SETTINGS_FILE_PATH = path.resolve(process.cwd(), "data", "app-settings.json");

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeBrightness(value: unknown): number {
  const fallback = DEFAULT_SETTINGS.awakeBrightness;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  let closest = AWAKE_BRIGHTNESS_OPTIONS[0];
  let closestDistance = Math.abs(numeric - closest);

  for (const option of AWAKE_BRIGHTNESS_OPTIONS) {
    const distance = Math.abs(numeric - option);
    if (distance < closestDistance) {
      closest = option;
      closestDistance = distance;
    }
  }

  return closest;
}

function normalizeSettings(input?: PersistedSettingsFile | null): AppSettings {
  return {
    soundEnabled:
      typeof input?.soundEnabled === "boolean"
        ? input.soundEnabled
        : DEFAULT_SETTINGS.soundEnabled,
    awakeBrightness: normalizeBrightness(input?.awakeBrightness),
    dormantTimeoutSeconds: clampNumber(
      input?.dormantTimeoutSeconds,
      DEFAULT_SETTINGS.dormantTimeoutSeconds,
      15,
      300,
    ),
    incomingWakeSeconds: clampNumber(
      input?.incomingWakeSeconds,
      DEFAULT_SETTINGS.incomingWakeSeconds,
      3,
      15,
    ),
  };
}

class SettingsStore {
  private filePath: string;
  private settings: AppSettings = { ...DEFAULT_SETTINGS };

  constructor(filePath = SETTINGS_FILE_PATH) {
    this.filePath = filePath;
    this.load();
  }

  private ensureParentDir(): void {
    const parentDir = path.dirname(this.filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.settings = { ...DEFAULT_SETTINGS };
        return;
      }

      const raw = fs.readFileSync(this.filePath, "utf-8");
      if (!raw.trim()) {
        this.settings = { ...DEFAULT_SETTINGS };
        return;
      }

      const parsed = JSON.parse(raw) as PersistedSettingsFile;
      this.settings = normalizeSettings(parsed);
    } catch (error) {
      console.warn("[SettingsStore] failed to load settings file:", error);
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  private save(): void {
    try {
      this.ensureParentDir();
      fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), "utf-8");
    } catch (error) {
      console.warn("[SettingsStore] failed to save settings file:", error);
    }
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.settings = normalizeSettings({
      ...this.settings,
      ...patch,
    });
    this.save();
    return this.getSettings();
  }
}

export const settingsStore = new SettingsStore();