#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const nicknameFilePath = process.env.MESHTASTIC_NICKNAME_FILE
  ? path.resolve(process.env.MESHTASTIC_NICKNAME_FILE)
  : path.resolve(process.cwd(), "data", "meshtastic-nicknames.json");

const [, , nodeIdRaw, ...nicknameParts] = process.argv;
const nodeId = (nodeIdRaw || "").trim();
const nickname = nicknameParts.join(" ").trim();

if (!nodeId || !nickname) {
  console.error("Usage: node scripts/set-meshtastic-nickname.js <nodeId> <nickname>");
  process.exit(1);
}

let payload = { entries: {} };

if (fs.existsSync(nicknameFilePath)) {
  try {
    const raw = fs.readFileSync(nicknameFilePath, "utf-8");
    if (raw.trim()) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.entries && typeof parsed.entries === "object") {
        payload = parsed;
      }
    }
  } catch (error) {
    console.error(`[NicknameScript] Failed to read ${nicknameFilePath}:`, error);
    process.exit(1);
  }
}

const existing = payload.entries[nodeId] || { nodeId };

payload.entries[nodeId] = {
  ...existing,
  nodeId,
  nickname,
  lastSeenAt: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(nicknameFilePath), { recursive: true });
fs.writeFileSync(nicknameFilePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");

console.log(`Saved nickname '${nickname}' for ${nodeId} in ${nicknameFilePath}`);