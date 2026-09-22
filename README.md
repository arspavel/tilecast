<h1 align="center">
  <picture>
    <source
      media="(prefers-color-scheme: dark)"
      srcset=".github/logos/tilecast-logo-white.svg"
    >
    <source
      media="(prefers-color-scheme: light)"
      srcset=".github/logos/tilecast-logo-black.svg"
    >
    <img
      alt="Tilecast RU"
      src=".github/logos/tilecast-logo-black.svg"
      width="240"
    >
  </picture>
</h1>

<p align="center">
  <strong>Tilecast RU — локализованная версия Tilecast.</strong>
</p>

<p align="center">
  Самостоятельно размещаемая система цифровых экранов для Android, Windows и Linux.
</p>

<p align="center">
  <a href="https://github.com/arspavel/tilecast/wiki">Документация</a>
  ·
  <a href="https://github.com/arspavel/tilecast/wiki/Install-Tilecast-Player">Установка плеера</a>
  ·
  <a href="CONTRIBUTING.md">Участие в разработке</a>
  ·
  <a href="LICENSE">Лицензия</a>
</p>

---

> [!IMPORTANT]
> **Tilecast RU** — независимая модифицированная версия проекта
> [Tilecast](https://github.com/gbyo/tilecast), созданного и поддерживаемого его
> авторами и участниками. Этот репозиторий не является официальной русской
> редакцией исходного проекта и не поддерживается его авторами. Сведения о
> происхождении и изменениях приведены в [NOTICE.md](NOTICE.md) и
> [CHANGELOG.md](CHANGELOG.md).

## Отличия Tilecast RU

- русская и английская локализация Studio;
- часовые пояса России и Казахстана;
- Windows-плеер в режиме киоска;
- поддержка Android-смартфонов наряду с Android TV;
- удалённый режим чёрного экрана;
- остановка быстрого показа из Studio;
- настраиваемый GitHub-репозиторий для обновлений плеера.

Основная ветка этой редакции — `tilecast-ru`. Для обновлений исходного проекта
используется репозиторий [`gbyo/tilecast`](https://github.com/gbyo/tilecast).

## О проекте

Tilecast is an open-source digital signage platform for organizations that want to run their own signage infrastructure without relying on a paid cloud service. Run the Tilecast Server on your own hardware, manage displays through **Tilecast Studio**, and connect Android TV or Linux devices running **Tilecast Player**.

## Features

- **Self-hosted** — your server, database, media, and players stay under your control.
- **Media library** — upload and organize images and videos with folders, collections, tags, availability dates, and expiration.
- **Playlists & layouts** — sequence content or build multi-zone screen layouts with media, widgets, text, shapes, and playlist zones.
- **Scheduling** — target content to screens and groups with scheduled assignments and takeovers.
- **Widgets** — clocks, countdowns, QR codes, websites, YouTube, tickers, menus, tables, agendas, weather, metrics, and more.
- **Data Sources** — connect reusable Calendar, RSS, Atom, JSON, CSV, weather, transit, alerts, manual data, and other structured sources to visual content.
- **Offline playback** — players cache content and continue operating when the server or network is temporarily unavailable.
- **Fleet management** — monitor screens, send remote commands, organize displays, manage groups, perform bulk changes, and view live previews.
- **Reliability tools** — unattended startup, watchdog recovery, safe mode, kiosk controls, and player health reporting.
- **Team workflows** — roles, content review, publishing controls, screen scopes, and multi-factor authentication.
- **Integrations** — API access, integration tokens, webhooks, notifications, and Prometheus-compatible fleet health.
- **Built-in plugins** — submission forms, countdown bars, emergency alerts, watermarks, and other signage workflows.

See [Widgets, Data Sources, and Layouts](docs/widgets-and-layouts.md) for a detailed overview of Tilecast's content system.

## Players

Tilecast RU provides the following Player platforms:

| Platform        | Support                                                     |
| --------------- | ----------------------------------------------------------- |
| **Android TV**  | Fire TV, Google TV, and other compatible Android TV devices |
| **Android**     | Compatible phones and tablets                               |
| **Windows**     | Windows kiosk player                                         |
| **Linux**       | x86_64 signage computers with kiosk and systemd support     |
| **ARM Linux**   | Working on it                                               |

Supported platforms share the core Tilecast playback system, including pairing,
playlists, layouts, widgets, scheduling, offline caching, remote management, and
live previews. Platform-specific capabilities may differ.

For installation and deployment:

- [Install Tilecast Player](https://github.com/arspavel/tilecast/wiki/Install-Tilecast-Player)
- [Reliability and Kiosk](https://github.com/arspavel/tilecast/wiki/Reliability-and-Kiosk)
- [Troubleshooting](https://github.com/arspavel/tilecast/wiki/Troubleshooting)

## Quick start

### Requirements

- Docker Engine
- Docker Compose v2

Clone the repository and create your environment file:

```sh
cp deploy/docker/.env.example deploy/docker/.env
```

Edit `deploy/docker/.env` and replace `POSTGRES_PASSWORD` with a strong password.

For a local HTTP installation, leave:

```env
TILECAST_COOKIE_SECURE=false
```

Start Tilecast:

```sh
docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yml up -d --build
```

Then open:

```text
http://localhost:8080
```

Tilecast will guide you through creating the organization and first Owner account. Database migrations run automatically when the server starts.

Check the installation with:

```sh
curl http://localhost:8080/healthz
docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yml ps
```

For a production deployment, see [Deployment](docs/deployment.md).

## Documentation

The [Tilecast RU Wiki](https://github.com/arspavel/tilecast/wiki) contains setup and operational guides.

Technical documentation is also maintained in [`docs/`](docs/), including:

- [Deployment](docs/deployment.md)
- [Architecture](docs/architecture.md)
- [Widgets, Data Sources, and Layouts](docs/widgets-and-layouts.md)
- [Display Control](docs/display-control.md)
- [API](docs/api.md)
- [Integrations](docs/integrations.md)
- [Built-in Plugins](docs/plugins.md)
- [Content Review](docs/content-review.md)
- [Multi-factor Authentication](docs/multi-factor-authentication.md)

## Development

Tilecast is primarily built with:

- **Go** — server
- **React + TypeScript** — Studio
- **Kotlin** — Android Player
- **Electron** — Linux Player
- **PostgreSQL** — database

See [Development Setup](docs/development.md) for local development instructions.

## Contributing

Contributions, bug reports, and improvements are welcome.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## License

Tilecast RU and the upstream Tilecast project are licensed under the
[GNU Affero General Public License v3.0](LICENSE). If you modify this software
and let users interact with it over a network, AGPL-3.0 requires you to offer
those users the corresponding source code. The source for this edition is
available at <https://github.com/arspavel/tilecast>.

Copyright remains with the respective upstream authors and contributors for
their work. Modifications in this repository are copyright their respective
contributors. See [NOTICE.md](NOTICE.md) for attribution.
