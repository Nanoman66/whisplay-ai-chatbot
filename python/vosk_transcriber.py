#!/usr/bin/env python3
import argparse
import json
import os
import sys
import wave

try:
    from vosk import Model, KaldiRecognizer, SetLogLevel
except ImportError:
    print(
        "Python package 'vosk' is not installed. Install it with: "
        "python3 -m pip install vosk --break-system-packages",
        file=sys.stderr,
    )
    sys.exit(2)


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    sys.exit(2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Path to a Vosk model directory")
    parser.add_argument("--input", required=True, help="Path to an input WAV file")
    args = parser.parse_args()

    if not os.path.isdir(args.model):
        fail(f"Vosk model directory does not exist: {args.model}")

    if not os.path.isfile(args.input):
        fail(f"Audio file does not exist: {args.input}")

    SetLogLevel(-1)

    try:
        with wave.open(args.input, "rb") as wf:
            channels = wf.getnchannels()
            sample_width = wf.getsampwidth()
            frame_rate = wf.getframerate()
            compression = wf.getcomptype()

            if channels != 1:
                fail(f"Expected mono WAV input, got {channels} channels")
            if sample_width != 2:
                fail(f"Expected 16-bit WAV input, got sample width {sample_width}")
            if compression != "NONE":
                fail(f"Expected uncompressed PCM WAV input, got compression {compression}")

            model = Model(args.model)
            recognizer = KaldiRecognizer(model, frame_rate)
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

            print(" ".join(parts).strip())
    except wave.Error as exc:
        fail(f"Invalid WAV file: {exc}")


if __name__ == "__main__":
    main()