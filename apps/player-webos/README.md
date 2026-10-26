# Tilecast Player for LG webOS

Lightweight native webOS signage player. It supports:

- device pairing and enrollment;
- persistent credentials and last-known manifest;
- scheduled playlists and takeover/override selection;
- images, videos, and website items;
- player heartbeat and automatic manifest reconciliation;
- packaging as an LG webOS `.ipk`;
- Studio live preview and **Watch live**;
- in-memory media cache with next-item preloading, so playlist loops do not download media again;
- item changes without a black frame: the next item replaces the current one only after it is ready;
- skipping of failed items, a video stall watchdog, and a page reload after five minutes without healthy playback.

Layouts, widgets, plugins, command processing, remote self-update, and persistent offline media caching are not supported.

## Live preview and Watch live

The player draws the visible image or video frame onto a canvas. A web page cannot read the pixels of a website frame, and some panels show video on a hardware plane that a canvas cannot read. In those cases the preview shows a status card with the playlist, the current item, the video position, and the last error. The player sends live frames over HTTP to `POST /api/v1/player/live-stream-frame`, because a browser cannot send a device credential header on a WebSocket.

A disabled screen shows a notice and keeps its pairing. Playback continues when the screen is enabled again.

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
