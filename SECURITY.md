# Security policy

This project is in development. No stable version or public security-support commitment has been issued. Do not interpret test results or dependency scans as proof that the application is free of vulnerabilities.

## Reporting

Private vulnerability reporting is enabled on the public GitHub repository. Use [Report a vulnerability](https://github.com/marcvandecoevering/Dirflux/security/advisories/new), or the repository's Security tab. Do not include passwords, session cookies, installation codes, private links, personal filenames or live user data in public issues.

A useful report includes the affected version, minimal reproduction with synthetic data, platform and filesystem, impact, and any proposed fix. There is no bug bounty or guaranteed response-time agreement.

## Update process

1. Triage reports and dependency advisories against actual use, including development/build dependencies that enter bundled browser assets.
2. Reproduce the defect and add a regression check when appropriate.
3. Update the application or dependencies and run the functional, native package and container checks.
4. Review the change and release notes; publish versioned source/packages/images from the reviewed revision.
5. Notify users through the release notes and Unraid update metadata. Document required configuration changes or mitigations.

Dependabot is configured for weekly version-update pull requests. Dependabot update jobs are running on GitHub; vulnerability alerts, automated security-update pull requests and private reporting are enabled. Branch protection and the complete private reporting submission flow remain to be verified. Verification CI uses read-only permissions. The optional draft-release job receives contents-write permission; the optional image-publishing job receives packages-write permission. Update pull requests are not automatically merged or released.

The manual release-candidate workflow resolves an existing version tag to an exact commit, runs the verification workflow on it, and creates a checksummed native candidate only after those jobs pass. Packaging verifies that the tag still points to the selected commit. An optional input creates a draft prerelease after verifying the downloaded candidate and remote tag again; it does not publish that draft. A separate opt-in image-publishing job promotes the exact verified AMD64/ARM64 artifacts to GHCR. Candidate metadata and SHA-256 checksums provide traceability and integrity checks, not a signature or a promise of security support.

## Deployment boundary

Run a single application process as a non-root user with access only to its own files and configuration. Protect configuration and backup directories from other users. Shared links deliberately grant unauthenticated access to the linked content. Users share a common file tree rather than isolated home directories.

Credential changes and the associated revocation of existing sessions commit in one SQLite transaction. Account deletion also removes that account's sessions and owned share links in one transaction. A failed statement rolls back those grouped changes; tests inject SQLite statement failures and verify that the prior account/access state survives. This is not a physical power-loss or storage-corruption test.

An exclusive connection to `CONFIG_DIR/instance-lock.sqlite` prevents cooperating app instances from using the same configuration directory simultaneously. The lock is acquired before recovery can touch temporary files, and released on normal close, failed startup or process termination. Do not delete or replace the lock file to bypass a running instance. This depends on working SQLite filesystem locks and is not a distributed coordination mechanism; separate configuration directories do not coordinate writes to a shared file tree. Keep configuration on storage suitable for SQLite. The implementation uses [SQLite exclusive transaction locking](https://www.sqlite.org/lang_transaction.html).

Use HTTPS for remote access and secure cookies. Review the README's resource limits and filesystem assumptions. The app does not provide host-level isolation against processes that can rewrite its underlying storage. It must not be deployed as a privileged container or with the Docker socket mounted.

Authentication attempts are limited to 15 per 15-minute window per direct socket address. The in-memory tracker holds at most 1,000 active address windows; when full, new addresses are rejected rather than evicting active restrictions. HTTP 429 includes Retry-After. Expired windows free slots, and a successful login resets its address counter. Forwarded address headers are not trusted. Clients behind one reverse proxy therefore share its counter; configure per-client limits at the proxy as well. These limits do not provide complete denial-of-service protection.

## Container advisory checks

Container CI runs digest-pinned Trivy 0.76.1 against an archive of each built image. Reports include known OS/package advisories and are retained as workflow artifacts. HIGH or CRITICAL findings block release promotion; lower-severity findings remain visible in the report. npm audit separately checks the dependency tree, including the browser build dependencies. Scanner databases and advisory coverage change over time; neither scan is a full application penetration test.
