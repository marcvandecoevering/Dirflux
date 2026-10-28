# Install Dirflux on Unraid

## Through Apps

Search for **Dirflux** in Apps and click **Install**. Choose your files folder, leave Appdata separate, and enter an **Initial administrator password** of at least 12 characters. Click **Apply**, open **WebUI**, and sign in as `admin` with that password.

New empty storage folders are prepared automatically. No XML download, console command or installation code is needed. If Dirflux is not yet visible in your Apps catalog, use **Add Container** below.

## Through Docker → Add Container

| Setting | Value |
| --- | --- |
| Name | `Dirflux` |
| Repository | `ghcr.io/marcvandecoevering/dirflux:beta` |
| Network | `Bridge` |
| Port | Host `8094` → container `8094`, TCP |
| Files path | Your host folder → `/files`, read/write |
| Appdata path | `/mnt/user/appdata/dirflux` → `/config`, read/write |
| Variable `INITIAL_ADMIN_PASSWORD` | Your chosen password, 12–1024 characters |

Click **Apply** and open `http://YOUR-SERVER:8094`. Sign in as `admin`. Use another host port if 8094 is already occupied. Privileged mode is not needed.

The [Apps template](https://github.com/marcvandecoevering/unraid-templates/blob/main/templates/dirflux.xml) also supplies restricted container settings automatically. For the same restrictions in a manual installation, use Advanced View → Extra Parameters:

```text
--read-only --cap-drop=ALL --cap-add=CHOWN --cap-add=FOWNER --cap-add=DAC_OVERRIDE --cap-add=SETUID --cap-add=SETGID --security-opt=no-new-privileges --tmpfs=/tmp:rw,noexec,nosuid,size=64m
```

## Storage and accounts

Keep Files and Appdata separate, with neither inside the other. The initializer prepares only empty mount roots, then runs the app as `PUID=99` / `PGID=100`. Existing files and their permissions are preserved. When using an existing folder, the selected user must already have access. Set `PUID` and `PGID` only if your storage uses different numeric ownership.

The initial password creates an account only on a new installation. Changing that variable later does not reset any password. It may be removed after setup; Docker settings remain visible to server administrators. Change account passwords inside Dirflux. Optional `INITIAL_ADMIN_NAME` changes the initial username.

## Updates

Use Unraid's normal **Check for Updates → Update** with the `beta` image tag. Back up both storage folders before updating. The beta channel advances only after release verification; versioned tags remain available for controlled deployments and rollback with matching backups.

For an existing beta.2 installation, change **Repository** once from `ghcr.io/marcvandecoevering/dirflux:0.1.0-beta.2` to `ghcr.io/marcvandecoevering/dirflux:beta` and apply. Keep both storage paths. Your account and password stay valid; no initial-password variable is required for an existing account. Existing `--user=99:100` settings remain supported for already prepared folders.

## Optional settings

- `READ_ONLY=true` disables file changes. `/files` can also be mounted read-only; `/config` must remain writable.
- Use an HTTPS proxy for remote access and set `COOKIE_SECURE=true`. Leave it unset for LAN HTTP access.
- All accounts share the files mounted at `/files`.

[Configuration](OPERATIONS.md) · [Releases](https://github.com/marcvandecoevering/Dirflux/releases) · [Support](https://github.com/marcvandecoevering/Dirflux/issues)
