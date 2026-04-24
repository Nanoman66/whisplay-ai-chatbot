#!/usr/bin/env python3
import argparse
import json
import os
import sys
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    from vosk import Model, KaldiRecognizer, SetLogLevel
except ImportError:
    print(
        "Python package 'vosk' is not installed. Install it with: "
        "python3 -m pip install vosk --break-system-packages",
        file=sys.stderr,
        flush=True,
    )
    sys.exit(2)

MODEL = None


def fail(message: str) -> None:
    print(message, file=sys.stderr, flush=True)
    sys.exit(2)


def transcribe_wav(audio_path: str) -> str:
    global MODEL

    if MODEL is None:
        raise RuntimeError("Vosk model is not loaded")

    if not os.path.isfile(audio_path):
        raise FileNotFoundError(f"Audio file does not exist: {audio_path}")

    with wave.open(audio_path, "rb") as wf:
        channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        frame_rate = wf.getframerate()
        compression = wf.getcomptype()

        if channels != 1:
            raise ValueError(f"Expected mono WAV input, got {channels} channels")
        if sample_width != 2:
            raise ValueError(f"Expected 16-bit WAV input, got sample width {sample_width}")
        if compression != "NONE":
            raise ValueError(f"Expected uncompressed PCM WAV input, got compression {compression}")

        recognizer = KaldiRecognizer(MODEL, frame_rate)
        recognizer.SetWords(False)

        parts = []

        while True:
            data = wf.readframes(4000)
            if not data:
                break

            if recognizer.AcceptWaveform(data):
                result = json.loads(recognizer.Result())
                text = result.get("text", "").strip()
                if text:
                    parts.append(text)

        final_result = json.loads(recognizer.FinalResult())
        final_text = final_result.get("text", "").strip()
        if final_text:
            parts.append(final_text)

        return " ".join(parts).strip()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def _send_json(self, status_code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"ok": True})
            return

        self._send_json(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if self.path != "/transcribe":
            self._send_json(404, {"ok": False, "error": "Not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
            payload = json.loads(raw_body.decode("utf-8"))
        except Exception as exc:
            self._send_json(400, {"ok": False, "error": f"Invalid JSON: {exc}"})
            return

        audio_path = str(payload.get("input", "")).strip()
        if not audio_path:
            self._send_json(400, {"ok": False, "error": "Missing input"})
            return

        try:
            text = transcribe_wav(audio_path)
            self._send_json(200, {"ok": True, "text": text})
        except Exception as exc:
            self._send_json(500, {"ok": False, "error": str(exc)})


def main() -> None:
    global MODEL

    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Path to a Vosk model directory")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host")
    parser.add_argument("--port", type=int, default=4411, help="Bind port")
    args = parser.parse_args()

    if not os.path.isdir(args.model):
        fail(f"Vosk model directory does not exist: {args.model}")

    SetLogLevel(-1)

    print(f"[vosk-server] loading model from {args.model}", flush=True)
    MODEL = Model(args.model)
    print("[vosk-server] model loaded", flush=True)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[vosk-server] serving on http://{args.host}:{args.port}", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()