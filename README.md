# Dirflux

<img src="public/brand/dirflux-192.png" alt="Dirflux logo" width="96" height="96">

[![Verify](https://github.com/marcvandecoevering/Dirflux/actions/workflows/ci.yml/badge.svg)](https://github.com/marcvandecoevering/Dirflux/actions/workflows/ci.yml)

A self-hosted file manager being rebuilt around droppy's functionality, with a maintained backend and a new identity. **Development preview: not yet a stable release or an approved Unraid Community Applications listing.** The selected name is Dirflux; the app now uses its own logo. Source: [marcvandecoevering/Dirflux](https://github.com/marcvandecoevering/Dirflux).

The implementation uses Node.js 24, Express, SQLite, CodeMirror 6 and PDF.js. Browser assets are served locally. There is no external CDN, telemetry or automatic application-code updater.

## Project status

[Functional comparison and release gates](docs/PARITY.md) records the reference behavior, available evidence and outstanding work. Existing droppy users, credentials, files, links and configuration do not need migration and are not imported. The new UI may differ visually while preserving the original capabilities.

Verification results are tied to specific source revisions in the [evidence log](docs/PARITY.md); later changes require their own relevant checks. The amd64 Linux suite has been exercised with production dependencies, a read-only container root and temporary test storage. Windows skips Linux/mount-specific checks. Real cross-filesystem moves, recovery after interruption and continued public-link access are verified using two disposable Linux mounts. Browser checks cover upload replace/keep-both flows and concurrent uploads with independent cancellation. The native release archive passes production-only installation, switching installation directories with persistent data, and restoring a consistent backup into separate storage. Both installations use the current build; cross-version migrations are not verified. GitHub CI is configured for Windows, Linux and macOS, plus restricted Linux container tests on amd64 and ARM64 runners; these workflows have **not yet run on GitHub**. The amd64 and ARM64 images pass the Docker Desktop Linux-volume smoke test (ARM64 runs under emulation here): UID/GID 99:100, actual uploaded-file ownership, read-only container root, no capabilities, healthcheck, restart persistence and a read-only files volume. Linux host bind mounts, physical ARM64 hardware and Unraid itself remain unverified.

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

Follow the [native installation, update and recovery procedure](docs/NATIVE_DEPLOYMENT.md) for persistent paths, stopped-state backups, installation switching and restoring a previous snapshot.

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

The smoke test uses temporary data, UID/GID 99:100, a read-only container root, no Linux capabilities and no-new-privileges. It tests uploads, restart persistence and a read-only files mount. On Windows this uses temporary Linux volumes with copying disabled to preserve assigned ownership; Linux CI uses temporary host bind mounts. A passing Compose configuration check alone does not prove any of these behaviors.

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

The [original configuration comparison](docs/CONFIG_PARITY.md) records supported equivalents, intentional differences and remaining gaps.

Application logs are JSON lines, with errors on stderr and other levels on stdout. HTTP records contain the method, route template, status and elapsed milliseconds, not the raw URL, file path, query, headers, body or share ID. Error records use error codes rather than potentially private exception messages. This does not control Node runtime warnings, failures before application startup, or logs produced by your reverse proxy. Configure log rotation in Docker or your service manager; the application does not create its own log files.

Environment variables are read from the process. To use `.env`, copy `.env.example`, edit it, build assets, and run `node --env-file=.env server.js`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address; container default is `0.0.0.0` |
| `PORT` | `8094` | HTTP port |
| `ALLOW_FRAME` | `false` | Allow other origins to embed the application; session cookie and mutation protections stay enabled |
| `RESPONSE_HEADERS` | `{}` | JSON object of extra response headers; string values or arrays of strings; application-owned fields are reserved |
| `LISTENERS` | unset | JSON array of 1..32 TCP endpoints (`host`, `port`, optional `ipv6Only`) or Unix endpoints (`path`); overrides `HOST`/`PORT` |
| `FILES_DIR` | `data/files` | User files; container `/files` |
| `CONFIG_DIR` | `data/config` | SQLite, setup code, temporary uploads and trash; container `/config` |
| `MAX_UPLOAD_BYTES` | `10737418240` | Maximum upload size, 10 GiB by default; `0` removes the application size limit |
| `MAX_TEXT_BYTES` | `2097152` | Maximum UTF-8 editor file size in bytes; configurable from 1 byte to 64 MiB |
| `LINK_EXTENSIONS` | `false` | Append the target's extension to displayed public share URLs; existing suffixed and unsuffixed URLs remain valid until expiry/revocation |
| `LOG_LEVEL` | `2` | Application JSON-line logs: 0 off, 1 errors, 2 startup/HTTP requests, 3 live-connection diagnostics |
| `LOG_TIMESTAMPS` | `true` | Include UTC ISO timestamps in application log records |
| `UPLOAD_TIMEOUT_MS` | `604800000` | Maximum time to receive an authenticated upload, 7 days by default; integer from 1 to 2147483647 ms |
| `READ_ONLY` | `false` | Deny file changes and new public links |
| `MAX_PUBLIC_SESSIONS` | `1000` | Maximum live guest sessions (1–1000000); existing sessions and account login remain available at capacity |
| `PUBLIC_MODE` | `false` | Allow visitors without accounts; they can edit shared files unless `READ_ONLY=true` |
| `WATCH` | `true` | Enable native recursive filesystem notifications |
| `UPDATE_INTERVAL_MS` | `1000` | Coalesce change notifications over this interval; `0` sends immediately. Continuous changes do not reset the pending deadline |
| `KEEP_ALIVE_MS` | `20000` | SSE keepalive interval; `0` disables heartbeat comments. Session validity is still checked at least every 20 seconds |
| `IGNORE_PATTERNS` | `[]` | JSON array of root-relative glob patterns, for example `["**/*.tmp","**/.env","private"]` |
| `POLLING_INTERVAL_MS` | `15000` | Periodically invalidate folder sizes and refresh connected clients; `0` disables this fallback |
| `COOKIE_SECURE` | `false` | Require HTTPS for session cookies when `true` |
| `TLS_CERT_FILE` | unset | PEM certificate/full chain for native HTTPS; requires `TLS_KEY_FILE` |
| `TLS_KEY_FILE` | unset | PEM private key for native HTTPS; must be outside `FILES_DIR` |

For network mounts, periodic refresh works even when native filesystem notifications are unavailable. It refreshes on every interval rather than scanning the entire tree for changes; directory sizes are recalculated on demand. `WATCH=false` disables native notifications independently of periodic refresh. Disabling both means externally changed folder sizes can remain cached until an app mutation or restart.

Public mode mirrors droppy's public file access: visitors receive a session automatically and can browse, upload, edit, move, delete and share files. Combine `PUBLIC_MODE=true` with `READ_ONLY=true` for read-only browsing. Visitors share one public identity for their links and trash; those items are visible to other visitors. Visitors cannot manage accounts or change passwords. Use **Sign in** or `/?login=1` for account login or initial administrator setup, which still requires the server-side setup code. Disabling public mode and restarting denies guest sessions access; independently created public share links keep their normal validity until revoked. Public mode is opt-in and is not enabled in the default deployment. Guest sessions expire after seven days. At `MAX_PUBLIC_SESSIONS`, new visitors without a valid cookie receive HTTP 503 with Retry-After; existing sessions remain valid, and `/?login=1` still permits account login or protected setup. Expired sessions are reclaimed when creating a session, and logout frees a slot. This limits guest database growth, but does not replace request-rate and connection limits at an Internet-facing reverse proxy.

Ignore patterns use [picomatch](https://github.com/micromatch/picomatch) glob syntax with `/` separators and include dotfiles. Matching is case-insensitive on Windows. Excluding a directory excludes its descendants. Rules apply to listings, search, sizes, previews, downloads, archives, public links and write destinations; restart after changing configuration. Existing links cannot bypass new exclusions. Moving, copying or trashing an entire directory containing excluded entries is rejected, rather than silently moving or deleting hidden content. Choose its visible entries individually. Patterns are exclusion predicates, not an ordered gitignore file with re-inclusion rules.

For an HTTPS reverse proxy, enable `COOKIE_SECURE=true` and preserve the original Host header. Set proxy request-size and timeout limits for expected uploads. The application does not trust forwarded headers for authentication or rate limiting. Proxy subpath hosting is not yet supported/verified.

For native HTTPS without a reverse proxy, configure both TLS file paths and restart. Listeners inherit HTTPS unless their protocol is explicitly set to `http`. HTTPS supports TLS 1.2 or newer and always marks session cookies Secure. HTTP cookies follow `COOKIE_SECURE`; forwarded protocol headers do not change this behavior. There is no automatic HTTP redirect. Supply a certificate trusted by your users' browsers for the actual hostname, with its certificate chain and matching unencrypted PEM key. Restrict key-file permissions to the service account; do not store the key in shared files. Restart after certificate renewal. Test certificates under `test/fixtures/` are public fixtures and must never be deployed.

For multiple interfaces, set `LISTENERS='[{"host":"127.0.0.1","port":8094},{"host":"::1","port":8094,"ipv6Only":true}]'`. All endpoints share the same application, accounts and sessions. Omit `protocol` to inherit global TLS settings, or set `protocol` to `http` or `https` for each endpoint. HTTPS endpoints may provide their own `certFile` and `keyFile` together; otherwise they require the global certificate/key pair. All configured certificates are validated before opening storage. A later bind failure closes earlier endpoints and fails startup. Unix sockets are supported on Linux/macOS with `LISTENERS='[{"path":"/run/file-manager/app.sock"}]'`. Create the parent directory outside `FILES_DIR`, restrict it to the service and intended reverse-proxy accounts, and give the service permission to create the socket. Socket permissions follow the process umask. The application does not remove existing files or stale socket paths to take over an address. Normal shutdown removes its socket; after an unclean shutdown, verify no service is using it before manually removing a stale socket. Windows uses TCP endpoints. For mixed protocols, for example, use `LISTENERS='[{"host":"127.0.0.1","port":8094,"protocol":"http"},{"host":"127.0.0.1","port":8443,"protocol":"https","certFile":"/etc/file-manager/fullchain.pem","keyFile":"/etc/file-manager/privkey.pem"}]'`. Keep every private key outside `FILES_DIR`. Cookies are scoped by hostname, not port; use distinct hostnames when separating HTTP and HTTPS access for browsers.

`ALLOW_FRAME=true` permits external pages to embed the app, matching droppy's opt-in framing behavior. It removes `X-Frame-Options` and the CSP `frame-ancestors` restriction; all other CSP directives, CSRF checks and `HttpOnly; SameSite=Strict` session cookies remain. Enable it only for an intended embedding deployment: unrestricted framing removes the browser's ancestor-based clickjacking defense. A reverse proxy can restrict `frame-ancestors` to your actual portal origins. Cross-origin embedding on the same site (for example a different port) can retain session access, while a cross-site iframe may not receive session cookies and browser third-party-cookie policies still apply. The option does not bypass those policies. See [MDN's framing and cookie explanation](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/Clickjacking).

`RESPONSE_HEADERS='{"X-Deployment":"home","Permissions-Policy":"camera=(), microphone=()"}'` adds deployment headers to responses. Names are case-insensitive and must be unique. Values must be strings or arrays of 1..16 strings, with at most 32 headers, 4096 bytes per value and 16384 bytes overall (including names/separators). Invalid HTTP characters and newlines fail startup before storage opens. Authentication/cookies, CORS, redirects, CSP/framing, content representation, transfer and cache headers belong to the application and cannot be overridden with this option. Use supported settings such as `ALLOW_FRAME` for their corresponding behavior; do not place secrets in extra headers because browsers can read them.

`node lib/health-check.js` checks the first configured HTTP/HTTPS listener, including a Unix socket. Wildcard TCP binds use the matching loopback address. For HTTPS it pins the server certificate to the endpoint's `certFile`, falling back to `TLS_CERT_FILE`, so a public hostname certificate can be checked over loopback without accepting a different certificate. The container healthcheck uses this command and passes the local restricted-container smoke checks.

Upload deadlines close the connection and discard the incomplete temporary file; retry the upload after a timeout. Receiving uploads does not block other file operations. Publication is serialized and rechecks session validity and destination conflicts before changing a file. The HTTP listener allows the configured upload duration while retaining a separate 60-second header timeout. Proxy timeouts can still end transfers earlier.

Folder drag-and-drop includes empty directories when the browser exposes directory entries. The legacy folder selection input supplies only files, so empty folders are not represented by that picker. Existing destination folders are merged; a file blocking an incoming directory produces an error and is never overwritten automatically.

## Security boundaries and remaining limits

- Passwords use salted scrypt. Session cookies are HttpOnly and SameSite=Strict; sessions expire after seven days. Mutations require a CSRF token and check browser Origin when present.
- Initial account creation requires the server-side one-time installation code, including when optional public/no-login browsing is enabled. Public sessions retain CSRF and Origin checks for mutations; they do not grant account administration.
- Paths reject traversal, Windows alternate streams/device names and symbolic links/junctions. User HTML/SVG is not rendered as executable content under the app origin. Internal `.app-tmp-` paths cannot be accessed through file APIs.
- Editor reads, save-version checks and public text previews enforce their byte limits during reading, including when files grow after the initial size check. Oversized public previews fall back to streamed downloads.
- Same-filesystem moves use atomic rename and a SQLite intent journal. An ambiguous interrupted move prevents startup rather than guessing a link destination. Preserve both storage directories and investigate the recorded operation before recovery; do not discard the journal. Cross-filesystem moves use staged copies and journaled publication/cleanup; actual Linux mount-boundary and restart tests preserve contents and share links.
- Application mutations are serialized. External processes can still modify the same filesystem independently; this application is not a sandbox against a hostile process with write access to its storage. Use one app process per configuration directory.
- Directory sizes, transfer validation and ZIP downloads iterate entries without a fixed tree-size cap. ZIP creation waits for each entry instead of queuing every file stream at once. A fixture with 25,006 files verifies size calculation, a same-filesystem move and complete ZIP entry count. Dedicated Linux checks also verify a ZIP64 entry larger than 4 GiB and 65,540 unique archive entries. A separate disk-backed check also verifies a downloaded ZIP larger than 4 GiB, including offsets beyond the 32-bit boundary. Search scans incrementally without that item cap and returns pages of 1,000 matches, with a 30-second deadline per request. Use More results to continue. Pages reflect the live filesystem, not a snapshot; after file changes, refresh to restart the search. Once extra pages are loaded, automatic search refresh pauses so it does not discard those pages. Large network trees and sustained-load performance remain release work.
- The text editor currently supports UTF-8 files up to 2 MiB. Interrupted uploads are not resumable; the original droppy upload handler also did not implement resuming.
- Media format support depends on the browser; there is no transcoding. Office and unsupported binary files download instead of previewing.
- Cross-filesystem moves, advanced gallery behavior, no-login mode and several original server settings still require parity work. See the comparison rather than assuming complete parity from this feature summary.
- Uploads stage in `/config/tmp`; reserve enough disk space. Atomic publication uses a temporary sibling file and hard links for new files, which requires filesystem hard-link support. Replaced files are not versioned. Trash occupies space until permanently removed.
- For consistent backups, stop the app and back up both the files directory and the entire configuration directory, including SQLite WAL files if present. Switching installation directories and restoring a stopped-state backup pass using the current build; cross-version upgrades and downgrades remain unverified.

## Tests and maintenance

See [CONTRIBUTING.md](CONTRIBUTING.md) for reporting defects, comparing original functionality, local development and review expectations. GitHub issue forms and a pull-request template are included; their live rendering remains to be verified after repository publication.

```sh
npm run check
npm test
npm run build
npm run test:package
npm audit --audit-level=high
```

Integration tests use temporary storage only. A separate disposable browser demo is available with `node scripts/demo.js` at http://127.0.0.1:18094/, account `demo`, password `demo-uitsluitend-lokaal`. This account is never created in the actual application or container.

Dependabot configuration checks npm dependencies, the Docker base image and GitHub Actions weekly. Both Docker build stages pin the same multi-architecture Node base-image digest so a reviewed revision uses an identified base; digest updates must pass the same checks before release. CI runs tests, builds browser assets, checks known dependency advisories and verifies packages. These become active only after publication to GitHub. Updates still need review, testing and release; users must install those releases. See [security policy](SECURITY.md).

## License and attribution

New code is BSD-2-Clause licensed. The current prototype still uses droppy's original visual assets under their original licenses; Dirflux uses its own name and logo. Third-party licensing is documented in `THIRD_PARTY_NOTICES.md` and `LICENSE.droppy`.

Original reference: https://github.com/silverwind/droppy

The dedicated `scripts/large-archive-smoke.js` check runs inside Linux with sparse temporary storage. It downloads and fully verifies a ZIP64 entry larger than 4 GiB, including all uncompressed bytes and CRC. It is included in container CI. The synthetic data compresses to about 4 MiB; the downloaded-size boundary is covered separately below. A separate `scripts/many-entry-archive-smoke.js` check verifies the ZIP64 record/locator and 65,540 unique files, including every local/central filename, unpacked content and CRC. Its actual downloaded archive is 8,127,084 bytes. Both checks run in the container CI configuration; they have been executed locally on Linux amd64, not on GitHub yet.

`scripts/large-output-archive-smoke.js /disposable/storage` separately verifies a ZIP download larger than 4 GiB. Run it only on Linux with an explicit disk-backed test directory and at least 6 GiB free. It creates 32,770 hard links to a 128 KiB random source, downloads to a temporary file, then reads the central directory and each entry in bounded chunks. Local amd64 verification passed with 4,300,604,574 downloaded bytes and 27 ZIP64 local-header offsets beyond 4 GiB; all filenames, contents and CRCs match. Its own temporary subdirectory is removed afterward. The amd64 container CI job includes this check; it is not part of the quick `npm test` suite.

For nginx HTTPS termination, start with [deploy/nginx.conf](deploy/nginx.conf).
Replace the hostname, certificate paths and private upstream address. Set
`COOKIE_SECURE=true` in the app and keep its HTTP port private. The example uses
an entire hostname at `/`; mounting below a URL prefix is not currently supported.
Keep the public `Host` header including its port, and disable request/response
buffering for uploads and live events. Adjust proxy timeouts to match your upload
policy. The app treats the proxy as one client for authentication rate limiting;
apply per-client limits at the proxy too. Never use the repository's synthetic
TLS certificates for deployment.

`node scripts/proxy-smoke.js` tests this template with an isolated nginx container,
temporary app storage and the test certificate trusted only by that test's HTTPS
agent. It does not install a certificate in the operating system. This passes
locally on Docker Desktop; Linux GitHub CI is configured but has not run remotely.

## Maintainer release candidates

The manually dispatched `Release candidate` workflow requires an existing version tag matching `package.json`. It resolves that tag to a commit, runs the reusable CI against that exact revision and builds a checksummed native archive. By default it only retains the candidate as a workflow artifact for 30 days.

The optional `create_draft` input creates a **draft prerelease** after those jobs succeed. Only that job receives release-write permission. It downloads the artifact from the same workflow run into a fresh directory and checks the package name/version, tag, source revision, repository, run ID, exact file set and SHA-256 before uploading. The job also resolves the remote tag again immediately before creating the draft and rejects a changed target. Protect release tags against updates/deletion in repository rules; a check cannot prevent another actor changing a tag afterward. Existing releases/assets are not overwritten; a failed or partially created draft needs inspection before retrying. A checksum is not a signature, and self-reported metadata alone does not establish provenance; the trusted workflow context supplies the expected values.

Review the draft, release notes and every public-release gate before publishing it. This workflow does not publish Docker images, mark a stable release, submit an Unraid listing or prove that CI has run remotely. Final branding and the public repository are still pending. The draft command uses GitHub CLI [release creation](https://cli.github.com/manual/gh_release_create) with `--draft`, `--prerelease` and `--verify-tag`.

Release candidates also retain the exact tested amd64 and ARM64 Docker images as separate workflow artifacts. CI builds with an OCI source-revision label, runs its container checks, then exports that image with `docker image save` without a second build. Each compressed archive includes a SHA-256 file and `container.json` recording the revision, run, platform, configuration and layer identities. The exporter refuses a dirty checkout, a mismatched revision label, an unsupported platform, an existing output directory or a tag changed during export. The revision label is a consistency check, not a signature. Ordinary CI does not retain these large archives; release-candidate calls opt in, with 30-day retention. Registry publishing must consume and verify these artifacts before promoting them; that publishing step is still pending.

Before retaining an exported image, release CI now runs `scripts/load-container-candidate.js` on the disposable runner. It verifies the exact expected source revision, repository, workflow run, platform and fixed local image name, the file set and streamed archive checksum, then imports the archive and compares its full runtime configuration and layer identities. The loader requires explicit CI context; it does not infer trusted values from the downloaded metadata. These checks establish consistency with that workflow artifact, not an independent signature or a guarantee that arbitrary third-party archives are safe to import.

CI also validates workflow definitions with [actionlint](https://github.com/rhysd/actionlint/releases/tag/v1.7.12), pinned to version 1.7.12 and its Linux archive SHA-256. This checks GitHub Actions expressions, job references and reusable-workflow inputs in addition to YAML syntax. Optional ShellCheck/Pyflakes integrations are disabled in this job; it does not claim to statically validate every embedded shell/Python program. Update the pinned version and checksum together after reviewing the upstream release and running the validator locally.
