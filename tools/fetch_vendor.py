"""Download the third-party speech engine and model that the extension needs.

They are not kept in the repository. This fetches:

  extension/vendor/vosk.js          vosk-browser 0.0.8 (Vosk compiled to WebAssembly)
  extension/vendor/vosk-worker.js   extracted from vosk.js and patched for extension pages
  extension/models/vosk-model-small-en-us-0.15.tar.gz   small English model, repacked

    python tools/fetch_vendor.py            # into extension/
    python tools/fetch_vendor.py --dest X   # into X/vendor and X/models instead
"""
import argparse
import io
import pathlib
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
VOSK_JS = "https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js"
MODEL = "vosk-model-small-en-us-0.15"
MODEL_ZIP = f"https://alphacephei.com/vosk/models/{MODEL}.zip"


def download(url):
    print("downloading", url)
    request = urllib.request.Request(url, headers={"User-Agent": "fetch-vendor"})
    with urllib.request.urlopen(request) as response:
        return response.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dest", default=str(ROOT / "extension"))
    dest = pathlib.Path(parser.parse_args().dest).resolve()
    (dest / "vendor").mkdir(parents=True, exist_ok=True)
    (dest / "models").mkdir(parents=True, exist_ok=True)

    (dest / "vendor" / "vosk.js").write_bytes(download(VOSK_JS))

    # vosk-browser wants the model as a .tar.gz with one top-level folder; the official
    # download is a .zip with the same layout, so repack it.
    archive = zipfile.ZipFile(io.BytesIO(download(MODEL_ZIP)))
    out = dest / "models" / f"{MODEL}.tar.gz"
    with tarfile.open(out, "w:gz") as tar:
        for info in archive.infolist():
            if not info.filename.startswith(MODEL + "/"):
                raise SystemExit(f"unexpected path in model archive: {info.filename}")
            member = tarfile.TarInfo(info.filename.rstrip("/"))
            if info.is_dir():
                member.type = tarfile.DIRTYPE
                member.mode = 0o755
                tar.addfile(member)
            else:
                data = archive.read(info)
                member.size = len(data)
                member.mode = 0o644
                tar.addfile(member, io.BytesIO(data))
    print(f"wrote {out} ({out.stat().st_size} bytes)")

    subprocess.run(
        [sys.executable, str(ROOT / "tools" / "extract_worker.py"), "--dest", str(dest)],
        check=True,
    )


if __name__ == "__main__":
    main()
