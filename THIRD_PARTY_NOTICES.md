# Third-party notices

The original droppy visual design, toolbar SVGs and logos are by silverwind and contributors, from https://github.com/silverwind/droppy (archived upstream, version 12.2.0). They are distributed under the BSD 2-Clause license reproduced in `LICENSE.droppy`. The reconstructed classic interface follows that design. The new server and application controller are independently written.

The file-icon sprite sheet in `public/original/sprites.png` is by Lars Jung (2013), under the MIT license reproduced at the beginning of `public/original/sprites.css`.

Roboto font files are supplied by the pinned `@fontsource/roboto` package. Its license is copied into `public/vendor/licenses/` by the asset build. No remote font service is used.

The editor uses CodeMirror 6 and its language packages; PDF rendering uses Mozilla PDF.js. The bundled packages' license texts are copied into `public/vendor/licenses/`. Generated JavaScript retains separate legal-comment files. The PDF standard-font and character-map directories also retain their shipped notices. See the lockfile for exact dependency versions.

The PDF.js `wasm` and `iccs` resource directories are also copied intact, including their decoder/color-profile license files. The current viewer disables eval and WebAssembly and uses the local JavaScript image-decoder fallbacks; shipping these resource directories is not a claim that ICC color-management behavior has been verified.

The asset build writes `public/vendor/licenses/packages.json`, identifying each bundled npm package, its exact version, declared license and copied notice files with SHA-256 hashes. It includes directly copied PDF.js and Roboto resources as well as packages identified by the JavaScript bundler. A missing package license text stops the build for review; root-level NOTICE, COPYING and AUTHORS files are also retained when present. The production archive smoke checks the manifest versions against its shrinkwrap and verifies every listed notice file's hash. This inventory concerns bundled browser packages; installed server dependencies retain their own upstream files in `node_modules`.

The `@uiw/codemirror-*` packages at version 4.25.12 omit the MIT license text from their npm archives. The build supplies the monorepo's license from `src/third-party-licenses/uiw-react-codemirror-4.25.12-LICENSE.txt`, copied unchanged from [upstream commit 1e2e11f865860c6bd5029d71a2a09bd894ed5bad](https://github.com/uiwjs/react-codemirror/blob/1e2e11f865860c6bd5029d71a2a09bd894ed5bad/LICENSE), the commit referenced by tag v4.25.12. Its SHA-256 is `fd1f049b3bb5cbaf5143516b72dbc6805cd30cca0cda94edb37160e37662fd17`. This fallback is restricted to that version, repository and declared MIT license; updating the dependency requires reviewing the corresponding upstream text again.

Server-side exclusion matching uses picomatch (MIT), installed as a production dependency with its upstream license. See `package-lock.json` for its pinned version.
