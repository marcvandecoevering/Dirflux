# Original configuration comparison

Reference: droppy 12.2.0, commit `70b61d1ac7c2ce8045e07f4716b6a01abadf6296`, README Options and server/cfg.js. This table describes current behavior, not a claim that release parity is complete. Existing configuration migration is outside the requested scope.

| Original option | Current equivalent or difference | Status |
| --- | --- | --- |
| `listeners` | `HOST`, `PORT`, optional `TLS_CERT_FILE`/`TLS_KEY_FILE`; one HTTP or HTTPS listener. Default loopback:8094 instead of all interfaces:8989. | Multiple listeners and Unix sockets are not implemented. |
| `public` | `PUBLIC_MODE`, false by default. Public visitors receive bounded guest sessions with CSRF checks. | Implemented and tested; intentional authentication implementation difference. |
| `timestamps` | Startup and error output uses console logging without an application timestamp switch. | Not matched. |
| `linkLength` | Fixed 32 random bytes, encoded as 43 URL-safe characters, instead of five-character defaults. | Intentional security change; short configurable tokens are not offered. |
| `linkExtensions` | `LINK_EXTENSIONS`, false by default. Displays the current target's final extension, URI-encoded. The stored random ID stays unchanged. | Implemented; see checks below. |
| `logLevel` | Startup/error logging only, no request/debug verbosity setting. | Not matched. |
| `maxFileSize` | `MAX_UPLOAD_BYTES`; zero is unlimited. Default 10 GiB rather than unlimited. | Implemented and tested; default differs. |
| `updateInterval` | `UPDATE_INTERVAL_MS`, default 1000 ms, zero sends immediately. Native and polling notifications share a coalescing window whose deadline is not reset by later changes. | Implemented; continuous polling and bounded event delivery tested. |
| `pollingInterval` | `POLLING_INTERVAL_MS`, default 15 seconds, zero disables. Periodic invalidation/SSE refresh instead of recursively polling every file. | Equivalent refresh intent, different implementation/default; actual SMB/NFS evaluation pending. |
| `keepAlive` | `KEEP_ALIVE_MS`, default 20000 ms, zero disables comments. SSE replaces WebSocket transport. Session validity checks remain independent, at most 20 seconds apart. | Configurable and disabled heartbeat tested; exact proxy needs remain deployment-specific. |
| `uploadTimeout` | `UPLOAD_TIMEOUT_MS`, seven days by default. Receiving deadlines clean temporary uploads. | Implemented and tested. |
| `allowFrame` | Same-origin frames are required for panes; unrelated origins are denied by CSP and X-Frame-Options. | External embedding opt-in is not implemented. |
| `readOnly` | `READ_ONLY` plus account roles. | Implemented and tested. |
| `dev` | `npm run dev` uses Node watch; browser assets have a separate build step. | No equivalent browser live reload/minification toggle. |
| `ignorePatterns` | `IGNORE_PATTERNS` JSON array, picomatch; excluded entries are also denied on direct access and mutations. | Implemented and tested, with stricter access rules. |
| `watch` | `WATCH`, enabled by default, independent of periodic refresh. | Implemented and tested. |
| `headers` | Fixed application security headers and the supplied reverse-proxy configuration. | Arbitrary application response-header configuration is not implemented. |

Additional settings include separate files/config directories, text-edit limits, secure-cookie enforcement and a live guest-session cap. See the README for their supported values. A proxy may provide deployment capabilities, but its availability alone does not establish equivalent application behavior.

## Extension-link checks

`test/share-extensions.test.js` runs actual HTTP requests against disposable storage. It verifies normal, extension-free and Unicode-extension URLs; full random token length; public download and byte ranges; unchanged MIME type when a caller substitutes `.html`; list/create URL consistency; old links after rename; configuration changes after restart; and revocation of all suffix variants. Invalid boolean configuration fails startup before opening storage.

The suffix is descriptive, never a path or authorization lookup. The random ID before the first dot identifies the stored link; the current stored target determines download name, MIME type and content. Disabling `LINK_EXTENSIONS` changes displayed/new URLs but does not invalidate previously distributed URLs. Directory downloads retain their existing ZIP behavior; as in the original, the optional displayed suffix is taken from the target path, not forcibly changed to `.zip`.

Browser copy/list flows with the option enabled still need a dedicated check. Public HTML/other active content continues to follow the existing attachment and MIME restrictions.
