# Dirflux

<img src="public/brand/dirflux-192.png" alt="Dirflux" width="96" height="96">

[![Verify](https://github.com/marcvandecoevering/Dirflux/actions/workflows/ci.yml/badge.svg)](https://github.com/marcvandecoevering/Dirflux/actions/workflows/ci.yml)

Your files, in your browser, on your own server. Browse two folders side by side, upload, edit text, preview images/PDFs/media, share links and recover deleted files.

**Beta:** Unraid Apps submission is being prepared. [Releases](https://github.com/marcvandecoevering/Dirflux/releases) · [Support](https://github.com/marcvandecoevering/Dirflux/issues)

## Get started

**Unraid:** use the [installation guide](docs/UNRAID.md). Dirflux is not yet listed in Community Applications.

**Without Docker:** install Node.js 24.22.1 or newer, clone this repository, then run:

```sh
npm ci
npm start
```

Open `http://127.0.0.1:8094`. Read `data/config/setup-token` to create your administrator account. There is no default password.

**Docker:** [build locally or install a published image](docs/OPERATIONS.md#build-docker-locally). Persist `/files` and `/config` separately. Use HTTPS for remote access.

## Technology and security

| Area | Dependencies / behavior |
| --- | --- |
| Language & server | JavaScript, Node.js 24.22.1+, Express 5; SQLite database |
| Browser | CodeMirror 6 text editor, PDF.js, native browser media codecs; all assets served locally |
| Network | HTTP or HTTPS (native TLS 1.2+), JSON API, Server-Sent Events and HTTP range downloads |
| Storage | Local or host-mounted files; no built-in SMB, FTP or WebDAV server |
| Privacy | No telemetry, CDN or third-party account required |
| Updates | Versioned releases; dependency and container vulnerability checks; updates require installation |

All users share one file tree. Public links grant access without login. Media is not transcoded. Keep private configuration outside shared files, back up both directories and use one app process per configuration directory. Do not give untrusted host processes write access to this storage.

See [security and known limitations](SECURITY.md), [dependency versions](package.json) and [third-party licenses](THIRD_PARTY_NOTICES.md). A passing scan does not prove that software has no vulnerabilities. [Report security issues privately](https://github.com/marcvandecoevering/Dirflux/security/advisories/new).

[Configuration & backups](docs/OPERATIONS.md) · [Native deployment](docs/NATIVE_DEPLOYMENT.md) · [Contributing](CONTRIBUTING.md)

BSD-2-Clause. Inspired by [droppy](https://github.com/silverwind/droppy); original assets retain their [attribution](LICENSE.droppy).
