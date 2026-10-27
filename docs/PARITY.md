# Functional parity and release evidence

Status: development, not ready for a public stable release. Working product name is still provisional.

The target is droppy's user functionality with a maintained backend and a new identity. Existing accounts, links, files and configuration do not need migration. A refreshed interface is permitted. An implementation being present is not proof that its complete user journey works.

Reference: silverwind/droppy commit `70b61d1ac7c2ce8045e07f4716b6a01abadf6296` (12.2.0). Reference files below are relative to that repository. This checkout is research material, not a runtime dependency.

| Capability | Original evidence | Current evidence / remaining work |
| --- | --- | --- |
| Directory navigation, sorting, history, dual panes | README Features; client/client.js openDirectory, createView | Implemented; basic manual browser evidence. Add repeatable browser coverage, keyboard and narrow-screen checks. |
| File/folder creation, rename, move, copy, delete | server/server.js message handlers; client context menu | Basic API tests. Original permanently deletes; current trash supports explicit permanent removal, with storage and authorization tests. Copy/move now chooses a free name when a collision occurs, like the original CLIPBOARD handler; copying in place and dotted directory names are covered by API tests. UI journeys still need verification. |
| Multiple and directory uploads; drag/drop | client/client.js upload and drop handlers | Streaming, nested paths and concurrent receiving are tested; only publication holds the mutation lock. UI replace/keep-both flow verified in a disposable browser demo. Compare empty directories and concurrent per-pane uploads. |
| Overwrite or keep both on upload | client/client.js upload lines 645–705; server/server.js upload handler | Explicit replace and unique-name APIs added, stale-target and concurrency tests pass. New UI offers replace/keep/skip; replace/keep verified in browser. |
| Resuming interrupted uploads | Same original upload handlers | NOT an original feature: XMLHttpRequest + multipart streaming, cancellation removes temporary files. Earlier claim that missing resume was a parity gap was incorrect. |
| Clipboard image/text upload | client/client.js uploadBlob | Implemented; needs browser clipboard validation. |
| Search | client/client.js doSearch; server search handler | Original search inspected: case-insensitive file-name and folder-path matching, including a single character. Implemented and tested with a strict subtree boundary; Escape clears search. Large trees and browser journeys remain. |
| Public file and directory links, ZIP | server/server.js share handler; README | Basic access, expiry, revocation and ZIP tests pass. ZIP central-directory paths and decompressed bytes, Unicode names, hidden directories, authenticated/public downloads and range are covered. Links now follow file and directory moves. Durable intent recovery is tested before/after rename, including replacement of the old name and an ambiguous identity that fails closed. Public downloads pin opened file handles; HEAD/range/suffix and ZIP cancellation tested. Large archives and cross-filesystem moves remain. Longer unguessable IDs are intentional. |
| Editor languages, themes, font, tabs, wrap, fullscreen, find/replace/save | client/client.js editor and preferences | CodeMirror 6 implemented; manual saving/syntax/PDF and two-pane checks. Live theme/font/wrap preferences update both editors without recreating documents; browser checks confirm retained unsaved text and undo history. Compare other shortcuts, encodings, original size limits and unsaved navigation. |
| Image/video touch gallery | client/client.js gallery, preferences | Basic implementation; verify formats, autoplay/next/loop, zoom, rotation, fullscreen, swipe and errors. |
| Audio playlist, seeking | client/client.js audio handlers | Implemented; verify seeking, queue progression and playback across navigation. |
| Real-time filesystem changes | README; server/filetree.js | Native SSE and periodic fallback tests pass. WATCH toggles native notifications; POLLING_INTERVAL_MS invalidates folder sizes and notifies clients (default 15s). Integration test disables native watching and verifies external file edits/deletions and SSE. Actual SMB/NFS mounts and large-tree performance still need evaluation. |
| Accounts, preferences, read-only | server/server.js settings/user handlers | Auth/roles/password/session/read-only tests; first setup requires a server-held one-time code. Administrator role editing/password reset added; tests cover authorization, self-lockout prevention, revoked sessions, old passwords and new permissions. UI validation remains. |
| Public/no-login mode | README configuration public | Missing; assess explicit opt-in public mode without exposing administration. |
| Ignore rules, watcher toggle, polling, limits | README configuration | Watch toggle, periodic refresh and picomatch ignore patterns implemented. Integration tests cover excluded descendants, listings, search, sizes, direct access, existing links and public ZIPs after restart. Exclusions additionally deny direct access and parent mutations containing excluded entries. Upload size supports 0/unlimited and rejects invalid configuration; text size is configurable up to 64 MiB with UTF-8 and JSON-escaping tests. Upload receiving deadline is configurable (7 days default); timeout/cancellation cleanup, parallel uploads, session revocation and collision tests pass. Remaining limits require mapping and implementation. Periodic refresh invalidates caches on an interval instead of scanning the entire tree. |
| Reverse proxies, base paths, HTTPS | README listeners; examples | Host/Origin checks present. Subpath and HTTPS configuration need verification and documentation. |
| Home-screen installation | README; server/manifest.js | Old manifest/icons still present. Replace identity and test new manifest/icons. |
| Native installation and service | README installation | npm ci/start works locally. Packaged release includes an audited shrinkwrap; clean production-only Windows startup verified. Linux service example and upgrade/rollback evidence remain. |
| Container and Unraid | README Docker | Dockerfile exists; local daemon unavailable. Need actual Linux image tests, UID/GID 99:100, mounts, restart, read-only filesystem, amd64/arm64, registry publication and Unraid validation. |

## Public release gates

- [ ] Every original user capability above has comparable tested behavior; intentional security changes documented explicitly.
- [ ] Backend adversarial review: path boundaries, races, authorization, resource exhaustion, unauthenticated setup, content serving, crash recovery and database/file consistency.
- [ ] Browser journeys on desktop and mobile, including keyboard navigation and accessible controls.
- [ ] Native clean install, restart, upgrade and rollback on supported OS/Node versions.
- [ ] Container built and tested with non-root Unraid UID/GID, persistent mounts and restricted capabilities.
- [ ] Final name selected after availability checks, original logo removed, own logo and install icons rendered and verified.
- [ ] Own OSI license and third-party notices complete.
- [ ] Public GitHub repository, security reporting, CI, update PRs and release artifacts verified live.
- [ ] Public image, tested Unraid XML, support destination and repository profile; validate/scan and submit through current Community Applications portal.
- [ ] Unraid listing accepted and externally verified; submission alone is not acceptance.

## Maintenance

Automated tests, scheduled dependency checks, update pull requests and a documented release procedure are required. They do not establish a promise that software is vulnerability-free. Dependency updates must be reviewed and tested before publishing an update. Do not silently enable self-updating application code on users' servers.

Current official publishing references (checked 2026-10-28):

- https://docs.unraid.net/unraid-os/manual/applications/
- https://ca.unraid.net/submit/help
- https://github.com/unraid/unraid-community-apps-starter
- https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates

## Verification increment: shared links and editor preferences

On Windows/Node 24.14.1, 22 tests pass. `npm run test:package` and `npm run check` pass. Browser verification used disposable demo files: both editors adopted 20px text and a changed theme; unsaved contents and undo history survived. No production user files were used.

Move-recovery tests inject an interruption immediately before/after filesystem rename, close the app, reopen the same SQLite/storage directories and verify the links. These are controlled failure/restart tests, not a physical power-loss test. Recovery requires stable filesystem identity and atomic same-filesystem rename. Moves between mount points need additional implementation and Linux verification.
