# Droppy Next — working title

A self-hosted file manager being rebuilt around droppy's functionality, with a maintained backend and a new identity. **Development preview: not yet a stable release or an approved Unraid Community Applications listing.** The final name and logo are still being selected.

The implementation uses Node.js 24, Express, SQLite, CodeMirror 6 and PDF.js. Browser assets are served locally. There is no external CDN, telemetry or automatic application-code updater.

## Project status

[Functional comparison and release gates](docs/PARITY.md) records the reference behavior, available evidence and outstanding work. Existing droppy users, credentials, files, links and configuration do not need migration and are not imported. The new UI may differ visually while preserving the original capabilities.

Current verification on Windows: 22 automated tests pass, upload replace/keep-both flows were checked in a browser, and the native release archive starts after a clean production-only installation. GitHub CI is configured for Windows, Linux and macOS, plus a restricted Linux container test; these workflows have **not yet run on GitHub**. The local Docker engine is unavailable, so container support is not yet verified.

## Run from source

Requires Node.js 24 and npm.

```sh
npm ci
npm start
```

Open http://127.0.0.1:8094/. On the first start, read `data/config/setup-token` locally and enter that installation code when creating your administrator account. Choose a password of at least 12 characters. There is no default account. The one-time code is removed after setup and is never returned by the API.

The default server binds only to loopback. Files are stored in `data/files/`. Configuration, credentials, sessions, temporary uploads and trash are stored in `data/config/`. Both are excluded from Git and release packages.

`npm start` builds browser assets when missing. After changing `src/extras.js`, run `npm run build`. For source development use `npm run dev`.

## Native release package (without Docker)

Prepare a release archive from source:

```sh
npm run package
npm run test:package
```

The archive contains the application, built browser assets, licenses and an `npm-shrinkwrap.json` identical to the audited lockfile. It contains neither dependencies nor user data. After extracting it into a new directory:

```sh
cd package
npm ci --omit=dev
npm start
```

Only production dependencies are needed; the editor and PDF assets have already been built. Keep `FILES_DIR` and `CONFIG_DIR` outside versioned application directories when deploying updates. No stable downloadable release has been published yet.

## Docker (under validation)

```sh
docker compose up -d --build
```

The example creates separate file and configuration volumes and binds `127.0.0.1:8094`. The image defaults to UID/GID 1000:1000; a container user override can select another existing UID/GID. For Unraid the planned test uses 99:100. Bind-mounted directories must be writable by the configured container user. Do not recursively change ownership of existing user storage as part of container startup.

Read `/config/setup-token` from the container console for the initial administrator setup. Both `/config` and `/files` must be persistent. They must not be nested, including through symbolic links. `/config` must be writable even when `/files` is mounted read-only.

Container verification, on a Linux Docker host:

```sh
docker build -t local/file-app-ci .
node scripts/container-smoke.js local/file-app-ci
```

The smoke test uses temporary data, UID/GID 99:100, a read-only container root, no Linux capabilities and no-new-privileges. It tests uploads, restart persistence and a read-only files mount. A passing Compose configuration check alone does not prove any of these behaviors.

## Implemented capabilities

- Directory browsing, sorting, navigation history and two independent file/editor panes.
- File and folder creation, rename, move, copy, clipboard operations and search.
- Multiple-file and folder uploads, drag/drop, progress and cancellation. Conflicts offer replace, keep both or skip. Replacements verify the original target version again before committing.
- Text editing with syntax highlighting, themes, find/replace, indentation, wrapping and save-conflict checks. Preference changes update both open editors without discarding unsaved text or undo history.
- Image/video gallery, audio playback, PDF viewer and byte-range media requests.
- File downloads, directory ZIP archives and revocable public links with optional expiration. Links follow file and directory renames/moves. Pending moves temporarily suspend affected links; startup recovers their destinations using the persisted move intent and filesystem identity.
- Recoverable trash, restoration and explicit permanent removal.
- Administrator, editor and viewer accounts; administrators can edit roles and reset other users’ passwords, revoking their sessions. Own password changes require the current password.
- Filesystem notifications over SSE with a 15-second browser polling fallback.

All users share one file tree; accounts do not provide isolated home directories. Viewers can read and download. Editors can change files and create links. Administrators can manage users and all shares/trash. Anyone holding a valid share link can access its target without signing in; sharing a directory includes files added later.

## Configuration

Environment variables are read from the process. To use `.env`, copy `.env.example`, edit it, build assets, and run `node --env-file=.env server.js`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address; container default is `0.0.0.0` |
| `PORT` | `8094` | HTTP port |
| `FILES_DIR` | `data/files` | User files; container `/files` |
| `CONFIG_DIR` | `data/config` | SQLite, setup code, temporary uploads and trash; container `/config` |
| `MAX_UPLOAD_BYTES` | `10737418240` | Maximum upload size, 10 GiB by default; `0` removes the application size limit |
| `MAX_TEXT_BYTES` | `2097152` | Maximum UTF-8 editor file size in bytes; configurable from 1 byte to 64 MiB |
| `UPLOAD_TIMEOUT_MS` | `604800000` | Maximum time to receive an authenticated upload, 7 days by default; integer from 1 to 2147483647 ms |
| `READ_ONLY` | `false` | Deny file changes and new public links |
| `WATCH` | `true` | Enable native recursive filesystem notifications |
| `IGNORE_PATTERNS` | `[]` | JSON array of root-relative glob patterns, for example `["**/*.tmp","**/.env","private"]` |
| `POLLING_INTERVAL_MS` | `15000` | Periodically invalidate folder sizes and refresh connected clients; `0` disables this fallback |
| `COOKIE_SECURE` | `false` | Require HTTPS for session cookies when `true` |

For network mounts, periodic refresh works even when native filesystem notifications are unavailable. It refreshes on every interval rather than scanning the entire tree for changes; directory sizes are recalculated on demand. `WATCH=false` disables native notifications independently of periodic refresh. Disabling both means externally changed folder sizes can remain cached until an app mutation or restart.

Ignore patterns use [picomatch](https://github.com/micromatch/picomatch) glob syntax with `/` separators and include dotfiles. Matching is case-insensitive on Windows. Excluding a directory excludes its descendants. Rules apply to listings, search, sizes, previews, downloads, archives, public links and write destinations; restart after changing configuration. Existing links cannot bypass new exclusions. Moving, copying or trashing an entire directory containing excluded entries is rejected, rather than silently moving or deleting hidden content. Choose its visible entries individually. Patterns are exclusion predicates, not an ordered gitignore file with re-inclusion rules.

For an HTTPS reverse proxy, enable `COOKIE_SECURE=true` and preserve the original Host header. Set proxy request-size and timeout limits for expected uploads. The application does not trust forwarded headers for authentication or rate limiting. Proxy subpath hosting is not yet supported/verified.

Upload deadlines close the connection and discard the incomplete temporary file; retry the upload after a timeout. Receiving uploads does not block other file operations. Publication is serialized and rechecks session validity and destination conflicts before changing a file. The HTTP listener allows the configured upload duration while retaining a separate 60-second header timeout. Proxy timeouts can still end transfers earlier.

## Security boundaries and remaining limits

- Passwords use salted scrypt. Session cookies are HttpOnly and SameSite=Strict; sessions expire after seven days. Mutations require a CSRF token and check browser Origin when present.
- Initial account creation requires the server-side one-time installation code. Public/no-login browsing is not implemented yet.
- Paths reject traversal, Windows alternate streams/device names and symbolic links/junctions. User HTML/SVG is not rendered as executable content under the app origin. Internal `.app-tmp-` paths cannot be accessed through file APIs.
- Same-filesystem moves use atomic rename and a SQLite intent journal. An ambiguous interrupted move prevents startup rather than guessing a link destination. Preserve both storage directories and investigate the recorded operation before recovery; do not discard the journal. Cross-filesystem moves are not implemented yet.
- Application mutations are serialized. External processes can still modify the same filesystem independently; this application is not a sandbox against a hostile process with write access to its storage. Use one app process per configuration directory.
- ZIP, recursive copy and search currently cap a tree at 25,000 items; search displays at most 1,000 results. Large-tree parity and performance remain release work.
- The text editor currently supports UTF-8 files up to 2 MiB. Browser folder uploads omit empty folders. Interrupted uploads are not resumable; the original droppy upload handler also did not implement resuming.
- Media format support depends on the browser; there is no transcoding. Office and unsupported binary files download instead of previewing.
- Cross-filesystem moves, advanced gallery behavior, no-login mode and several original server settings still require parity work. See the comparison rather than assuming complete parity from this feature summary.
- Uploads stage in `/config/tmp`; reserve enough disk space. Atomic publication uses a temporary sibling file and hard links for new files, which requires filesystem hard-link support. Replaced files are not versioned. Trash occupies space until permanently removed.
- For consistent backups, stop the app and back up both the files directory and the entire configuration directory, including SQLite WAL files if present. Upgrade and rollback procedures still need end-to-end verification.

## Tests and maintenance

```sh
npm run check
npm test
npm run build
npm run test:package
npm audit --audit-level=high
```

Integration tests use temporary storage only. A separate disposable browser demo is available with `node scripts/demo.js` at http://127.0.0.1:18094/, account `demo`, password `demo-uitsluitend-lokaal`. This account is never created in the actual application or container.

Dependabot configuration checks npm dependencies, the Docker base image and GitHub Actions weekly. CI runs tests, builds browser assets, checks known dependency advisories and verifies packages. These become active only after publication to GitHub. Updates still need review, testing and release; users must install those releases. See [security policy](SECURITY.md).

## License and attribution

New code is BSD-2-Clause licensed. The current prototype still uses droppy's original visual assets under their original licenses; its name/logo will be replaced before publication. Third-party licensing is documented in `THIRD_PARTY_NOTICES.md` and `LICENSE.droppy`.

Original reference: https://github.com/silverwind/droppy
