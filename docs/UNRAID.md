# Install Dirflux on Unraid

## Through Apps

When Dirflux appears in Community Applications, search for **Dirflux**, click **Install**, choose your files folder and host port, then click **Apply**. Open **WebUI** to finish setup. The template supplies the container settings below.

The central [Unraid catalog](https://github.com/marcvandecoevering/unraid-templates) is registered. Dirflux visibility in Apps has not yet been confirmed. If it is not available, use **Add Container** below; downloading an XML file is not required.

## Through Docker → Add Container

Choose an empty template and enter:

| Setting | Value |
| --- | --- |
| Name | `Dirflux` |
| Repository (Docker image, not GitHub URL) | `ghcr.io/marcvandecoevering/dirflux:0.1.0-beta.2` |
| Network type | `Bridge` |
| Port mapping | Host `8094` → container `8094`, TCP; choose another host port if occupied |
| Files path | Your files folder → `/files`, read/write |
| Appdata path | `/mnt/user/appdata/dirflux` → `/config`, read/write |
| Console shell | `Shell` (`sh`) |
| Privileged | Off |

In **Advanced View**, set **Extra Parameters** to:

```text
--user=99:100 --read-only --cap-drop=ALL --security-opt=no-new-privileges --tmpfs=/tmp:rw,noexec,nosuid,size=64m
```

No environment variables are required for ordinary use. The image already sets its listening address, port and internal storage paths. `PUID` and `PGID` variables are not supported by this version; `--user=99:100` selects the Unraid user instead.

Click **Apply**, then open `http://YOUR-SERVER:8094` (or your chosen host port).

### Storage permissions in beta 2

Both host folders must be writable by UID 99/GID 100. Keep `/config` separate from and outside the files folder. This image runs without root privileges and cannot repair root-owned folders that Docker may create for missing bind-mount paths. Prepare writable folders before starting; if startup fails with a permission error, check those two folders' ownership and permissions. Do not recursively change ownership of an existing share.

## First administrator

Open the container's **Console** and run:

```sh
cat /config/setup-token
```

Enter this one-time code in the WebUI and choose an administrator password of at least 12 characters. There is no default login. The code prevents another visitor from claiming a newly started installation and is removed after setup.

## Optional settings and updates

- `READ_ONLY=true` disables file changes. You may also mount `/files` read-only; `/config` must stay writable.
- For remote access, use an HTTPS reverse proxy and set `COOKIE_SECURE=true`. Leave it unset for HTTP access on your LAN.
- All accounts share the files exposed through `/files`; mount only what you intend to manage.
- Before updating, stop Dirflux and back up both folders. This beta uses a fixed image tag: change **Repository** to the new release's tag and apply, preserving the paths. Checking for image updates alone does not change a fixed version tag.

[Configuration](OPERATIONS.md) · [Releases](https://github.com/marcvandecoevering/Dirflux/releases) · [Support](https://github.com/marcvandecoevering/Dirflux/issues)
