import fs from "fs";
import path from "path";

export type DeviceBehaviorDefaults = {
  led: {
    dormantIdleHex: string;
    dormantUnreadHex: string;
    modeWhenDormant: "breathe" | "steady";
    breatheCycleMs: number;
    breatheMinScale: number;
    awakeFadeMs: number;
  };
  sounds: {
    incomingMessageSoundFile: string;
    wakeupSoundFile: string;
  };
};

const FALLBACK_DEVICE_BEHAVIOR_DEFAULTS: DeviceBehaviorDefaults = {
  led: {
    dormantIdleHex: "#ffaa00",
    dormantUnreadHex: "#ff0000",
    modeWhenDormant: "breathe",
    breatheCycleMs: 2200,
    breatheMinScale: 0.12,
    awakeFadeMs: 350,
  },
  sounds: {
    incomingMessageSoundFile: "",
    wakeupSoundFile: "",
  },
};

const DEVICE_BEHAVIOR_DEFAULTS_PATH = path.resolve(
  process.cwd(),
  "src",
  "config",
  "device-behavior.defaults.json",
);

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}

function normalizeHex(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizePath(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function loadDeviceBehaviorDefaults(): DeviceBehaviorDefaults {
  try {
    if (!fs.existsSync(DEVICE_BEHAVIOR_DEFAULTS_PATH)) {
      return FALLBACK_DEVICE_BEHAVIOR_DEFAULTS;
    }

    const raw = fs.readFileSync(DEVICE_BEHAVIOR_DEFAULTS_PATH, "utf-8");
    if (!raw.trim()) {
      return FALLBACK_DEVICE_BEHAVIOR_DEFAULTS;
    }

    const parsed = JSON.parse(raw) as Partial<DeviceBehaviorDefaults>;

    return {
      led: {
        dormantIdleHex: normalizeHex(
          parsed?.led?.dormantIdleHex,
          FALLBACK_DEVICE_BEHAVIOR_DEFAULTS.led.dormantIdleHex,
        ),
        dormantUnreadHex: normalizeHex(
          parsed?.led?.dormantUnreadHex,
          FALLBACK_DEVICE_BEHAVIOR_DEFAULTS.led.dormantUnreadHex,
        ),
        modeWhenDormant:
          parsed?.led?.modeWhenDormant === "steady"
            ? "steady"
            : FALLBACK_DEVICE_BEHAVIOR_DEFAULTS.led.modeWhenDormant,
        breatheCycleMs: clampNumber(
          parsed?.led?.breatheCycleMs,
          FALLBACK_DEVICE_BEHAVIOR_DEFAULTS.led.breatheCycleMs,
          400,
          10000,
        ),
        breatheMinScale: clampNumber(
          parsed?.led?.breatheMinScale,
          FALLBACK_DEVICE_BEHAVIOR_DEFAULTS.led.breatheMinScale,
          0.01,
          1.0,
        ),
        awakeFadeMs: clampNumber(
          parsed?.led?.awakeFadeMs,
          FALLBACK_DEVICE_BEHAVIOR_DEFAULTS.led.awakeFadeMs,
          0,
          5000,
        ),
      },
      sounds: {
        incomingMessageSoundFile: normalizePath(
          parsed?.sounds?.incomingMessageSoundFile,
        ),
        wakeupSoundFile: normalizePath(parsed?.sounds?.wakeupSoundFile),
      },
    };
  } catch (error) {
    console.warn("[deviceBehaviorDefaults] failed to load defaults:", error);
    return FALLBACK_DEVICE_BEHAVIOR_DEFAULTS;
  }
}

export const deviceBehaviorDefaults = loadDeviceBehaviorDefaults();