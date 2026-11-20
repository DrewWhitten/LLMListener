# LLMListener

A hands-free listening device for LLMs. Say a wake word and a voice conversation starts. It currently works with Claude.

> **Unofficial.** This is a personal hobby project. It is not affiliated with, endorsed by, or supported by Anthropic. "Claude" is a trademark of Anthropic.

LLMListener is a Chrome extension that turns a spare Chromebook or PC into a hands-free voice device. It shows a clock, listens offline for a wake word of your choosing, and when it hears it, opens claude.ai and starts voice mode for you. When the conversation ends it goes back to the clock.

It was inspired by hey-claude-phone, an unofficial Android project that does the same job on an old phone.

## How it behaves

1. **Idle.** A full-screen clock. The microphone is processed on the device by an offline recognizer; no audio leaves the device in this state.
2. **Wake.** Say your wake word. A chime plays and the screen pulses.
3. **Launch.** The extension opens a chat on claude.ai and clicks the voice mode button.
4. **Conversation.** Claude's own voice mode takes over. The wake word is ignored until the conversation is over; only one conversation runs at a time.
5. **Return.** When voice mode ends (the Claude tab releases the microphone), or after a configurable stretch of silence, the Claude tab is closed and listening resumes.

There are two phrases:

| You say | What happens |
|---|---|
| *wake word* | Opens a new chat and starts voice mode |
| continue *wake word* | Reopens the most recent chat it launched and starts voice mode there |

## Choosing a wake word

The wake word is a setting. The default is `computer`, which works but is a common word, so ordinary conversation or a TV will set it off now and then. Pick something distinctive that you would not say by accident.

Constraints:

- It must be a single English word that the small Vosk model knows. An unknown word never triggers.
- Words with a tuning profile work best. A profile lists similar-sounding "decoy" words so that near-misses are not mistaken for the wake word. Profiles live in `PROFILES` in `extension/wake.js`; add one for your word if you get false triggers.

## Install

Works on a Chromebook or any PC running Chrome 116 or newer. The one-time setup step needs Python 3; on a Chromebook, run it on another computer and copy the `extension` folder across.

1. Fetch the speech engine and model (about 46 MB, not kept in this repository):

   ```
   python tools/fetch_vendor.py
   ```

2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the `extension` folder.
3. Sign in to claude.ai in the same Chrome profile and set its microphone permission to **Allow**.
4. The home screen opens by itself. Allow the microphone when asked. The first load takes a few seconds while the model is unpacked and cached.
5. Open **Settings** (bottom right of the home screen) and choose your wake word.

### As a bedside device (Chromebook or PC)

- Keep it on the charger with the lid open; set it to stay awake while plugged in, and turn off the lock screen on sleep. On a Chromebook these are under Settings > Device > Power; on a Windows PC, under Settings > System > Power.
- Click the clock for full screen.
- The home screen reopens when Chrome starts.

## Settings

Wake word, continue word, detection threshold, silence timeout, the label used to find Claude's voice button, chime on/off and volume, and night dimming hours. The **Details** panel on the home screen shows what the recognizer hears, each detection's confidence, and why each conversation started and ended, which is what you need for tuning.

## How it works

- **Wake word:** [Vosk](https://alphacephei.com/vosk/) running in WebAssembly through [vosk-browser](https://github.com/ccoreilly/vosk-browser), restricted to a tiny grammar (the wake word, the continue word, decoys). Manifest V3 extension pages forbid blob workers and `eval`, both of which vosk-browser uses, so `tools/extract_worker.py` extracts its worker and patches three functions.
- **Launch:** a content script on claude.ai finds the voice button by its accessible name and clicks it.
- **End of conversation:** a small script in the claude.ai page reports how many microphone tracks the page holds. When it drops to zero, voice mode is over. A silence timer on the home screen is the backstop.

Files:

| Path | Purpose |
|---|---|
| `extension/listener.*` | Home screen: clock, microphone, state machine |
| `extension/wake.js` | Wake-word engine and per-word tuning profiles |
| `extension/background.js` | Owns the single conversation session and its tab |
| `extension/content.js`, `mic-hook.js` | Run on claude.ai: start voice mode, detect its end |
| `extension/options.*`, `settings.js` | Settings page and defaults |
| `tools/` | Setup script, dev server and tests |

## Tests

The tests run in a browser against a local server that applies the same Content-Security-Policy as an extension page. They use synthesized speech, so they show that the logic works, not how reliable detection is in a real room.

```
powershell -ExecutionPolicy Bypass -File tools\make_wavs.ps1   # Windows only: generate recordings
python tools/serve.py
```

Then open:

- `http://localhost:8377/tools/test.html`: wake phrases and near-miss words for the `skippy` profile
- `http://localhost:8377/tools/probe.html?prefix=c_&wake=computer`: what the engine hears for each recording
- `http://localhost:8377/tools/sim.html`: the whole home-screen cycle with a fake microphone
- `http://localhost:8377/tools/hooktest.html`: microphone-release detection

## Limitations

- It depends on claude.ai's web interface. If the voice button is renamed, update the label in Settings; larger changes may break it.
- Voice conversations count against your Claude plan's usage limits as usual.
- Small offline speech models make mistakes. Expect occasional false triggers and misses, and tune the threshold and decoys for your room and voice.
- English only.

## License

Licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE).

## Credits

- [Vosk](https://github.com/alphacep/vosk-api) speech recognition toolkit and the `vosk-model-small-en-us-0.15` model, by Alpha Cephei, Apache License 2.0.
- [vosk-browser](https://github.com/ccoreilly/vosk-browser) by Ciaran O'Reilly, Apache License 2.0.
- A few runtime functions in `tools/extract_worker.py` are adapted from [Emscripten](https://github.com/emscripten-core/emscripten), MIT license.

Vosk, vosk-browser and the model are not redistributed here; `tools/fetch_vendor.py` downloads them from their publishers. Details are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
