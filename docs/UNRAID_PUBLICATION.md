# Unraid publication preparation

## Beta.4 installation (2026-10-28)

[Release verification](https://github.com/marcvandecoevering/Dirflux/actions/runs/40675718835) passed for native Windows/macOS/Linux and both container architectures. Both OS/package scans reported zero findings. The beta channel and versioned beta.4 image reference the same verified index: `sha256:fefcad83f20996c94c284b20217c458449a472aec1cbd258543a0311d20e3bcc`.

The automated upgrade test creates a real beta.2 account, replaces the container with beta.4 and verifies the original login, file contents and ownership. The new initial-password setting never resets the old password. Fresh installation tests cover root-owned empty storage and an empty configuration directory already owned by UID 99, and verify a non-root server with zero effective capabilities.

On Unraid 7.3.3, a fresh manual **Add Container** installation pulled the public `beta` image, created previously nonexistent Files/Appdata folders automatically, and accepted direct `admin` login with the password entered in the Unraid form. No folder preparation, XML import or console setup-token retrieval was used. Upload/download preserved exact bytes.

The final beta.4 installation also verified configuration ownership/mode `99:100:700`, both application processes running as `nobody`, and zero effective capabilities. After a container restart, the original login and exact uploaded bytes remained intact.

The current template uses the beta update channel, `INITIAL_ADMIN_PASSWORD`, and optional PUID/PGID. It grants limited initialization capabilities, prepares empty mount roots only, and drops privileges before running the app. Earlier beta.2 deployment descriptions below are historical.

## Central catalog migration (2026-10-28)

The canonical template repository is now [unraid-templates](https://github.com/marcvandecoevering/unraid-templates), containing Dirflux and ThuisWeb. The existing approved Community Applications registration was updated through **My submissions → Edit details → Repository URL**. Its display name and approval status remain unchanged. No second registration was submitted.

The central repository passed validation with two valid Docker templates, no hard errors or template warnings, and both images pullable. Before migration the scan identified ThuisWeb as an existing app, as expected; updating the existing registration avoids submitting that app a second time. The portal says changes appear after the next catalog build. At the time of the source change it showed zero apps under the new URL; public catalog propagation is not yet verified.

Application repositories, images, app names and container settings remain separate and unchanged. Only template locations changed. Old template files remain available for installed clients. Maintain templates in the central catalog and synchronize compatibility copies in the application repositories. The Dirflux generator's `templateRepository` setting points at the central catalog; its generated app-specific profile must not replace the shared catalog profile.

The sections below record the earlier standalone Dirflux preparation; do not submit that standalone repository.

Status (2026-10-28): beta release and public multiarchitecture image verified;
installed and tested on Unraid 7.3.3. Not submitted or listed in Apps.
Authenticated **Validate and Scan** passed on 2026-10-28 for repository revision
`3f3571c`. The portal is at the final confirmation; **Submit for Review** has not
been clicked. Validation is not listing approval.

Portal results: public and active repository, BSD-2-Clause license, one valid
Docker application, no hard errors, no template warnings, profile extracted,
custom icon, no starter placeholders, and the Docker image is pullable.
The portal also notes an existing ThuisWeb repository on this account and
prefers one template repository per account. This advisory does not block the
separate Dirflux submission; no existing repository was changed.

## Submission details

| Field | Value |
| --- | --- |
| Repository | `https://github.com/marcvandecoevering/Dirflux` |
| Branch | `main` |
| Profile | root `ca_profile.xml` |
| Template | `templates/dirflux.xml` |
| Image | `ghcr.io/marcvandecoevering/dirflux:0.1.0-beta.2` |
| Platforms | Linux AMD64 and ARM64 |
| License | BSD-2-Clause; bundled third-party attribution retained |
| Support | `https://github.com/marcvandecoevering/Dirflux/issues` |

## Verified release and installation

- [Release verification run](https://github.com/marcvandecoevering/Dirflux/actions/runs/40666061376): native Windows/macOS/Linux, both container architectures, 155 automated tests, package verification and large ZIP64 downloads passed.
- Runtime revision: `e942352458b1fdbfd5bcc7bc08a0fe638a496774` (`v0.1.0-beta.2`). Both container scans reported zero known OS/package vulnerabilities on 2026-10-28; reports accompany the release. This is not a guarantee against application vulnerabilities.
- Public image index: `sha256:3dec23b0c5d913fbb690767ab0647103d1283ccbda1a58f3a915dfd4509de620`. Anonymous AMD64 pull and the full container smoke test passed. Native ARM64 verification passed in CI; promotion compared both published platform images with the exact tested artifacts.
- Unraid 7.3.3 / Docker 29.8.2 / x86_64: installed via **Docker → Add Container** using the published template, with only the test name, paths and free host port changed. The canonical template URL was omitted from the disposable copy.
- Actual Unraid checks passed: first-admin setup, denied anonymous file access, WebUI login, byte-exact upload/download, UID/GID 99:100, setup-token removal, restricted container settings, restart persistence, container removal retaining files, replacement retaining account/data, and downloads with a read-only files mount while writes return 403.
- Tests used fresh disposable directories and did not modify the existing file-manager installation. HTTPS proxy behavior is covered by CI, not by changing the server's existing proxy. Cross-version data upgrades and other Unraid versions remain unverified.
- Public icon, template/profile XML and support destinations are present. GitHub private vulnerability reporting and dependency security alerts are enabled.

The [current submission guide](https://ca.unraid.net/submit/help) requires a
public active repository, an OSI-approved root license, a root `ca_profile.xml`
with a nonempty profile, valid app XML, and Validate and Scan after changes.
The [official starter](https://github.com/unraid/unraid-community-apps-starter)
places Docker templates under `templates/`. The canonical `TemplateURL` must
point to the exact raw XML file.

## Generate reviewable metadata

Create a JSON file containing the chosen `name`, lowercase `slug`, canonical
GitHub `project` URL, tagged GHCR `image`, public HTTPS `icon` URL and optional
`branch` (defaults to `main`). Use the real published destinations, not a guessed
namespace or a placeholder. Then run:

```sh
node scripts/unraid-template.js release-metadata.json new-unraid-staging
```

The output directory must not already exist. It contains `ca_profile.xml` and
`templates/<slug>.xml`. Review and place these in the published repository only
after the identity, source, image tag and icon have been verified. Keep the root
LICENSE and README with them. The generator does not upload or submit files,
test URL availability, or claim that a registry tag is trustworthy.

The template uses bridge networking and container port 8094. It supplies
`--user=99:100`, a read-only container root, dropped capabilities,
no-new-privileges and a bounded temporary filesystem. These runtime settings
have passed the local Linux-container smoke checks. It uses `sh`, which exists
in the Alpine image. It deliberately does not advertise PUID/PGID environment
variables: the application does not implement those variables.

Prepare a dedicated files folder and a separate private appdata folder that
UID 99/GID 100 can write. Inspect ownership before changing it; do not recursively
chown an existing share as a routine installation step. Files must not contain
the configuration directory, and configuration must not contain Files. The
first administrator needs the code from the appdata `setup-token` file. The
template defaults to authenticated access and HTTP on the selected LAN port;
use HTTPS and enable secure cookies for remote access.

## Remaining portal work

- Re-run [Validate and Scan](https://ca.unraid.net/submit) if application templates
  or repository metadata change. The current template and profile passed.
- Review the final application and submit it when ready. Listing depends on
  Community Applications approval; do not advertise availability in Apps yet.

The generated tags follow the [public XML field reference](https://ca.unraid.net/submit/help/xml-field-reference).
No minimum/maximum Unraid version is asserted until that version has been tested.

Local generator checks cover restricted runtime arguments, separated default host
paths, XML escaping, canonical raw template URLs and the beta marker. The reserved
slug `appdata` is rejected because it would place configuration inside the default
Files path. GitHub project URLs with a non-default port are rejected instead of
silently changing their origin in generated links. Both generated documents have
also been parsed with a real XML parser using synthetic metadata. These checks
do not contact or verify the example URLs and do not replace the Community Apps
validator or a real Unraid installation.
