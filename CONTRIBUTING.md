# Contributing

This is a development project, not yet a stable release. The final identity and public distribution are still being prepared. See [functional comparison and release evidence](docs/PARITY.md) before treating an implemented feature as verified parity.

## Report a problem

Use the bug-report form for defects and the functionality-comparison form for differences from original droppy. Include an exact application version or commit, environment and a minimal reproduction with synthetic files. Describe expected and actual behavior separately. Security reports belong in the private process described in [SECURITY.md](SECURITY.md), not public issues.

## Work locally

Use Node.js 24 and install the locked dependencies with `npm ci`. Run `npm run dev` for the application; after changing bundled editor/PDF code or its dependencies, run `npm run build`. `node scripts/demo.js` starts a disposable demo with synthetic files at `http://127.0.0.1:18094/`; credentials are `demo` / `demo-uitsluitend-lokaal`. This is only a local test account. Never point experiments or crash tests at personal storage.

Keep changes focused on an observable problem. Preserve file contents, permission checks, session boundaries and recovery invariants. Describe intentional differences from droppy explicitly rather than making tests accept a different result without explanation. Keep third-party notices and the dependency lockfile current when updating packages.

## Verify the change

Run `npm run check` and the tests relevant to the changed behavior (`node --test test/example.test.js`). Use regression checks for defects and important boundaries, including failure cases when appropriate. Browser-facing changes also need a concrete browser journey; a helper test alone does not establish that a user can complete the operation.

Before merging a release-bound change, run the complete `npm test`, `npm run build` and `npm run test:package` checks, plus the applicable container/native deployment checks in CI. Windows skips Linux filesystem cases; do not report those as passes. Cross-volume recovery requires actual distinct mounts. Native package switching tests currently use two copies of the same version and do not establish cross-version migration safety.

Use the pull-request description to record the trigger, resulting behavior, validation and remaining limits. Keep logs, screenshots and fixtures free of credentials, personal filenames and private links. Do not commit generated release archives, user storage or local configuration.

## Dependency updates and releases

Dependabot proposes npm, Docker and GitHub Actions updates weekly once active on GitHub. Review advisories and release notes, including build dependencies bundled into browser assets; run the affected checks before merging. Updates are not automatically approved, merged or released.

Follow [the candidate procedure](docs/RELEASING.md) and [publication gates](docs/PARITY.md#public-release-gates) for exact-revision candidates and publication. CI results, checksums and candidate metadata describe their tested artifact; they are not signatures or proof of complete security. Repository-side reporting, protections and scheduled workflows must be enabled and verified after the public repository exists.
