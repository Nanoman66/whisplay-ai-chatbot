# Meshtastic Mode

This fork adds a Meshtastic communicator mode to Whisplay AI Chatbot.

## Architecture

This mode does not own the radio directly.

Instead, it assumes a local Meshtastic node is already running on the same Raspberry Pi through `meshtasticd`. The Whisplay application acts as the user interface and workflow layer on top of that node.

Current intended deployment:

- Raspberry Pi Zero 2 W
- PiSugar Whisplay hardware
- Adafruit RFM95W radio
- `meshtasticd` running locally
- Meshtastic API available on `localhost:4403`

## Goals

- Reuse Whisplay display, button, microphone, and speaker support
- Provide a compact Meshtastic communicator workflow
- Keep radio ownership and low-level protocol handling in `meshtasticd`
- Make the integration shareable back to the community

## Status

Initial scaffold only.
No voice workflow or STT pipeline is implemented yet.