import fs from "fs";
import path from "path";

export type NicknameEntry = {
  nodeId: string;
  nickname?: string;
  displayName?: string;
  shortName?: string;
  lastSeenAt?: string;
};

type ObservedNamePatch = {
  displayName?: string | null;
  shortName?: string | null;
};

type NicknameStoreFile = {
  entries: Record<string, NicknameEntry>;
};

const DEFAULT_NICKNAME_FILE_PATH = process.env.MESHTASTIC_NICKNAME_FILE
  ? path.resolve(process.env.MESHTASTIC_NICKNAME_FILE)
  : path.resolve(process.cwd(), "data", "meshtastic-nicknames.json");

function normalizeNodeId(nodeId?: string | null): string {
  return (nodeId || "").trim();
}

class MeshtasticNicknameStore {
  private filePath: string;
  private entries: Record<string, NicknameEntry> = {};

  constructor(filePath = DEFAULT_NICKNAME_FILE_PATH) {
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
        this.entries = {};
        return;
      }

      const raw = fs.readFileSync(this.filePath, "utf-8");
      if (!raw.trim()) {
        this.entries = {};
        return;
      }

      const parsed = JSON.parse(raw) as Partial<NicknameStoreFile>;
      this.entries = parsed.entries && typeof parsed.entries === "object"
        ? parsed.entries
        : {};
    } catch (error) {
      console.warn("[MeshtasticNicknameStore] failed to load nickname file:", error);
      this.entries = {};
    }
  }

  private save(): void {
    try {
      this.ensureParentDir();

      const payload: NicknameStoreFile = {
        entries: this.entries,
      };

      fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), "utf-8");
    } catch (error) {
      console.warn("[MeshtasticNicknameStore] failed to save nickname file:", error);
    }
  }

  touchNode(nodeId?: string | null, observed?: ObservedNamePatch): void {
    const normalizedNodeId = normalizeNodeId(nodeId);
    if (!normalizedNodeId) {
      return;
    }

    const existing = this.entries[normalizedNodeId] || {
      nodeId: normalizedNodeId,
    };

    const cleanedDisplayName = observed?.displayName?.trim();
    const cleanedShortName = observed?.shortName?.trim();

    if (cleanedDisplayName && cleanedDisplayName !== normalizedNodeId) {
      existing.displayName = cleanedDisplayName;
    }

    if (cleanedShortName) {
      existing.shortName = cleanedShortName;
    }

    existing.lastSeenAt = new Date().toISOString();
    this.entries[normalizedNodeId] = existing;
    this.save();
  }

  getNickname(nodeId?: string | null): string | null {
    const normalizedNodeId = normalizeNodeId(nodeId);
    if (!normalizedNodeId) {
      return null;
    }

    const nickname = this.entries[normalizedNodeId]?.nickname?.trim();
    return nickname ? nickname : null;
  }

  getDisplayLabel(nodeId?: string | null): string {
    const nickname = this.getNickname(nodeId);
    if (nickname) {
      return nickname;
    }

    const normalizedNodeId = normalizeNodeId(nodeId);
    if (!normalizedNodeId) {
      return "Unknown";
    }

    const entry = this.entries[normalizedNodeId];
    const displayName = entry?.displayName?.trim();
    if (displayName) {
      return displayName;
    }

    const shortName = entry?.shortName?.trim();
    if (shortName) {
      return shortName;
    }

    return normalizedNodeId;
  }

  setNickname(nodeId: string, nickname: string): void {
    const normalizedNodeId = normalizeNodeId(nodeId);
    const cleanedNickname = nickname.trim();

    if (!normalizedNodeId) {
      throw new Error("Cannot set nickname for empty node ID.");
    }

    if (!cleanedNickname) {
      throw new Error("Cannot save an empty nickname.");
    }

    const existing = this.entries[normalizedNodeId] || {
      nodeId: normalizedNodeId,
    };

    existing.nickname = cleanedNickname;
    existing.lastSeenAt = new Date().toISOString();

    this.entries[normalizedNodeId] = existing;
    this.save();
  }

  listKnownNodes(): NicknameEntry[] {
    return Object.values(this.entries).sort((a, b) => {
      const aSeen = a.lastSeenAt || "";
      const bSeen = b.lastSeenAt || "";
      return bSeen.localeCompare(aSeen);
    });
  }
}

export const nicknameStore = new MeshtasticNicknameStore();