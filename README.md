# Dirflux

<img src="public/brand/dirflux-192.png" alt="Dirflux" width="96" height="96">

[![Verify](https://github.com/marcvandecoevering/Dirflux/actions/workflows/ci.yml/badge.svg)](https://github.com/marcvandecoevering/Dirflux/actions/workflows/ci.yml)

Your files, in your browser, on your own server. Browse two folders side by side, upload, edit text, preview images/PDFs/media, share links and recover deleted files.

**Beta:** [Releases](https://github.com/marcvandecoevering/Dirflux/releases) · [Support](https://github.com/marcvandecoevering/Dirflux/issues)

## Get started

### Install on Unraid

Find **Dirflux** in **Apps**, select **Install**, choose your files folder and enter an **Initial administrator password** of 12–1024 characters. Click **Apply**, open **WebUI**, and sign in as `admin`.

### Manual installation (Docker → Add Container)

Start with an empty template and fill in these fields:

| Field | Enter |
| --- | --- |
| Name | `Dirflux` |
| Repository | `ghcr.io/marcvandecoevering/dirflux:beta` |
| Network Type | `Bridge` |
| Privileged | `Off` |
| WebUI (Advanced View) | `http://[IP]:[PORT:8094]/` |

Use **Add another Path, Port, Variable, Label or Device** for each row below. These are **separate fields**, not combined mappings. **Name** is a display label; container paths, ports and variable keys must match exactly.

| Config Type | Name (display label) | Container Port / Container Path / Key | Host Port / Host Path / Value | Other setting |
| --- | --- | --- | --- | --- |
| Port | Web interface | `8094` | `8094` | Connection Type: `TCP` |
| Path | Files | `/files` | `/mnt/user/dirflux` | Access Mode: `Read/Write` |
| Path | Appdata | `/config` | `/mnt/user/appdata/dirflux` | Access Mode: `Read/Write` |
| Variable | Initial administrator password | `INITIAL_ADMIN_PASSWORD` | Your chosen password, 12–1024 characters | Required for a new installation |
| Variable | User ID | `PUID` | `99` | Default Unraid user ID |
| Variable | Group ID | `PGID` | `100` | Default Unraid group ID |

For the password entry, enter `INITIAL_ADMIN_PASSWORD` in **Key** and your password in **Value**. Enter values without backticks or quotation marks. Keep the WebUI placeholders literally as shown.

Choose another **host port** if 8094 is occupied; keep **container port** 8094. You can change the Files host folder, but Files and Appdata must stay separate, with neither inside the other. Existing files are preserved and must already be accessible to the configured user.

Click **Apply**. Unraid downloads the public image automatically; no GitHub account, clone or manual image download is needed. Open **WebUI** or `http://YOUR-SERVER:8094` (using your chosen host port), then sign in as `admin` with your chosen password. The Repository field takes the image address above, not the GitHub website URL.

See the [Unraid guide](docs/UNRAID.md) for container restrictions, updates and HTTPS settings.

### Other installation options

**Without Docker:** install Node.js 24.22.1 or newer, clone this repository, then run:

```sh
npm ci
npm start
```

Open `http://127.0.0.1:8094`. Read `data/config/setup-token` to create your administrator account. There is no default password.

**Docker:** install [`ghcr.io/marcvandecoevering/dirflux:beta`](docs/OPERATIONS.md#install-the-docker-image) (AMD64 / ARM64). Persist `/files` and `/config` separately. Use HTTPS for remote access.

## Technology and security

| Area | Dependencies / behavior |
| --- | --- |
| Language & server | JavaScript, Node.js 24.22.1+, Express 5; SQLite database |
| Browser | CodeMirror 6 text editor, PDF.js, native browser media codecs; all assets served locally |
| Network | HTTP or HTTPS (native TLS 1.2+), JSON API, Server-Sent Events and HTTP range downloads |
| Storage | Local or host-mounted files; no built-in SMB, FTP or WebDAV server |
| Privacy | No telemetry, CDN or third-party account required |
| Updates | Daily security scans; automatic patched images when fixes are available; install updates through Unraid |

All users share one file tree. Public links grant access without login. Media is not transcoded. Keep private configuration outside shared files, back up both directories and use one app process per configuration directory. Do not give untrusted host processes write access to this storage.

See [security and known limitations](SECURITY.md), [dependency versions](package.json) and [third-party licenses](THIRD_PARTY_NOTICES.md). A passing scan does not prove that software has no vulnerabilities. [Report security issues privately](https://github.com/marcvandecoevering/Dirflux/security/advisories/new).

[Configuration & backups](docs/OPERATIONS.md) · [Native deployment](docs/NATIVE_DEPLOYMENT.md) · [Contributing](CONTRIBUTING.md)

BSD-2-Clause. Inspired by [droppy](https://github.com/silverwind/droppy); original assets retain their [attribution](LICENSE.droppy).
