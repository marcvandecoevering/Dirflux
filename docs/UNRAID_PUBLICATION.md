# Unraid publication preparation

Status: not submitted, not listed, and not yet installed on an actual Unraid
server. The selected name and logo are Dirflux, and the source repository is
https://github.com/marcvandecoevering/Dirflux. A verified published container image
and actual Unraid installation checks are still required. Generated files are beta metadata, not approval evidence.

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

## Remaining acceptance work

- Confirm the final logo and public metadata URLs, repository license and support
  destinations. Enable and verify private vulnerability reporting on GitHub.
- Publish the reviewed versioned image for both architectures; verify pulling by
  its published digest, not just running a local build.
- Install the generated template on Unraid with disposable shares. Check folder
  ownership, initial setup, WebUI launch, upload/download, restart, removal with
  data retention, read-only mode and HTTPS proxy access.
- Run [Validate and Scan](https://ca.unraid.net/submit) on the public repository;
  address findings before submission. Repository metadata parsing and a local
  container test do not replace this review or prove acceptance into Apps.

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
