#!/usr/bin/env python3
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, List
from urllib.parse import urlparse

import meshtastic.tcp_interface
from pubsub import pub

BRIDGE_HOST = os.environ.get("MESHTASTIC_BRIDGE_HOST", "127.0.0.1")
BRIDGE_PORT = int(os.environ.get("MESHTASTIC_BRIDGE_PORT", "4410"))
MESH_HOST = os.environ.get("MESHTASTIC_HOST", "127.0.0.1")
MESH_PORT = int(os.environ.get("MESHTASTIC_PORT", "4403"))
MAX_MESSAGES = 100

messages_lock = threading.Lock()
messages: List[Dict[str, Any]] = []
iface = None


def add_message(entry: Dict[str, Any]) -> None:
    global messages
    with messages_lock:
        messages.append(entry)
        if len(messages) > MAX_MESSAGES:
            messages = messages[-MAX_MESSAGES:]


def on_receive(packet: Dict[str, Any], interface) -> None:
    decoded = packet.get("decoded", {})
    text = decoded.get("text", "")

    entry = {
        "from": packet.get("fromId") or packet.get("from"),
        "to": packet.get("toId") or packet.get("to"),
        "text": text,
        "channelIndex": packet.get("channel"),
        "rxSnr": packet.get("rxSnr"),
        "rxRssi": packet.get("rxRssi"),
        "rxTime": packet.get("rxTime"),
    }

    add_message(entry)
    print(f"[meshtastic_bridge] received: {entry}")


class BridgeHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/health":
            self._send_json(
                200,
                {
                    "ok": True,
                    "bridgeHost": BRIDGE_HOST,
                    "bridgePort": BRIDGE_PORT,
                    "meshHost": MESH_HOST,
                    "meshPort": MESH_PORT,
                    "connected": iface is not None,
                },
            )
            return

        if parsed.path == "/messages":
            with messages_lock:
                self._send_json(200, {"ok": True, "messages": messages})
            return

        self._send_json(404, {"ok": False, "error": "Not found"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path != "/send":
            self._send_json(404, {"ok": False, "error": "Not found"})
            return

        if iface is None:
            self._send_json(503, {"ok": False, "error": "Meshtastic interface not connected"})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"

        try:
            body = json.loads(raw_body)
        except json.JSONDecodeError:
            self._send_json(400, {"ok": False, "error": "Invalid JSON"})
            return

        text = (body.get("text") or "").strip()
        destination_id = body.get("destinationId")
        want_ack = bool(body.get("wantAck", False))
        channel_index = int(body.get("channelIndex", 0))

        if not text:
            self._send_json(400, {"ok": False, "error": "Missing text"})
            return

        try:
            iface.sendText(
                text=text,
                destinationId=destination_id,
                wantAck=want_ack,
                channelIndex=channel_index,
            )
            self._send_json(200, {"ok": True})
        except Exception as exc:
            self._send_json(500, {"ok": False, "error": str(exc)})

    def log_message(self, format: str, *args) -> None:
        return


def main() -> None:
    global iface

    pub.subscribe(on_receive, "meshtastic.receive.text")

    print(f"[meshtastic_bridge] connecting to {MESH_HOST}:{MESH_PORT}")
    iface = meshtastic.tcp_interface.TCPInterface(
        hostname=MESH_HOST,
        portNumber=MESH_PORT,
    )

    print(f"[meshtastic_bridge] serving on http://{BRIDGE_HOST}:{BRIDGE_PORT}")
    server = HTTPServer((BRIDGE_HOST, BRIDGE_PORT), BridgeHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()