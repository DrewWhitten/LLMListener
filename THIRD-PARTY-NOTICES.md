# Third-party notices

## Code included in this repository

### Emscripten

`tools/extract_worker.py` contains replacements for three functions of the Emscripten runtime (`createNamedFunction`, `craftInvokerFunction` and `__emval_get_method_caller`). They are adapted from the versions Emscripten itself uses when built without dynamic code execution. Emscripten is available under the MIT license:

```
Copyright (c) 2010-2014 Emscripten authors, see AUTHORS file.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

Source: https://github.com/emscripten-core/emscripten

## Software downloaded at setup, not included here

`tools/fetch_vendor.py` downloads the following from their publishers. They are not part of this repository and are not covered by this project's license.

| Software | Publisher | License |
|---|---|---|
| [vosk-browser](https://github.com/ccoreilly/vosk-browser) 0.0.8 | Ciaran O'Reilly | Apache License 2.0 |
| [Vosk](https://github.com/alphacep/vosk-api) speech recognition toolkit | Alpha Cephei | Apache License 2.0 |
| [vosk-model-small-en-us-0.15](https://alphacephei.com/vosk/models) | Alpha Cephei | Apache License 2.0 |

The vosk-browser bundle itself embeds further components (including Kaldi, OpenFst, libarchive and the Emscripten runtime), each under its own license.

The setup step modifies one of these files locally: `extension/vendor/vosk-worker.js` is extracted from `vosk.js` and three functions are replaced so that it runs under a Chrome extension's Content-Security-Policy.

## Packaged releases

A release zip built by `tools/build_release.py` does include those files, so it redistributes them. To meet their license terms, every release zip carries:

- `LICENSE`: the Apache License 2.0 text
- `NOTICE`: this project's notice followed by vosk-browser's own NOTICE file
- `MODIFICATIONS.txt`: a statement of what was changed in the third-party files
- `third_party_licenses/`: the license and notice files of vosk-browser and of each component compiled into it, with an index in `third_party_licenses/README.md`

**If you redistribute those files yourself** (in a fork's release, or by publishing to an extension store), keep all of the above with them.
