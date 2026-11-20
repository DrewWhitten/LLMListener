# Third-party license texts

License and notice files for the software that a packaged LLMListener release contains. They are copied from each project's own repository or site and are included in every release zip by `tools/build_release.py`.

The speech engine in a release is the `vosk-browser` 0.0.8 bundle (`vosk.js`, and `vosk-worker.js` extracted from it). According to vosk-browser's build files, that bundle is compiled from the components below.

| Component | License | File here |
|---|---|---|
| vosk-browser 0.0.8 (Ciaran O'Reilly), including the tiny-kaldi WASM bindings (Denis Treskunov) | Apache-2.0 | `vosk-browser-NOTICE.txt`, `vosk-browser-COPYING.txt` |
| Vosk API (Alpha Cephei) | Apache-2.0 | `vosk-api-COPYING.txt` |
| vosk-model-small-en-us-0.15 (Alpha Cephei) | Apache-2.0 | `vosk-api-COPYING.txt` (same license text) |
| Kaldi | Apache-2.0 | `kaldi-COPYING.txt` |
| OpenFst 1.8.0 | Apache-2.0 | `openfst-COPYING.txt` |
| CLAPACK 3.2.1 (via clapack-wasm) | Modified BSD (LAPACK license) | `clapack-LICENSE.txt` |
| zlib 1.2.13 | zlib license | `zlib-LICENSE.txt` |
| libarchive 3.5.1 | BSD 2-Clause, with some files under other permissive terms | `libarchive-COPYING.txt` |
| Emscripten runtime | MIT / University of Illinois-NCSA | `emscripten-LICENSE.txt` |
| uuid 9.0.0 | MIT | `uuid-LICENSE.md` |
| tslib 2.4 | 0BSD | `tslib-LICENSE.txt` |
| rollup-plugin-web-worker-loader | MIT | `rollup-plugin-web-worker-loader-LICENSE.txt` |

Notes on accuracy:

- `clapack-LICENSE.txt` is the license file from the current LAPACK reference repository. CLAPACK 3.2.1 is a C translation of LAPACK 3.2.1 and is distributed under the same modified BSD terms; the copyright years in this copy are newer than that release.
- `openfst-COPYING.txt` comes from a GitHub mirror of OpenFst, which is otherwise distributed as tarballs from openfst.org.
- `emscripten-LICENSE.txt`, `kaldi-COPYING.txt` and `vosk-*` files are from each project's default branch, not from the exact revision vosk-browser was built with.

This list was assembled by reading vosk-browser's `builder/Dockerfile` and `lib/package.json`. It is a good-faith inventory, not a legal audit.
