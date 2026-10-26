# Changelog

This file records changes specific to Tilecast RU. For the history inherited
from the original project, see [gbyo/tilecast](https://github.com/gbyo/tilecast)
and the Git history before commit `3a4dea8`.

## Unreleased

### Added

- RU/EN language support and Russian localization across core Studio workflows.
- Russian and Kazakhstan time zones in Studio settings.
- Windows kiosk player build.
- Android phone support in addition to TV devices.
- Remote black-screen sleep mode for Android players.
- Configurable GitHub release repository for player updates.
- Control for stopping an active quick presentation.
- Android Managed Kiosk provisioning through a device-owner admin component:
  lock task, persistent Home app, and disabled keyguard and status bar.
- Bounded automatic relaunch of the Android player after a crash or process
  loss.
- Unattended Android player updates on every supported Android version when
  the player is the device owner.
- webOS player 0.2.0: Studio live preview and Watch live, media cache with
  preloading, seamless item changes, failed-item skipping, and a stall
  watchdog.

### Fixed

- webOS player: video volume was divided by 100, so videos played almost
  silently; video start and end offsets are now applied.
- webOS player: a disabled screen no longer deletes its pairing.
- Socketless players such as webOS now show as online in Studio.

### Changed

- Project documentation now identifies Tilecast RU as an independent modified
  edition and links to the corresponding source code.

## Upstream baseline

Tilecast RU diverged from upstream after commit
`a0f1e5dffcc0f93fd9d9a99cbf6ddc021d69aa33` from 2026-08-17.
