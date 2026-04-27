import fs from "fs";
import path from "path";

export interface ThreadHistoryEntry {
  threadKey: string;
  headerText: string;
  headerColor: string;
  headerAlign: "left" | "right";
  bodyText: string;
  bodyColor: string;
  timestampMs: number;
}

type PersistedThreadHistory = Record<string, ThreadHistoryEntry[]>;

class ThreadHistoryStore {
  private threads = new Map<string, ThreadHistoryEntry[]>();
  private readonly maxEntriesPerThread = 100;
  private readonly persistPath = path.resolve(process.cwd(), "data", "thread-history.json");

  constructor() {
    this.loadFromDisk();
  }

  private getThreadKey(nodeId: string | null): string {
    return nodeId ? `dm:${nodeId}` : "channel";
  }

  appendIncoming(params: {
    fromNodeId: string;
    fromDisplay: string;
    routeTag: "DM" | "Ch";
    receivedAtDisplay: string;
    text: string;
    timestampMs?: number;
  }): void {
    const threadKey =
      params.routeTag === "Ch" ? "channel" : this.getThreadKey(params.fromNodeId);

    const entry: ThreadHistoryEntry = {
      threadKey,
      headerText: `${params.fromDisplay}  ${params.routeTag}  ${params.receivedAtDisplay}`,
      headerColor: "#ff5555",
      headerAlign: "left",
      bodyText: params.text,
      bodyColor: "#FFFFFF",
      timestampMs: params.timestampMs ?? Date.now(),
    };

    this.pushEntry(threadKey, entry);
  }

  appendOutgoing(params: {
    toNodeId: string | null;
    routeTag: "DM" | "Ch";
    sentAtDisplay: string;
    text: string;
    senderLabel?: string;
    timestampMs?: number;
  }): void {
    const threadKey = this.getThreadKey(params.toNodeId);

    const entry: ThreadHistoryEntry = {
      threadKey,
      headerText: `${params.senderLabel || "You"}  ${params.routeTag}  ${params.sentAtDisplay}`,
      headerColor: "#00c8a3",
      headerAlign: "right",
      bodyText: params.text,
      bodyColor: "#FFFFFF",
      timestampMs: params.timestampMs ?? Date.now(),
    };

    this.pushEntry(threadKey, entry);
  }

  getThreadEntries(nodeId: string | null): ThreadHistoryEntry[] {
    const key = this.getThreadKey(nodeId);
    return [...(this.threads.get(key) || [])];
  }

  private pushEntry(threadKey: string, entry: ThreadHistoryEntry): void {
    const existing = this.threads.get(threadKey) || [];
    existing.push(entry);

    if (existing.length > this.maxEntriesPerThread) {
      existing.splice(0, existing.length - this.maxEntriesPerThread);
    }

    this.threads.set(threadKey, existing);
    this.saveToDisk();
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.persistPath)) {
        return;
      }

      const raw = fs.readFileSync(this.persistPath, "utf-8");
      if (!raw.trim()) {
        return;
      }

      const parsed = JSON.parse(raw) as PersistedThreadHistory;

      for (const [threadKey, entries] of Object.entries(parsed)) {
        if (!Array.isArray(entries)) {
          continue;
        }

        const cleaned = entries
          .filter((entry) => this.isValidEntry(entry))
          .slice(-this.maxEntriesPerThread);

        if (cleaned.length > 0) {
          this.threads.set(threadKey, cleaned);
        }
      }
    } catch (error) {
      console.error("[ThreadHistory] Failed to load history from disk:", error);
    }
  }

  private saveToDisk(): void {
    try {
      const dir = path.dirname(this.persistPath);
      fs.mkdirSync(dir, { recursive: true });

      const data: PersistedThreadHistory = {};
      for (const [threadKey, entries] of this.threads.entries()) {
        data[threadKey] = entries.slice(-this.maxEntriesPerThread);
      }

      fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
      console.error("[ThreadHistory] Failed to save history to disk:", error);
    }
  }

  private isValidEntry(entry: unknown): entry is ThreadHistoryEntry {
    if (!entry || typeof entry !== "object") {
      return false;
    }

    const candidate = entry as ThreadHistoryEntry;

    return (
      typeof candidate.threadKey === "string" &&
      typeof candidate.headerText === "string" &&
      (candidate.headerAlign === "left" || candidate.headerAlign === "right") &&
      typeof candidate.headerColor === "string" &&
      typeof candidate.bodyText === "string" &&
      typeof candidate.bodyColor === "string" &&
      typeof candidate.timestampMs === "number"
    );
  }
}

export const threadHistoryStore = new ThreadHistoryStore();