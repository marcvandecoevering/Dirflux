# Security policy

This project is in development. No stable version or public security-support commitment has been issued. Do not interpret test results or dependency scans as proof that the application is free of vulnerabilities.

## Reporting

Before the first public release, maintainers must enable private vulnerability reporting on the GitHub repository and verify its reporting flow. Once enabled, use the repository's Security tab and **Report a vulnerability**. Do not include passwords, session cookies, installation codes, private links, personal filenames or live user data in public issues.

A useful report includes the affected version, minimal reproduction with synthetic data, platform and filesystem, impact, and any proposed fix. There is no bug bounty or guaranteed response-time agreement.

## Update process

1. Triage reports and dependency advisories against actual use, including development/build dependencies that enter bundled browser assets.
2. Reproduce the defect and add a regression check when appropriate.
3. Update the application or dependencies and run the functional, native package and container checks.
4. Review the change and release notes; publish versioned source/packages/images from the reviewed revision.
5. Notify users through the release notes and Unraid update metadata. Document required configuration changes or mitigations.

Dependabot is configured for weekly version-update pull requests. GitHub dependency graph, Dependabot alerts/security updates, private reporting and branch protection still need to be enabled and verified on the actual repository. CI permissions are read-only; update pull requests are not automatically merged or released.

## Deployment boundary

Run a single application process as a non-root user with access only to its own files and configuration. Protect configuration and backup directories from other users. Shared links deliberately grant unauthenticated access to the linked content. Users share a common file tree rather than isolated home directories.

Use HTTPS for remote access and secure cookies. Review the README's resource limits and filesystem assumptions. The app does not provide host-level isolation against processes that can rewrite its underlying storage. It must not be deployed as a privileged container or with the Docker socket mounted.
