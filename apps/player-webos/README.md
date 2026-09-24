# Tilecast Player for LG webOS

Lightweight native webOS signage player. The first release supports:

- device pairing and enrollment;
- persistent credentials and last-known manifest;
- scheduled playlists and takeover/override selection;
- images, videos, and website items;
- player heartbeat and automatic manifest reconciliation;
- packaging as an LG webOS `.ipk`.

Layouts, widgets, plugins, command processing, remote self-update, and verified offline media caching are not part of the first MVP.

## Package locally

Install the official webOS CLI, then run:

```bash
npm install --global @webos-tools/cli
ares-package apps/player-webos
```

## Install on LG webOS Signage

For commercial panels such as LG 55UH5N-E/EP running webOS Signage 6, use the panel's **SI Server Setting**. Host the `.ipk` on an HTTP(S) server reachable by the panel, select the IPK application type, enter the package URL, download it, and set it as the local application. The exact menu labels depend on the firmware and installer menu configuration.

The package can also be loaded from USB when USB application installation is enabled by the signage administrator.

## Install on a consumer LG TV

Enable Developer Mode on the TV and register it with the CLI:

```bash
ares-setup-device
ares-install --device tv ./org.tilecast.player.webos_0.1.0_all.ipk
ares-launch --device tv org.tilecast.player.webos
```

On first launch, enter the externally reachable Tilecast server URL and approve the pairing code in Studio. Press the red remote key to clear pairing. Press Back to reopen server setup.
