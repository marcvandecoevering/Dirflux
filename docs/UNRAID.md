# Install Dirflux on Unraid

Dirflux is currently a beta. Community Applications submission is being prepared; it is not yet listed in Apps.

## Install before the Apps listing

1. Download [dirflux.xml](https://raw.githubusercontent.com/marcvandecoevering/Dirflux/main/templates/dirflux.xml) to `/boot/config/plugins/dockerMan/templates-user/my-Dirflux.xml` on your Unraid server.
2. Create separate Files and Appdata directories writable by UID 99/GID 100. Use dedicated folders; never recursively change ownership of an existing share.
3. Open **Docker → Add Container**, select **Dirflux**, check both paths and choose a free host port (default `8094`). Click **Apply**.
4. Open the container console and run `cat /config/setup-token`. Open **WebUI** and use that code to create your administrator account.

## Container settings

Use the published version from [GitHub Releases](https://github.com/marcvandecoevering/Dirflux/releases). The template will select AMD64 or ARM64 automatically.

| Setting | Value |
| --- | --- |
| WebUI | `http://YOUR-SERVER:8094` |
| Container port | `8094/tcp` |
| Files | A dedicated share mapped to `/files` |
| Appdata | A separate private folder mapped to `/config` |
| Container user | `99:100` |

Create separate directories for Files and Appdata that UID 99/GID 100 can write. Do not place either directory inside the other. Do not change ownership recursively on an existing share. The template drops capabilities and runs with a read-only container root; `/files`, `/config` and temporary storage remain writable.

Open the container console and run `cat /config/setup-token`. Enter the code in the WebUI and choose an administrator password of at least 12 characters. There is no default login. The setup-token file is removed after setup.

## Use and update

- All accounts share the files you expose through `/files`. Mount only what you intend to manage.
- For read-only browsing, enable **Read only** and optionally mount `/files` read-only. `/config` must remain writable.
- Use an HTTPS reverse proxy for remote access and set **Secure cookies** to `true`. Do not enable secure cookies while accessing over HTTP.
- Before updating, stop Dirflux and back up both mapped directories. Edit **Repository** to the new release's versioned image tag and apply, preserving both paths. The template pins a version; checking for updates alone does not select a newer version tag. Keep the previous image version and matching backup for rollback.
- Removing the container must not remove your mapped directories. Keep backups outside those directories.

[Configuration](OPERATIONS.md) · [Support](https://github.com/marcvandecoevering/Dirflux/issues) · [Private security reports](https://github.com/marcvandecoevering/Dirflux/security/advisories/new)
