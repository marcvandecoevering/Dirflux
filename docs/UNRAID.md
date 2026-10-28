# Install Dirflux on Unraid

## Through Apps

Search for **Dirflux** in Apps and click **Install**. Choose your files folder, leave Appdata separate, and enter an **Initial administrator password** of at least 12 characters. Click **Apply**, open **WebUI**, and sign in as `admin` with that password.

New empty storage folders are prepared automatically. No XML download, console command or installation code is needed. If Dirflux is not yet visible in your Apps catalog, use **Add Container** below.

## Through Docker → Add Container

1. Open the **Docker** tab in Unraid and click **Add Container**. Start with an empty template.
2. In **Repository**, paste this complete image address:

   ```text
   ghcr.io/marcvandecoevering/dirflux:beta
   ```

   This is the published Docker image in GitHub Container Registry (GHCR). The GitHub source repository URL (`https://github.com/marcvandecoevering/Dirflux`) does not go in this field. The image is public; no GitHub login, repository clone or manual download is required.
3. Fill in the container fields:

   | Field | Enter |
   | --- | --- |
   | Name | `Dirflux` |
   | Network Type | `Bridge` |
   | Privileged | `Off` |
   | WebUI (Advanced View) | `http://[IP]:[PORT:8080]/` |

4. Use **Add another Path, Port, Variable, Label or Device** to add each row below as a separate entry. **Name** is only the display label. Enter the exact variable name in **Key**, and its setting in **Value**. For paths and ports, fill in the separate container and host fields.

   | Config Type | Name (display label) | Container Port / Container Path / Key | Host Port / Host Path / Value | Other setting |
   | --- | --- | --- | --- | --- |
   | Port | Web interface | `8080` | `8094` | Connection Type: `TCP` |
   | Path | Files | `/files` | `/mnt/user/dirflux` | Access Mode: `Read/Write` |
   | Path | Appdata | `/config` | `/mnt/user/appdata/dirflux` | Access Mode: `Read/Write` |
   | Variable | Initial administrator password | `INITIAL_ADMIN_PASSWORD` | Your chosen password, 12–1024 characters | Required for a new installation |
   | Variable | User ID | `PUID` | `99` | Default Unraid user ID |
   | Variable | Group ID | `PGID` | `100` | Default Unraid group ID |

   For example, **Initial administrator password** is the label, `INITIAL_ADMIN_PASSWORD` is the **Key**, and your password is the **Value**. Container Path must be `/config`, not `config`. Enter values without backticks or quotation marks. Keep the WebUI placeholders literally as shown; Unraid replaces them with your server address and host port.

   Choose another **host port** if 8094 is occupied; leave **container port** at 8080. You may choose a different Files host folder. Keep Files and Appdata separate, with neither inside the other.

5. Click **Apply**. Unraid automatically downloads the image from GHCR and starts the container. Wait for startup, then open **WebUI** from the container menu, or visit `http://YOUR-SERVER:8094` using your chosen host port. Sign in as `admin` with the password you entered.

The [Apps template](https://github.com/marcvandecoevering/unraid-templates/blob/main/templates/dirflux.xml) also supplies restricted container settings automatically. For the same restrictions in a manual installation, use Advanced View → Extra Parameters:

```text
--read-only --cap-drop=ALL --cap-add=CHOWN --cap-add=FOWNER --cap-add=DAC_OVERRIDE --cap-add=SETUID --cap-add=SETGID --security-opt=no-new-privileges --tmpfs=/tmp:rw,noexec,nosuid,size=64m
```

## Storage and accounts

Keep Files and Appdata separate, with neither inside the other. The initializer prepares only empty mount roots, then runs the app as `PUID=99` / `PGID=100`. Existing files and their permissions are preserved. When using an existing folder, the selected user must already have access. Set `PUID` and `PGID` only if your storage uses different numeric ownership.

The initial password creates an account only on a new installation. Changing that variable later does not reset any password. It may be removed after setup; Docker settings remain visible to server administrators. Change account passwords inside Dirflux. Optional `INITIAL_ADMIN_NAME` changes the initial username.

## Updates

**Upgrading from beta.10 or earlier to beta.11 or newer:** the internal container port changes from `8094` to `8080`. Edit the container's Web interface port entry and set **Container Port** to `8080`; keep your existing **Host Port** (for example `8093` or `8094`). If Unraid does not let you edit the container port, remove that port entry and add it again with the same host port and container port `8080`. Set **WebUI** in Advanced View to `http://[IP]:[PORT:8080]/`. Remove an old explicit `PORT=8094` variable or change it to `8080`; custom `LISTENERS` also override the default. Apply the settings and update the image. Your browser URL and tunnel destination stay the same when the host port is unchanged. Installing a new image alone does not change a saved Unraid port mapping.

Use Unraid's normal **Check for Updates → Update** with the `beta` image tag. Back up both storage folders before updating. The beta channel advances only after release verification; versioned tags remain available for controlled deployments and rollback with matching backups.

For an existing beta.2 installation, change **Repository** once from `ghcr.io/marcvandecoevering/dirflux:0.1.0-beta.2` to `ghcr.io/marcvandecoevering/dirflux:beta` and apply. Keep both storage paths. Your account and password stay valid; no initial-password variable is required for an existing account. Existing `--user=99:100` settings remain supported for already prepared folders.

## Optional settings

- `READ_ONLY=true` disables file changes. `/files` can also be mounted read-only; `/config` must remain writable.
- Use an HTTPS proxy for remote access and set `COOKIE_SECURE=true`. Leave it unset for LAN HTTP access.
- All accounts share the files mounted at `/files`.

[Configuration](OPERATIONS.md) · [Releases](https://github.com/marcvandecoevering/Dirflux/releases) · [Support](https://github.com/marcvandecoevering/Dirflux/issues)
