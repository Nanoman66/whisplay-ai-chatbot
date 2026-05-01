#!/usr/bin/env python3
import json
import os
import threading
import time
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

iface_lock = threading.Lock()
iface = None
connected = False


def add_message(entry: Dict[str, Any]) -> None:
    global messages
    with messages_lock:
        messages.append(entry)
        if len(messages) > MAX_MESSAGES:
            messages = messages[-MAX_MESSAGES:]

def on_connection_established(interface, topic=pub.AUTO_TOPIC) -> None:
    global iface, connected
    with iface_lock:
        iface = interface
        connected = True
    print("[meshtastic_bridge] connection established")


def on_connection_lost(interface, topic=pub.AUTO_TOPIC) -> None:
    global iface, connected
    with iface_lock:
        connected = False
        iface = None
    print("[meshtastic_bridge] connection lost")

def resolve_node_record(packet: Dict[str, Any], interface) -> Dict[str, Any]:
    if interface is None or not hasattr(interface, "nodes"):
        return {}

    nodes = getattr(interface, "nodes", {}) or {}
    if not isinstance(nodes, dict):
        return {}

    from_id = packet.get("fromId")
    from_num = packet.get("from")

    direct_candidates = []
    if from_id in nodes:
        direct_candidates.append(nodes.get(from_id))
    if from_num in nodes:
        direct_candidates.append(nodes.get(from_num))

    for candidate in direct_candidates:
        if isinstance(candidate, dict):
            return candidate

    for node in nodes.values():
        if not isinstance(node, dict):
            continue

        user = node.get("user", {}) or {}
        if from_id and user.get("id") == from_id:
            return node

        if from_num is not None and node.get("num") == from_num:
            return node

    return {}


def resolve_sender_labels(packet: Dict[str, Any], interface) -> tuple[str | None, str | None]:
    node = resolve_node_record(packet, interface)
    if not node:
        return None, None

    user = node.get("user", {}) or {}
    long_name = user.get("longName") or None
    short_name = user.get("shortName") or None
    return long_name, short_name

def on_receive(packet: Dict[str, Any], interface) -> None:
    decoded = packet.get("decoded", {})
    text = decoded.get("text", "")
    from_display, from_short_name = resolve_sender_labels(packet, interface)

    entry = {
        "from": packet.get("fromId") or packet.get("from"),
        "fromDisplay": from_display,
        "fromShortName": from_short_name,
        "to": packet.get("toId") or packet.get("to"),
        "text": text,
        "channelIndex": packet.get("channel"),
        "rxSnr": packet.get("rxSnr"),
        "rxRssi": packet.get("rxRssi"),
        "rxTime": packet.get("rxTime"),
    }

    add_message(entry)
    print(f"[meshtastic_bridge] received: {entry}")

def connector_loop() -> None:
    global iface, connected

    while True:
        with iface_lock:
            already_connected = connected

        if already_connected:
            time.sleep(2)
            continue

        try:
            print(f"[meshtastic_bridge] connecting to {MESH_HOST}:{MESH_PORT}")
            new_iface = meshtastic.tcp_interface.TCPInterface(
                hostname=MESH_HOST,
                portNumber=MESH_PORT,
            )
            with iface_lock:
                iface = new_iface
                connected = True
            print("[meshtastic_bridge] TCP interface created")
        except Exception as exc:
            with iface_lock:
                iface = None
                connected = False
            print(f"[meshtastic_bridge] connect failed: {exc}")

        time.sleep(2)

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
            with iface_lock:
                is_connected = connected
            
            self._send_json(
                200,
                {
                    "ok": True,
                    "bridgeHost": BRIDGE_HOST,
                    "bridgePort": BRIDGE_PORT,
                    "meshHost": MESH_HOST,
                    "meshPort": MESH_PORT,
                    "connected": is_connected,
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

        with iface_lock:
            current_iface = iface
            is_connected = connected

        if current_iface is None or not is_connected:
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
            send_kwargs = {
                "text": text,
                "wantAck": want_ack,
                "channelIndex": channel_index,
            }

            if destination_id:
                send_kwargs["destinationId"] = destination_id

            print(f"[meshtastic_bridge] send request: {send_kwargs}")
            result = current_iface.sendText(**send_kwargs)
            print(f"[meshtastic_bridge] send result: {result}")

            self._send_json(200, {"ok": True, "result": str(result)})
        except Exception as exc:
            print(f"[meshtastic_bridge] send failed: {exc}")
            self._send_json(500, {"ok": False, "error": str(exc)})

    def log_message(self, format: str, *args) -> None:
        return


def main() -> None:
    pub.subscribe(on_receive, "meshtastic.receive.text")
    pub.subscribe(on_connection_established, "meshtastic.connection.established")
    pub.subscribe(on_connection_lost, "meshtastic.connection.lost")

    connector = threading.Thread(target=connector_loop, daemon=True)
    connector.start()

    print(f"[meshtastic_bridge] serving on http://{BRIDGE_HOST}:{BRIDGE_PORT}")
    server = HTTPServer((BRIDGE_HOST, BRIDGE_PORT), BridgeHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()