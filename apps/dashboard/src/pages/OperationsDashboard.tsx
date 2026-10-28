import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Monitor,
  RefreshCw,
  Siren,
} from "lucide-react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import type {
  ContentHealthReport,
  PresentationOverride,
  Schedule,
  Screen,
  SystemStatus,
  UpdateDeployment,
} from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { FleetUptimePanel } from "../components/FleetUptimePanel";
import { Button, PageHeader, StatusBadge } from "../components/ui";
import type { Incident } from "./ActivityIncidentShared";
import { activityRequest } from "./ActivityShared";
import {
  errorText,
  hasError,
  relativeTime,
  screenHealth,
  screenHealthNames,
  type ScreenHealth,
} from "./screenHealth";
import "./OperationsDashboard.css";

const healthTone = {
  working: "success",
  problem: "danger",
  offline: "warning",
  disabled: "neutral",
} as const;

// Thumbnails cost one request per screen, so the wall stops at a size that
// still reads at a glance; the full list lives on the Screens page.
const tileLimit = 12;
const attentionLimit = 8;
const lowStorageBytes = 2 * 1024 ** 3;
const staleBackupHours = 48;

type Severity = "danger" | "warning" | "info";
type AttentionItem = {
  key: string;
  severity: Severity;
  title: string;
  detail: string;
  to: string;
  action: string;
};

export function OperationsDashboard() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const role = auth.status?.user?.role ?? "";
  const privileged = role === "owner" || role === "administrator";
  const [showAllAttention, setShowAllAttention] = useState(false);

  const screens = useQuery({
    queryKey: ["screens"],
    queryFn: api.screens,
    refetchInterval: 10_000,
  });
  const overrides = useQuery({
    queryKey: ["presentation-overrides"],
    queryFn: api.presentationOverrides,
    refetchInterval: 15_000,
  });
  const takeovers = useQuery({
    queryKey: ["takeovers"],
    queryFn: api.takeovers,
    refetchInterval: 15_000,
  });
  const schedules = useQuery({
    queryKey: ["schedules"],
    queryFn: () => api.schedules(),
  });
  const deployments = useQuery({
    queryKey: ["update-deployments"],
    queryFn: api.updateDeployments,
    refetchInterval: 15_000,
  });
  const incidents = useQuery({
    queryKey: ["activity", "incidents", "overview"],
    queryFn: () => activityRequest<{ items: Incident[] }>("/incidents"),
    refetchInterval: 30_000,
    retry: false,
  });
  const contentHealth = useQuery({
    queryKey: ["content-health"],
    queryFn: api.contentHealth,
    refetchInterval: 60_000,
    retry: false,
  });
  const approvals = useQuery({
    queryKey: ["approvals", "overview"],
    queryFn: () => api.listApprovals({ pageSize: 1 }),
    refetchInterval: 60_000,
    retry: false,
  });
  const system = useQuery({
    queryKey: ["system-status"],
    queryFn: api.systemStatus,
    refetchInterval: 60_000,
    enabled: privileged,
    retry: false,
  });
  const backups = useQuery({
    queryKey: ["backups"],
    queryFn: api.backups,
    refetchInterval: 300_000,
    enabled: role === "owner",
    retry: false,
  });

  const allScreens = useMemo(() => screens.data?.items ?? [], [screens.data]);
  const presenting = useMemo(
    () => presentingScreens(allScreens, overrides.data?.items ?? []),
    [allScreens, overrides.data],
  );
  const healthOf = (screen: Screen) =>
    screenHealth(screen, presenting.has(screen.id));
  const counts = { working: 0, problem: 0, offline: 0, disabled: 0 };
  for (const screen of allScreens) counts[healthOf(screen)] += 1;
  const enabledCount = allScreens.length - counts.disabled;

  const activeIncidents = incidents.data?.items ?? [];
  const contentIssues = contentHealth.data
    ? contentIssueCount(contentHealth.data)
    : 0;
  const updates = updateSummary(deployments.data?.items ?? []);
  const activeTakeovers = (takeovers.data?.items ?? []).filter(
    (item) => item.status === "active",
  );
  const upcoming = upcomingScheduleChanges(
    (schedules.data?.items ?? []).filter((schedule) => schedule.enabled),
    4,
  );

  const attention = buildAttention({
    screens: allScreens,
    healthOf,
    incidents: activeIncidents,
    deployments: deployments.data?.items ?? [],
    contentHealth: contentHealth.data,
    pendingApprovals: approvals.data?.total ?? 0,
    system: system.data,
    lastBackupAt: backups.data?.lastSuccessful?.createdAt,
    backupsLoaded: backups.isSuccess,
  });
  const visibleAttention = showAllAttention
    ? attention
    : attention.slice(0, attentionLimit);

  const tiles = [...allScreens]
    .sort(
      (a, b) =>
        healthRank(healthOf(a)) - healthRank(healthOf(b)) ||
        a.name.localeCompare(b.name, "ru"),
    )
    .slice(0, tileLimit);

  const refreshing = screens.isFetching || incidents.isFetching;
  const updatedAt = screens.dataUpdatedAt
    ? new Date(screens.dataUpdatedAt).toLocaleTimeString("ru-RU")
    : "—";

  return (
    <div className="ops-console">
      <PageHeader
        className="ops-header"
        title="Обзор"
        description={`Состояние системы и всё, что требует действий. Обновлено в ${updatedAt}.`}
        actions={
          <Button
            variant="secondary"
            loading={refreshing}
            onClick={() => void queryClient.invalidateQueries()}
          >
            {!refreshing && <RefreshCw size={16} aria-hidden="true" />}
            Обновить
          </Button>
        }
      />

      {(activeTakeovers.length > 0 || presenting.size > 0) && (
        <section className="ops-takeover" aria-label="Временный показ">
          <Siren size={20} aria-hidden="true" />
          <div>
            {activeTakeovers.map((takeover) => (
              <p key={takeover.id}>
                <strong>Идёт временный показ «{takeover.name}»</strong> на{" "}
                {takeover.activeCount || takeover.affectedCount} экр. до{" "}
                {formatTime(new Date(takeover.expiresAt))}
              </p>
            ))}
            {presenting.size > 0 && (
              <p>
                <strong>«Показать сейчас»</strong> работает на {presenting.size}{" "}
                экр. — обычное расписание на них приостановлено.
              </p>
            )}
          </div>
          <Link to="/screens">Управлять</Link>
        </section>
      )}

      <section className="ops-strip" aria-label="Состояние системы">
        <StripTile
          to="/screens/monitoring"
          label="Экраны в работе"
          value={screens.isSuccess ? `${counts.working}/${enabledCount}` : "…"}
          detail={
            counts.problem + counts.offline > 0
              ? `${counts.problem} с проблемой · ${counts.offline} без связи`
              : enabledCount > 0
                ? "Все экраны в порядке"
                : "Нет подключённых экранов"
          }
          tone={
            counts.problem > 0
              ? "danger"
              : counts.offline > 0
                ? "warning"
                : "success"
          }
        />
        <StripTile
          to="#attention"
          label="Требует внимания"
          value={String(attention.length)}
          detail={attention.length ? "Список ниже" : "Действий не требуется"}
          tone={
            attention.some((item) => item.severity === "danger")
              ? "danger"
              : attention.length
                ? "warning"
                : "success"
          }
        />
        <StripTile
          to="/activity?tab=incidents"
          label="Открытые инциденты"
          value={incidents.isError ? "—" : String(activeIncidents.length)}
          detail={
            incidents.isError
              ? "Нет доступа"
              : activeIncidents.length
                ? `Последний: ${relativeTime(activeIncidents[0]?.lastSeenAt)}`
                : "Инцидентов нет"
          }
          tone={activeIncidents.length ? "danger" : "success"}
        />
        <StripTile
          to="/activity?tab=content-health"
          label="Проблемы контента"
          value={contentHealth.isError ? "—" : String(contentIssues)}
          detail={
            contentHealth.isError
              ? "Нет доступа"
              : contentIssues
                ? "Источники, сроки, пустые плейлисты"
                : "Контент в порядке"
          }
          tone={contentIssues ? "warning" : "success"}
        />
        <StripTile
          to="/settings/player/updates"
          label="Обновления плеера"
          value={String(updates.actions)}
          detail={updates.detail}
          tone={
            updates.failed ? "danger" : updates.actions ? "warning" : "success"
          }
        />
        {privileged && (
          <StripTile
            to="/settings/system"
            label="Сервер"
            value={system.data ? `v${system.data.tilecastVersion}` : "…"}
            detail={serverDetail(
              system.data,
              backups.data?.lastSuccessful?.createdAt,
            )}
            tone={serverTone(system.data)}
          />
        )}
      </section>

      <div className="ops-layout">
        <div className="ops-main">
          <section
            id="attention"
            className="ops-panel"
            aria-labelledby="attention-heading"
          >
            <header>
              <div>
                <h3 id="attention-heading">Требует внимания</h3>
                <p>
                  Экраны, инциденты, обновления, контент и сервер — в одном
                  списке.
                </p>
              </div>
            </header>
            {screens.isError ? (
              <div className="ops-empty" role="alert">
                <CircleAlert size={20} aria-hidden="true" />
                <strong>Не удалось получить состояние экранов</strong>
                <span>
                  Обновите страницу или проверьте связь с сервером Tilecast.
                </span>
              </div>
            ) : attention.length === 0 ? (
              <div className="ops-all-clear">
                <CheckCircle2 size={22} aria-hidden="true" />
                <div>
                  <strong>Всё в порядке</strong>
                  <span>
                    Нет экранов без связи, ошибок и незавершённых действий.
                  </span>
                </div>
              </div>
            ) : (
              <>
                <ul className="ops-attention-list">
                  {visibleAttention.map((item) => (
                    <li key={item.key} className={`is-${item.severity}`}>
                      <span className="ops-severity" aria-hidden="true" />
                      <span className="ops-attention-list__text">
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </span>
                      <Link to={item.to}>
                        {item.action}{" "}
                        <ChevronRight size={14} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
                {attention.length > attentionLimit && (
                  <button
                    type="button"
                    className="ops-more"
                    onClick={() => setShowAllAttention((value) => !value)}
                  >
                    {showAllAttention
                      ? "Свернуть"
                      : `Показать ещё ${attention.length - attentionLimit}`}
                  </button>
                )}
              </>
            )}
          </section>

          <section className="ops-panel" aria-labelledby="wall-heading">
            <header>
              <div>
                <h3 id="wall-heading">Экраны</h3>
                <p>
                  Последний снимок, что играет сейчас и связь. Сначала
                  проблемные.
                </p>
              </div>
              <Link to="/screens">
                Все экраны
                {allScreens.length > tileLimit ? ` (${allScreens.length})` : ""}
              </Link>
            </header>
            {screens.isLoading ? (
              <div className="ops-empty">Загрузка экранов…</div>
            ) : allScreens.length === 0 ? (
              <div className="ops-empty">
                <Monitor size={20} aria-hidden="true" />
                <strong>Экраны не подключены</strong>
                <Link to="/screens/pair">Подключить первый экран</Link>
              </div>
            ) : (
              <ScreenWall
                screens={tiles}
                healthOf={healthOf}
                presenting={presenting}
                overrides={overrides.data?.items ?? []}
              />
            )}
          </section>
        </div>

        <aside className="ops-side">
          <section className="ops-panel" aria-labelledby="next-heading">
            <header>
              <div>
                <h3 id="next-heading">Ближайшие смены</h3>
                <p>Включённые расписания.</p>
              </div>
              <Link to="/schedules">Расписания</Link>
            </header>
            {schedules.isError ? (
              <div className="ops-empty ops-empty--compact" role="alert">
                <CircleAlert size={18} aria-hidden="true" />
                <strong>Не удалось загрузить расписания</strong>
              </div>
            ) : upcoming.length ? (
              <ol className="ops-timeline">
                {upcoming.map(({ schedule, at }) => (
                  <li key={`${schedule.id}-${at.getTime()}`}>
                    <time>{formatScheduleTime(at)}</time>
                    <Link to={`/schedules/${schedule.id}`}>
                      <strong>{schedule.name}</strong>
                      <small>
                        {schedule.playlistName} → {targetLabel(schedule)}
                      </small>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="ops-empty ops-empty--compact">
                <CalendarClock size={18} aria-hidden="true" />
                <strong>Смен не запланировано</strong>
                <span>Экраны показывают назначенный по умолчанию контент.</span>
              </div>
            )}
          </section>

          <FleetUptimePanel />
        </aside>
      </div>
    </div>
  );
}

function StripTile({
  to,
  label,
  value,
  detail,
  tone,
}: {
  to: string;
  label: string;
  value: string;
  detail: string;
  tone: "success" | "warning" | "danger";
}) {
  const content = (
    <>
      <span className="ops-strip__label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </>
  );
  const className = `ops-strip__tile is-${tone}`;
  return to.startsWith("#") ? (
    <a className={className} href={to}>
      {content}
    </a>
  ) : (
    <Link className={className} to={to}>
      {content}
    </Link>
  );
}

function ScreenWall({
  screens,
  healthOf,
  presenting,
  overrides,
}: {
  screens: Screen[];
  healthOf: (screen: Screen) => ScreenHealth;
  presenting: Set<string>;
  overrides: PresentationOverride[];
}) {
  const snapshots = useQueries({
    queries: screens.map((screen) => ({
      queryKey: ["screen-snapshots", screen.id, "latest"],
      queryFn: () => api.screenSnapshots(screen.id, 1),
      staleTime: 60_000,
      refetchInterval: 120_000,
      retry: false,
    })),
  });
  // Snapshot history is off by default and hourly at best, so a reachable
  // screen shows the file it reports playing right now. Screens playing the
  // same file share one cached request.
  const currentAssets = useQueries({
    queries: screens.map((screen) => ({
      queryKey: ["asset", screen.currentAssetId ?? ""],
      queryFn: () => api.asset(screen.currentAssetId ?? ""),
      enabled: Boolean(screen.currentAssetId) && screen.status === "online",
      staleTime: 300_000,
      retry: false,
    })),
  });
  return (
    <ul className="ops-wall">
      {screens.map((screen, index) => {
        const health = healthOf(screen);
        const snapshot = snapshots[index]?.data?.items[0];
        const asset =
          screen.status === "online" ? currentAssets[index]?.data : undefined;
        const assetThumbnail = asset?.thumbnailUrl;
        const override = presenting.has(screen.id)
          ? overrides.find(
              (item) =>
                item.targetId === screen.id ||
                item.targetId === screen.syncGroupId,
            )
          : undefined;
        const playing =
          override?.contentName ?? screen.nowPlayingName ?? "Ничего не играет";
        return (
          <li key={screen.id} className={`is-${health}`}>
            <Link to={`/screens/${screen.id}`}>
              <span className="ops-wall__frame">
                {assetThumbnail ? (
                  <img src={assetThumbnail} alt="" loading="lazy" />
                ) : snapshot ? (
                  <img
                    src={`/api/v1/screens/${screen.id}/snapshots/${snapshot.id}/image`}
                    alt=""
                    loading="lazy"
                  />
                ) : health === "working" || health === "problem" ? (
                  <span className="ops-wall__caption-only">
                    <Monitor size={22} aria-hidden="true" />
                    {asset?.name ?? playing}
                  </span>
                ) : (
                  <Monitor size={28} aria-hidden="true" />
                )}
                <StatusBadge
                  label={screenHealthNames[health]}
                  tone={healthTone[health]}
                />
                {assetThumbnail ? (
                  <span className="ops-wall__caption">
                    <span>Сейчас</span> {asset?.name}
                  </span>
                ) : (
                  snapshot && (
                    <span className="ops-wall__caption">
                      Снимок {relativeTime(snapshot.capturedAt)}
                    </span>
                  )
                )}
              </span>
              <span className="ops-wall__body">
                <strong title={screen.name}>{screen.name}</strong>
                <small>{screen.location || "Место не указано"}</small>
                <span className="ops-wall__playing">
                  {health === "problem" && hasError(screen)
                    ? errorText(screen)
                    : health === "offline"
                      ? "Экран не на связи"
                      : playing}
                </span>
                <small>
                  {health === "offline"
                    ? `Нет связи ${relativeTime(screen.lastContactAt)}`
                    : `Связь ${relativeTime(screen.lastContactAt)}`}
                  {screen.playerVersion ? ` · v${screen.playerVersion}` : ""}
                </small>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function presentingScreens(
  screens: Screen[],
  overrides: PresentationOverride[],
) {
  const now = Date.now();
  const live = overrides.filter(
    (item) =>
      !item.stoppedAt && (!item.expiresAt || Date.parse(item.expiresAt) > now),
  );
  const ids = new Set<string>();
  for (const screen of screens) {
    if (
      live.some(
        (item) =>
          (item.targetType === "screen" && item.targetId === screen.id) ||
          (item.targetType === "group" && item.targetId === screen.syncGroupId),
      )
    )
      ids.add(screen.id);
  }
  return ids;
}

function healthRank(health: ScreenHealth) {
  return { problem: 0, offline: 1, working: 2, disabled: 3 }[health];
}

function contentIssueCount(report: ContentHealthReport) {
  return (
    report.staleSources.length +
    report.expiringAssets.filter((asset) => asset.inUse).length +
    report.emptyPlaylists.filter((playlist) => playlist.screenCount > 0)
      .length +
    report.unassignedScreens.length
  );
}

function updateSummary(deployments: UpdateDeployment[]) {
  let waiting = 0;
  let failed = 0;
  for (const deployment of deployments) {
    waiting += deployment.waitingForUserCount;
    failed += deployment.failedCount;
  }
  const latest = deployments[0];
  const detail =
    failed || waiting
      ? `${failed} сбой · ${waiting} ждут подтверждения`
      : latest
        ? `${latest.versionName}: ${latest.succeededCount}/${latest.targetCount} обновлено`
        : "Обновлений не запускалось";
  return { actions: waiting + failed, failed, detail };
}

function availableStorage(system?: SystemStatus) {
  const value = system?.media["availableStorageBytes"];
  return typeof value === "number" ? value : undefined;
}

function serverDetail(system?: SystemStatus, lastBackupAt?: string) {
  if (!system) return "Загрузка…";
  const parts = [`работает ${formatUptime(system.uptimeSeconds)}`];
  const free = availableStorage(system);
  if (free !== undefined) parts.push(`свободно ${formatBytes(free)}`);
  if (lastBackupAt) parts.push(`копия ${relativeTime(lastBackupAt)}`);
  return parts.join(" · ");
}

function serverTone(system?: SystemStatus) {
  if (!system) return "success" as const;
  if (system.database.status !== "healthy") return "danger" as const;
  const free = availableStorage(system);
  if (system.media["status"] === "degraded") return "danger" as const;
  if (free !== undefined && free < lowStorageBytes) return "warning" as const;
  return "success" as const;
}

function buildAttention({
  screens,
  healthOf,
  incidents,
  deployments,
  contentHealth,
  pendingApprovals,
  system,
  lastBackupAt,
  backupsLoaded,
}: {
  screens: Screen[];
  healthOf: (screen: Screen) => ScreenHealth;
  incidents: Incident[];
  deployments: UpdateDeployment[];
  contentHealth?: ContentHealthReport;
  pendingApprovals: number;
  system?: SystemStatus;
  lastBackupAt?: string;
  backupsLoaded: boolean;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const listedScreens = new Set<string>();

  for (const screen of screens) {
    const health = healthOf(screen);
    if (health === "problem") {
      listedScreens.add(screen.id);
      items.push({
        key: `screen-${screen.id}`,
        severity: "danger",
        title: screen.name,
        detail: hasError(screen)
          ? errorText(screen)
          : "На связи, но ничего не воспроизводит",
        to: `/screens/${screen.id}`,
        action: "Открыть",
      });
    } else if (health === "offline") {
      listedScreens.add(screen.id);
      items.push({
        key: `screen-${screen.id}`,
        severity: "warning",
        title: screen.name,
        detail: `Нет связи · последний контакт ${relativeTime(screen.lastContactAt)}`,
        to: `/screens/${screen.id}`,
        action: "Открыть",
      });
    }
  }

  // An offline screen already has its own row; its incident would repeat it.
  for (const incident of incidents) {
    if (incident.primaryScreenId && listedScreens.has(incident.primaryScreenId))
      continue;
    items.push({
      key: `incident-${incident.id}`,
      severity:
        incident.severity === "critical" || incident.severity === "error"
          ? "danger"
          : "warning",
      title: incident.title,
      detail: [
        incident.primaryScreenName,
        incident.affectedScreens > 1 ? `${incident.affectedScreens} экр.` : "",
        `с ${relativeTime(incident.openedAt)}`,
      ]
        .filter(Boolean)
        .join(" · "),
      to: "/activity?tab=incidents",
      action: "Инцидент",
    });
  }

  for (const deployment of deployments) {
    if (!deployment.failedCount && !deployment.waitingForUserCount) continue;
    items.push({
      key: `update-${deployment.id}`,
      severity: deployment.failedCount ? "danger" : "warning",
      title: `Обновление плеера ${deployment.versionName}`,
      detail: `${deployment.failedCount} сбой · ${deployment.waitingForUserCount} ждут подтверждения на экране`,
      to: "/settings/player/updates",
      action: "Обновления",
    });
  }

  if (contentHealth) {
    for (const source of contentHealth.staleSources)
      items.push({
        key: `source-${source.id}`,
        severity: "warning",
        title: `Источник данных «${source.name}» не обновляется`,
        detail: source.lastSuccessAt
          ? `Последнее обновление ${relativeTime(source.lastSuccessAt)}${source.usingCachedData ? " · показываются сохранённые данные" : ""}`
          : "Ещё ни разу не обновлялся",
        to: `/data-sources/${source.id}`,
        action: "Источник",
      });
    for (const asset of contentHealth.expiringAssets.filter(
      (item) => item.inUse,
    ))
      items.push({
        key: `asset-${asset.id}`,
        severity: "info",
        title: `Скоро истекает «${asset.name}»`,
        detail: `Используется в показе · до ${new Date(asset.expiresAt).toLocaleDateString("ru-RU")}`,
        to: "/assets",
        action: "Медиа",
      });
    for (const playlist of contentHealth.emptyPlaylists.filter(
      (item) => item.screenCount > 0,
    ))
      items.push({
        key: `playlist-${playlist.id}`,
        severity: "warning",
        title: `Пустой плейлист «${playlist.name}»`,
        detail: `Назначен на ${playlist.screenCount} экр.`,
        to: `/playlists/${playlist.id}`,
        action: "Плейлист",
      });
    for (const screen of contentHealth.unassignedScreens)
      if (!listedScreens.has(screen.id))
        items.push({
          key: `unassigned-${screen.id}`,
          severity: "info",
          title: `${screen.name}: контент не назначен`,
          detail: "Экран подключён, но ему нечего показывать",
          to: `/screens/${screen.id}`,
          action: "Назначить",
        });
  }

  if (pendingApprovals > 0)
    items.push({
      key: "approvals",
      severity: "info",
      title: `Ожидают согласования: ${pendingApprovals}`,
      detail: "Заявки и материалы, которые ждут вашего решения",
      to: "/approvals",
      action: "Согласовать",
    });

  if (system) {
    const free = availableStorage(system);
    if (
      system.database.status !== "healthy" ||
      system.media["status"] === "degraded"
    )
      items.push({
        key: "server-health",
        severity: "danger",
        title: "Сервер работает с ограничениями",
        detail:
          system.database.status !== "healthy"
            ? "Проблема с базой данных"
            : "Хранилище медиа недоступно",
        to: "/settings/system",
        action: "Система",
      });
    else if (free !== undefined && free < lowStorageBytes)
      items.push({
        key: "server-storage",
        severity: "warning",
        title: "Заканчивается место на сервере",
        detail: `Свободно ${formatBytes(free)} для медиа`,
        to: "/settings/system",
        action: "Система",
      });
  }

  if (backupsLoaded) {
    const age = lastBackupAt
      ? (Date.now() - Date.parse(lastBackupAt)) / 3_600_000
      : Infinity;
    if (age > staleBackupHours)
      items.push({
        key: "backup",
        severity: "warning",
        title: lastBackupAt
          ? "Резервная копия устарела"
          : "Резервных копий нет",
        detail: lastBackupAt
          ? `Последняя успешная ${relativeTime(lastBackupAt)}`
          : "Ни одной успешной резервной копии",
        to: "/settings/operations/backups",
        action: "Копии",
      });
  }

  const order = { danger: 0, warning: 1, info: 2 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

function upcomingScheduleChanges(schedules: Schedule[], limit: number) {
  const now = new Date();
  const candidates: { schedule: Schedule; at: Date }[] = [];
  for (const schedule of schedules) {
    if (schedule.type === "one_time" && schedule.oneTimeStart) {
      const at = new Date(schedule.oneTimeStart);
      if (at > now) candidates.push({ schedule, at });
      continue;
    }
    if (!schedule.dailyStart || schedule.daysOfWeek.length === 0) continue;
    const [hour = 0, minute = 0] = schedule.dailyStart.split(":").map(Number);
    for (let offset = 0; offset < 8; offset += 1) {
      const at = new Date(now);
      at.setDate(now.getDate() + offset);
      at.setHours(hour, minute, 0, 0);
      if (at > now && schedule.daysOfWeek.includes(at.getDay())) {
        candidates.push({ schedule, at });
        break;
      }
    }
  }
  return candidates
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, limit);
}

function targetLabel(schedule: Schedule) {
  if (schedule.targets.length === 0) return "нет экранов";
  if (schedule.targets.length === 1)
    return schedule.targets[0]?.name ?? "1 экран";
  return `${schedule.targets.length} экр.`;
}

function formatScheduleTime(value: Date) {
  const time = formatTime(value);
  const days = Math.round(
    (new Date(value).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) /
      86_400_000,
  );
  if (days === 0) return time;
  if (days === 1) return `завтра ${time}`;
  const day = new Intl.DateTimeFormat(
    "ru-RU",
    days < 7 ? { weekday: "short" } : { day: "numeric", month: "short" },
  ).format(value);
  return `${day} ${time}`;
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  if (days > 0) return `${days} дн.`;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `${hours} ч`;
  return `${Math.max(1, Math.floor(seconds / 60))} мин`;
}

function formatBytes(value: number) {
  const gib = value / 1024 ** 3;
  return gib >= 1
    ? `${gib.toFixed(gib >= 10 ? 0 : 1)} ГБ`
    : `${Math.round(value / 1024 ** 2)} МБ`;
}
