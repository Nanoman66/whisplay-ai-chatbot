export interface ThreadHistoryEntry {
  threadKey: string;
  headerText: string;
  headerColor: string;
  headerAlign: "left" | "right";
  bodyText: string;
  bodyColor: string;
  timestampMs: number;
}

class ThreadHistoryStore {
  private threads = new Map<string, ThreadHistoryEntry[]>();
  private readonly maxEntriesPerThread = 60;

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
    const threadKey = params.routeTag === "Ch" ? "channel" : this.getThreadKey(params.fromNodeId);
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
    const key = this.getThreadKey(nodeId)
    return [...(this.threads.get(key) || [])];
  }

  private pushEntry(threadKey: string, entry: ThreadHistoryEntry): void {
    const existing = this.threads.get(threadKey) || [];
    existing.push(entry);

    if (existing.length > this.maxEntriesPerThread) {
      existing.splice(0, existing.length - this.maxEntriesPerThread);
    }

    this.threads.set(threadKey, existing);
  }
}

export const threadHistoryStore = new ThreadHistoryStore();