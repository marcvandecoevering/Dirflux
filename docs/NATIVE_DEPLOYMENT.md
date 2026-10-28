# Native installation, updates and recovery

This is a development preview. No stable release or public download location is available yet. The procedure below applies to the archive built by `npm run package`. Do not use a source-code archive as a substitute: it does not contain the built editor/PDF assets.

## Separate application releases from data

Use a separate application directory for each release and keep storage outside all of them:

```text
file-manager/
  releases/
    release-a/package/       application and production dependencies
    release-b/package/       next application and its own dependencies
  storage/
    files/                  user files
    config/                 database, sessions, links, trash, temporary uploads
  server.env                absolute FILES_DIR and CONFIG_DIR paths
```

Keep backups outside these directories. Restrict configuration and backup access to the service account and the administrator. Do not run the application as root/Administrator. The service account needs write access to both storage trees; read-only deployments still require writable configuration storage.

Use Node.js 24 and npm. Extract the release into a new directory, change into its `package` directory, and install the exact production dependency tree:

```sh
npm ci --omit=dev --ignore-scripts
```

The archive includes `npm-shrinkwrap.json`; do not replace this step with `npm update`. Browser assets are already included. Configure absolute `FILES_DIR` and `CONFIG_DIR` paths in the external environment file, along with `HOST`, `PORT` and the settings documented in the main README. Relative paths depend on the process working directory and can accidentally create fresh storage during an update.

Start the app using your environment file's absolute path:

```sh
node --env-file=/absolute/path/server.env server.js
```

On Windows, use a Windows absolute path for the environment file. For example, `node --env-file=C:/FileManager/server.env server.js`. Keep credentials and the setup code out of shell command arguments and logs. Read `CONFIG_DIR/setup-token` locally when creating the initial administrator.

A process manager must use the selected release's directory as its working directory and preserve the external environment-file path. Configure automatic restart after failures, but stop the service deliberately during updates. A Linux systemd unit is supplied below; Windows/macOS service installers are not yet supplied or verified.

## Linux systemd service

The release contains `deploy/file-manager.service` and `deploy/server.env.example`. These use generic deployment names while the app's final identity is being selected. The unit runs under a dedicated `file-manager` account, reads application code from `/opt/file-manager/current`, and permits writes to `/srv/file-manager/files` and `/var/lib/file-manager`. The latter holds configuration, temporary uploads and trash. `current` must point to the chosen release's `package` directory, with production dependencies installed as described above. The service account must be able to traverse/read that directory; application code and its parent directories should be administrator-owned and not writable by the service.

For a **first installation**, create the account and new empty directories. If the account, configuration or storage already exists, inspect it and retain it instead of repeating initialization or changing existing file ownership recursively:

```sh
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin file-manager
sudo install -d -o file-manager -g file-manager -m 0700 /srv/file-manager/files
sudo install -d -o root -g file-manager -m 0750 /etc/file-manager
sudo install -o root -g file-manager -m 0640 deploy/server.env.example /etc/file-manager/server.env
sudo install -o root -g root -m 0644 deploy/file-manager.service /etc/systemd/system/file-manager.service
```

Edit `/etc/file-manager/server.env` before starting. Check `command -v node` and `/usr/bin/node --version`: `ExecStart` must point to your actual Node 24 executable. Use a system-wide runtime, not one under a home directory or `/tmp`/`/var/tmp`, which this unit hides. If you change storage locations, change `ReadWritePaths` and `RequiresMountsFor` in the unit too. Existing files must be accessible to the service account; the unit does not grant it access merely by naming a directory. Home-directory storage is hidden by `ProtectHome` and requires an explicitly reviewed adjustment.

The default binds to loopback HTTP. Use the supplied nginx reverse-proxy example for remote HTTPS and set `COOKIE_SECURE=true` there. For native TLS, certificate/key paths must be readable by the service account and outside the shared file tree. Validate the adjusted unit, then start it and enable startup at boot:

```sh
sudo systemd-analyze verify /etc/systemd/system/file-manager.service
sudo systemctl daemon-reload
sudo systemctl enable --now file-manager.service
curl --fail http://127.0.0.1:8094/api/health
sudo systemctl status file-manager.service
```

Read `/var/lib/file-manager/setup-token` locally as administrator for initial setup. Use `sudo journalctl -u file-manager.service` for diagnostics. A failed health check needs investigation even if systemd reports the process as active. For an update, stop the service, follow the backup procedure below, switch `current` to the new release, and start the service. A deliberate stop does not trigger automatic restart.

The unit uses [systemd execution restrictions](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) and [failure restart behavior](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html). It restricts writes, hides home/temporary/device locations, drops capabilities and prevents privilege escalation. These settings supplement filesystem permissions; they do not isolate the app from a hostile administrator or guarantee security.

## Update procedure

1. Read the target release's notes, Node requirements, migration instructions and rollback restrictions. Review the release's published verification results when releases become available.
2. Extract the target archive into a new release directory. Run `npm ci --omit=dev --ignore-scripts` there. Keep the previous release and its dependencies intact.
3. Stop the application and confirm its process has exited. Stop other programs that write into the file tree for the duration of the backup. Do not run two app instances against the same configuration directory.
4. Back up **both complete storage directories together**, the external environment file, and the previous application version. Preserve permissions. Configuration includes SQLite state, possible WAL/SHM files, move-recovery records and trash. Copying only `state.sqlite` while the app is running is not a consistent backup.
5. Change the process manager's application directory to the new release, retaining the same absolute storage paths, then start it.
6. Check `/api/health`, sign in with an existing account, open an existing file and check an existing share link. Test an upload, download and deletion/restore using disposable files. An unexpected setup screen means the app did not find the existing accounts: stop and verify the storage paths before creating another administrator.
7. Keep the previous release and the stopped-state backup until the update has been verified. Record the release version and update date.

The app does not replace its own code automatically. Repository dependency checks and update PRs support maintenance, but updates must be reviewed, tested and released before users install them.

## Preparing a release candidate

From a clean checkout, `npm run candidate -- /absolute/new/output-directory` rebuilds browser assets, packs the actual current source, and writes the native archive, `SHA256SUMS` and `release.json` into a new directory. The metadata records the exact Git revision, version, archive name and digest. Existing output directories and dirty source checkouts are rejected. This command creates a local candidate; it does not claim the complete test suite has run, publish anything, or select the final app identity. SHA-256 checksums detect changed bytes and are not digital signatures.

The manual **Release candidate** GitHub workflow requires an existing `v<package-version>` tag. It resolves the tag to a commit, runs the reusable verification workflow on that exact commit across its configured native/container jobs, and only then builds and uploads the checksummed candidate. The final packaging step verifies the tag still identifies the checked-out commit, so moving a tag during the run fails instead of silently packaging a different revision. All jobs use read-only repository permissions. Candidate artifacts are retained for 30 days and are not a public GitHub Release or an Unraid package.

Before a public release, finalize the name/logo and repository metadata, inspect the candidate and verification results, publish versioned multi-architecture images, verify their published digests and anonymous visibility, and attach the native archive/checksums to the reviewed GitHub Release. Registry publication, release creation, and Unraid validation/submission are still outstanding; the candidate workflow does not perform those steps. GitHub's [reusable workflow documentation](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) describes how the verification workflow is called. The workflows pass local actionlint validation but have not yet run on GitHub.

## Recovery after a failed update

Stop the new application and retain its current storage directories for investigation. If release notes explicitly permit switching back without a data restore, follow those instructions. Otherwise, do not point an older executable at a database a newer release may have migrated.

Restore the **matching files and configuration snapshot** into two new, separate directories. Point a separate copy of the environment file at these restored paths, select the previous application release, and start it. Verify the account, original file contents and links before returning the service to use. Keep the failed candidate's data untouched until recovery is confirmed.

Restoring a snapshot also restores its sessions, passwords, links and trash state. Changes made after the backup are absent from the restored tree. Reconcile required later files deliberately from the retained candidate data; do not merge SQLite files or discard move journals to force startup. A rollback can restore a previously revoked link or session, so review access changes made after the snapshot.

## Current evidence and limits

`npm run test:package` packs and installs the actual release archive with production dependencies only. It starts the application, checks bundled editor/PDF assets, creates an account, uploads a file and creates a public link. It then stops the app, backs up both data trees, installs the archive into a second release directory and verifies persistent access. After changing the file, it restores the snapshot into fresh storage and verifies the original account, link and contents without overwriting the candidate's data.

This test currently passes on Windows. The two release directories use the **same current build**. It verifies installation switching and backup restoration, not cross-version database migration or downgrade. Linux/macOS runs are configured in GitHub CI but have not run there yet.

`scripts/systemd-smoke.js` has passed in Ubuntu under WSL with systemd 259 and Node 24.22.1. It installs the actual production archive into an administrator-owned temporary application directory, creates a disposable service account and runtime-only unit, and verifies a non-root UID, zero effective capabilities, no-new-privileges, rejection of writes to application code, private configuration permissions, upload ownership, automatic restart after SIGKILL, persistent account/file access and graceful shutdown. It removes its unit, account and test storage afterward. The Linux CI job is configured to run it, but no GitHub execution has occurred. Boot-time activation, other Linux distributions, Windows/macOS service integration, published-release upgrade pairs and network-storage recovery remain release gates.
