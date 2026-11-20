"""Build a ready-to-load release zip.

The zip contains the complete extension, including the third-party speech engine and model,
so a user only has to unzip it and choose the folder in chrome://extensions > Load unpacked.
Because it redistributes that third-party software, it also carries the license and notice
files that their licenses require.

    python tools/fetch_vendor.py      # once, if extension/vendor and extension/models are empty
    python tools/build_release.py     # writes dist/LLMListener-v<version>.zip
"""
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
LICENSES = ROOT / "third_party_licenses"
REQUIRED = [
    EXT / "vendor" / "vosk.js",
    EXT / "vendor" / "vosk-worker.js",
    EXT / "models" / "vosk-model-small-en-us-0.15.tar.gz",
]
ALREADY_COMPRESSED = {".gz", ".zip", ".png", ".jpg"}

MODIFICATIONS = """\
Modifications to third-party files in this package
==================================================

This package redistributes third-party software under the Apache License 2.0 and other
permissive licenses (see THIRD-PARTY-NOTICES.md and the third_party_licenses folder).
As required by section 4(b) of the Apache License, the changes made to those files are
stated here.

vendor/vosk.js
    Unmodified copy of dist/vosk.js from the vosk-browser 0.0.8 npm package.

vendor/vosk-worker.js
    MODIFIED. This file does not exist upstream. It is the Web Worker source that
    vosk.js embeds as a base64 string, extracted into its own file so that it can be
    loaded under a Chrome extension's Content-Security-Policy (which forbids blob:
    workers). Three functions of the Emscripten runtime inside it were replaced with
    equivalents that do not build code from strings (the policy also forbids eval):
        createNamedFunction
        craftInvokerFunction
        __emval_get_method_caller
    The replacements are adapted from Emscripten's own no-dynamic-execution versions.
    The change is made by tools/extract_worker.py in the LLMListener repository:
    https://github.com/DrewWhitten/LLMListener

models/vosk-model-small-en-us-0.15.tar.gz
    The contents are the unmodified files of vosk-model-small-en-us-0.15 as published
    at https://alphacephei.com/vosk/models. Only the container was changed, from .zip
    to .tar.gz, because vosk-browser loads models in that format.
"""

INSTALL = """\
LLMListener {version}
A hands-free listening device for LLMs. Unofficial; not affiliated with Anthropic.

Install
-------
1. Unzip this file somewhere permanent. Chrome loads the extension from that folder
   every time it starts, so do not delete or move it afterwards.
2. In Chrome, open chrome://extensions and turn on "Developer mode" (top right).
3. Click "Load unpacked" and choose the unzipped folder (the one containing
   manifest.json).
4. Sign in to claude.ai in the same Chrome profile and allow it to use the microphone.
5. The clock home screen opens. Allow the microphone, then click Settings (bottom
   right) and choose your wake word.

Say your wake word to start a new voice conversation, or "continue" followed by your
wake word to reopen the last one.

More: https://github.com/DrewWhitten/LLMListener
"""


def main():
    missing = [str(p.relative_to(ROOT)) for p in REQUIRED if not p.exists()]
    if missing:
        raise SystemExit("missing (run tools/fetch_vendor.py first): " + ", ".join(missing))

    version = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))["version"]
    top = f"LLMListener-v{version}"
    out = ROOT / "dist" / f"{top}.zip"
    out.parent.mkdir(exist_ok=True)

    # Apache License 2.0, section 4(d): carry the upstream NOTICE text in ours.
    notice = (
        (ROOT / "NOTICE").read_text(encoding="utf-8").rstrip()
        + "\n\n"
        + "=" * 78
        + "\nThis package includes vosk-browser. Its NOTICE file follows.\n"
        + "=" * 78
        + "\n\n"
        + (LICENSES / "vosk-browser-NOTICE.txt").read_text(encoding="utf-8")
    )

    count = 0
    with zipfile.ZipFile(out, "w") as z:
        def add_file(path, arcname):
            nonlocal count
            method = zipfile.ZIP_STORED if path.suffix in ALREADY_COMPRESSED else zipfile.ZIP_DEFLATED
            z.write(path, f"{top}/{arcname}", compress_type=method)
            count += 1

        def add_text(text, arcname):
            nonlocal count
            z.writestr(f"{top}/{arcname}", text, compress_type=zipfile.ZIP_DEFLATED)
            count += 1

        for path in sorted(EXT.rglob("*")):
            if path.is_file() and not path.name.startswith("~$"):
                add_file(path, path.relative_to(EXT).as_posix())

        add_file(ROOT / "LICENSE", "LICENSE")
        add_file(ROOT / "THIRD-PARTY-NOTICES.md", "THIRD-PARTY-NOTICES.md")
        add_text(notice, "NOTICE")
        add_text(MODIFICATIONS, "MODIFICATIONS.txt")
        add_text(INSTALL.format(version=version), "INSTALL.txt")
        for path in sorted(LICENSES.iterdir()):
            if path.is_file():
                add_file(path, f"third_party_licenses/{path.name}")

    print(f"wrote {out} ({out.stat().st_size / 1e6:.1f} MB, {count} files)")


if __name__ == "__main__":
    main()
