# Contributing

Thanks for your interest. This is a small hobby project, so the process is light: open an issue or a pull request, and say what you tested.

## Good first contributions

**A tuning profile for your wake word.** Any English word the speech model knows can be a wake word, but each one needs a short list of similar-sounding "decoy" words to stop near-misses from triggering it. Profiles live in `PROFILES` in `extension/wake.js`. To make one:

1. Set your wake word in Settings and use it for a day or two.
2. Open **Details** on the home screen. The log shows every word the recognizer heard and its confidence.
3. When something other than the wake word triggers it, add that word to the profile's `decoys`. Leave out words that are almost identical to the wake word: they capture the wake word itself.
4. If "continue *wake word*" is misheard as "continue *something else*", add the something else to `afterContinue`.

Say in the pull request how you tested it (your own voice, how many tries, how noisy the room was).

**Reports from real rooms.** False triggers, misses, and what was playing in the background are all useful, even without a fix. Paste the relevant lines from the Details log.

## Setting up

```
python tools/fetch_vendor.py
```

Then load the `extension` folder unpacked in `chrome://extensions`. See the README for the rest.

## Tests

The tests run in a browser against a local server and use synthesized speech; see the Tests section of the README. Please run `tools/sim.html` and `tools/test.html` before sending a change to the listener, the wake engine or the session logic, and say so in the pull request.

They show that the logic works. They do not show how reliable detection is in a real room, so changes to detection also need a note on how they behaved with a real voice.

## Scope

The extension drives claude.ai's web interface, which can change without notice. Fixes that keep it working are always welcome. Please keep the project unofficial in tone: no Anthropic or Claude logos, and no wording that suggests endorsement.

## License

By contributing you agree that your contribution is licensed under the Apache License, Version 2.0, the same as the project.
