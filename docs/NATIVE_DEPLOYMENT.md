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

A process manager must use the selected release's directory as its working directory and preserve the external environment-file path. Configure automatic restart after failures, but stop the service deliberately during updates. OS-specific service installers are not yet supplied or verified.

## Update procedure

1. Read the target release's notes, Node requirements, migration instructions and rollback restrictions. Review the release's published verification results when releases become available.
2. Extract the target archive into a new release directory. Run `npm ci --omit=dev --ignore-scripts` there. Keep the previous release and its dependencies intact.
3. Stop the application and confirm its process has exited. Stop other programs that write into the file tree for the duration of the backup. Do not run two app instances against the same configuration directory.
4. Back up **both complete storage directories together**, the external environment file, and the previous application version. Preserve permissions. Configuration includes SQLite state, possible WAL/SHM files, move-recovery records and trash. Copying only `state.sqlite` while the app is running is not a consistent backup.
5. Change the process manager's application directory to the new release, retaining the same absolute storage paths, then start it.
6. Check `/api/health`, sign in with an existing account, open an existing file and check an existing share link. Test an upload, download and deletion/restore using disposable files. An unexpected setup screen means the app did not find the existing accounts: stop and verify the storage paths before creating another administrator.
7. Keep the previous release and the stopped-state backup until the update has been verified. Record the release version and update date.

The app does not replace its own code automatically. Repository dependency checks and update PRs support maintenance, but updates must be reviewed, tested and released before users install them.

## Recovery after a failed update

Stop the new application and retain its current storage directories for investigation. If release notes explicitly permit switching back without a data restore, follow those instructions. Otherwise, do not point an older executable at a database a newer release may have migrated.

Restore the **matching files and configuration snapshot** into two new, separate directories. Point a separate copy of the environment file at these restored paths, select the previous application release, and start it. Verify the account, original file contents and links before returning the service to use. Keep the failed candidate's data untouched until recovery is confirmed.

Restoring a snapshot also restores its sessions, passwords, links and trash state. Changes made after the backup are absent from the restored tree. Reconcile required later files deliberately from the retained candidate data; do not merge SQLite files or discard move journals to force startup. A rollback can restore a previously revoked link or session, so review access changes made after the snapshot.

## Current evidence and limits

`npm run test:package` packs and installs the actual release archive with production dependencies only. It starts the application, checks bundled editor/PDF assets, creates an account, uploads a file and creates a public link. It then stops the app, backs up both data trees, installs the archive into a second release directory and verifies persistent access. After changing the file, it restores the snapshot into fresh storage and verifies the original account, link and contents without overwriting the candidate's data.

This test currently passes on Windows. The two release directories use the **same current build**. It verifies installation switching and backup restoration, not cross-version database migration or downgrade. Linux/macOS runs are configured in GitHub CI but have not run there yet. Published-release upgrade pairs, OS service integration, permissions under real service accounts and recovery on network storage remain release gates.
