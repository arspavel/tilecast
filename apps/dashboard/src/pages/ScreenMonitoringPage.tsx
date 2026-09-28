import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, RotateCw, Search, Sun, Volume2, VolumeX } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import type { Screen, ScreenStatus } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import {
  Button,
  Notice,
  PageHeader,
  StatusDot,
  TableContainer,
} from "../components/ui";

type Filter = "all" | "online" | "offline" | "errors";

const statusNames: Record<ScreenStatus, string> = {
  online: "Онлайн",
  recent: "Недавно был на связи",
  stale: "Связь устарела",
  offline: "Офлайн",
  disabled: "Отключён",
  revoked: "Доступ отозван",
};

function hasError(screen: Screen) {
  const activeWebsiteError =
    ["failed", "timed_out", "showing_fallback"].includes(
      screen.websiteState ?? ""
    ) && Boolean(screen.websiteFailureCategory);

  return Boolean(
    screen.lastPlaybackError ||
      screen.lastSynchronizationError ||
      activeWebsiteError ||
      screen.configurationError ||
      screen.updateError
  );
}

function statusTone(screen: Screen) {
  if (hasError(screen)) return "danger" as const;
  if (screen.status === "online") return "success" as const;
  if (screen.status === "recent") return "info" as const;
  if (screen.status === "stale") return "warning" as const;
  return "neutral" as const;
}

function statusRank(screen: Screen) {
  if (hasError(screen)) return 0;
  if (screen.status === "offline" || screen.status === "stale") return 1;
  if (screen.status === "recent") return 2;
  if (screen.status === "online") return 3;
  return 4;
}

function relativeTime(value?: string) {
  if (!value) return "Нет данных";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Нет данных";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds} сек. назад`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч. назад`;
  return new Date(timestamp).toLocaleString("ru-RU");
}

function platformName(value: string) {
  const platform = value.toLowerCase();
  if (platform.includes("webos")) return "webOS";
  if (platform.includes("android")) return "Android";
  if (platform.includes("windows") || platform.includes("win32"))
    return "Windows";
  if (platform.includes("linux")) return "Linux";
  return value || "Не определена";
}

function playbackName(value?: string) {
  const labels: Record<string, string> = {
    playing: "Воспроизводится",
    loading: "Загрузка",
    failed: "Ошибка",
    paused: "Пауза",
    stopped: "Остановлено",
    starting: "Запуск",
  };
  return value ? (labels[value] ?? value.replaceAll("_", " ")) : "Нет данных";
}

function errorText(screen: Screen) {
  const activeWebsiteError =
    ["failed", "timed_out", "showing_fallback"].includes(
      screen.websiteState ?? ""
    )
      ? screen.websiteFailureCategory
      : undefined;

  return (
    screen.lastPlaybackError ||
    screen.lastSynchronizationError ||
    activeWebsiteError ||
    screen.configurationError ||
    screen.updateError ||
    ""
  );
}

export function ScreenMonitoringPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [updateMessage, setUpdateMessage] = useState("");
  const [controlMessage, setControlMessage] = useState("");
  const [volumeValues, setVolumeValues] = useState<Record<string, number>>({});
  const [brightnessValues, setBrightnessValues] = useState<
    Record<string, number>
  >({});
  const query = useQuery({
    queryKey: ["screens", "monitoring"],
    queryFn: api.screens,
    refetchInterval: 15_000,
  });
  const releases = useQuery({
    queryKey: ["player-releases"],
    queryFn: api.playerReleases,
    refetchInterval: 30_000,
  });
  const latestAndroidRelease = [...(releases.data?.items ?? [])]
    .filter(
      (release) =>
        release.platform === "android" &&
        release.verificationStatus === "verified" &&
        release.cacheStatus === "cached",
    )
    .sort((left, right) => right.versionCode - left.versionCode)[0];

  const deployUpdate = useMutation({
    mutationFn: (screen: Screen) => {
      if (!latestAndroidRelease)
        throw new Error("Нет проверенного выпуска Android для установки.");
      return api.createUpdateDeployment(
        {
          releaseId: latestAndroidRelease.id,
          name: `Tilecast Player ${latestAndroidRelease.versionName} · ${screen.name}`,
          mode: "install_now",
          screenIds: [screen.id],
          groupIds: [],
          canarySize: 0,
        },
        auth.status?.csrfToken ?? "",
      );
    },
    onMutate: () => setUpdateMessage(""),
    onSuccess: async (result) => {
      setUpdateMessage(
        `Обновление создано для ${result.targetCount} экрана. Плеер начнёт загрузку автоматически.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["screens"] }),
        queryClient.invalidateQueries({ queryKey: ["update-deployments"] }),
      ]);
    },
  });

  const requestUpdate = (screen: Screen) => {
    if (!latestAndroidRelease) return;
    const permissionWarning =
      screen.installPermissionStatus === "required"
        ? "\n\nAndroid потребует подтвердить установку на самом устройстве."
        : "";
    if (
      !window.confirm(
        `Обновить «${screen.name}» с версии ${screen.playerVersion || "неизвестно"} до ${latestAndroidRelease.versionName}?${permissionWarning}`,
      )
    )
      return;
    deployUpdate.mutate(screen);
  };

  const sendControl = useMutation({
    mutationFn: ({
      screen,
      type,
      payload = {},
    }: {
      screen: Screen;
      type: string;
      payload?: Record<string, unknown>;
    }) =>
      api.createScreenCommand(
        screen.id,
        type,
        payload,
        auth.status?.csrfToken ?? "",
      ),
    onMutate: () => setControlMessage(""),
    onSuccess: (_result, variables) => {
      const labels: Record<string, string> = {
        display_set_volume: "Громкость изменена",
        display_mute: "Звук выключен",
        display_unmute: "Звук включён",
        display_set_brightness: "Яркость изменена",
        restart_player_process: "Команда перезапуска отправлена",
      };
      setControlMessage(
        `${variables.screen.name}: ${labels[variables.type] ?? "команда отправлена"}.`,
      );
    },
  });

  const volumeFor = (screen: Screen) => volumeValues[screen.id] ?? 50;
  const brightnessFor = (screen: Screen) =>
    brightnessValues[screen.id] ?? 100;

  const restartPlayer = (screen: Screen) => {
    if (
      !window.confirm(
        `Перезапустить Tilecast Player на экране «${screen.name}»? Воспроизведение прервётся на несколько секунд.`,
      )
    )
      return;
    sendControl.mutate({
      screen,
      type: "restart_player_process",
    });
  };

  const screens = query.data?.items ?? [];
  const counts = {
    total: screens.length,
    online: screens.filter((item) => item.status === "online").length,
    offline: screens.filter((item) =>
      ["offline", "stale"].includes(item.status)
    ).length,
    errors: screens.filter(hasError).length,
  };

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return screens
      .filter((screen) => {
        if (filter === "online" && screen.status !== "online") return false;
        if (
          filter === "offline" &&
          !["offline", "stale"].includes(screen.status)
        )
          return false;
        if (filter === "errors" && !hasError(screen)) return false;
        if (!needle) return true;
        return [
          screen.name,
          screen.location,
          screen.roomName,
          screen.platform,
          screen.deviceModel,
          screen.lastKnownIp,
          screen.nowPlayingName,
          screen.websiteCurrentHost,
        ].some((value) => value?.toLowerCase().includes(needle));
      })
      .sort(
        (left, right) =>
          statusRank(left) - statusRank(right) ||
          left.name.localeCompare(right.name, "ru")
      );
  }, [filter, screens, search]);

  const cards: Array<[Filter, string, number]> = [
    ["all", "Всего", counts.total],
    ["online", "Онлайн", counts.online],
    ["offline", "Без связи", counts.offline],
    ["errors", "С ошибками", counts.errors],
  ];

  return (
    <div className="screen-monitoring">
      <PageHeader
        eyebrow="Экраны"
        title="Мониторинг экранов"
        description="Состояние устройств, воспроизведения и веб-страниц. Данные обновляются каждые 15 секунд."
        actions={
          <Button
            variant="secondary"
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {!query.isFetching && <RefreshCw size={16} aria-hidden="true" />}
            Обновить
          </Button>
        }
      />

      <div className="monitoring-summary">
        {cards.map(([value, label, count]) => (
          <button
            type="button"
            key={value}
            className={filter === value ? "selected" : ""}
            onClick={() => setFilter(value)}
          >
            <span>{label}</span>
            <strong>{count}</strong>
          </button>
        ))}
      </div>

      <label className="monitoring-search">
        <Search size={17} aria-hidden="true" />
        <span className="visually-hidden">Поиск экранов</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Название, модель, адрес, контент или IP"
        />
      </label>

      {query.error && (
        <Notice variant="danger" title="Не удалось получить состояние экранов">
          {query.error.message}
        </Notice>
      )}
      {(deployUpdate.error || updateMessage) && (
        <Notice
          variant={deployUpdate.error ? "danger" : "success"}
          title={
            deployUpdate.error
              ? "Не удалось запустить обновление"
              : "Обновление запущено"
          }
        >
          {deployUpdate.error?.message ?? updateMessage}
        </Notice>
      )}
      {(sendControl.error || controlMessage) && (
        <Notice
          variant={sendControl.error ? "danger" : "success"}
          title={
            sendControl.error
              ? "Не удалось выполнить команду"
              : "Команда отправлена"
          }
        >
          {sendControl.error?.message ?? controlMessage}
        </Notice>
      )}

      <TableContainer>
        <table className="monitoring-table">
          <thead>
            <tr>
              <th>Экран</th>
              <th>Состояние</th>
              <th>Сейчас показывается</th>
              <th>Плеер</th>
              <th>Последняя связь</th>
              <th>Обновление</th>
              <th>Управление</th>
              <th>Ошибка</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((screen) => (
              <tr
                key={screen.id}
                className={hasError(screen) ? "has-error" : ""}
              >
                <th scope="row">
                  <Link to={`/screens/${screen.id}`}>{screen.name}</Link>
                  <small>
                    {[screen.location, screen.roomName]
                      .filter(Boolean)
                      .join(" · ") || "Расположение не указано"}
                  </small>
                  <small>{screen.lastKnownIp || "IP не сообщён"}</small>
                </th>
                <td>
                  <StatusDot
                    tone={statusTone(screen)}
                    label={statusNames[screen.status]}
                  />
                  <small>{playbackName(screen.playbackState)}</small>
                </td>
                <td>
                  <strong>{screen.nowPlayingName || "Не назначено"}</strong>
                  {screen.websiteCurrentHost && (
                    <small>{screen.websiteCurrentHost}</small>
                  )}
                  {screen.websiteState && (
                    <small>Сайт: {screen.websiteState}</small>
                  )}
                </td>
                <td>
                  <strong>{platformName(screen.platform)}</strong>
                  <small>
                    {[screen.deviceManufacturer, screen.deviceModel]
                      .filter(Boolean)
                      .join(" ") || "Модель не сообщена"}
                  </small>
                  <small>Версия {screen.playerVersion || "не сообщена"}</small>
                </td>
                <td>
                  <strong>
                    {relativeTime(
                      screen.lastHeartbeatAt ?? screen.lastContactAt
                    )}
                  </strong>
                  {screen.lastHealthyPlaybackAt && (
                    <small>
                      Успешный показ:{" "}
                      {relativeTime(screen.lastHealthyPlaybackAt)}
                    </small>
                  )}
                </td>
                <td>
                  {screen.platform.toLowerCase().includes("android") ? (
                    <>
                      <strong>
                        {latestAndroidRelease
                          ? (screen.playerVersionCode ?? 0) <
                            latestAndroidRelease.versionCode
                            ? `Доступна ${latestAndroidRelease.versionName}`
                            : "Установлена актуальная версия"
                          : "Выпуск недоступен"}
                      </strong>
                      {screen.updateState && (
                        <small>
                          Этап: {screen.updateState.replaceAll("_", " ")}
                        </small>
                      )}
                      {latestAndroidRelease &&
                        (screen.playerVersionCode ?? 0) <
                          latestAndroidRelease.versionCode && (
                          <Button
                            variant="secondary"
                            compact
                            disabled={
                              screen.status !== "online" ||
                              deployUpdate.isPending
                            }
                            onClick={() => requestUpdate(screen)}
                          >
                            {deployUpdate.isPending
                              ? "Запуск…"
                              : `Обновить до ${latestAndroidRelease.versionName}`}
                          </Button>
                        )}
                      {screen.installPermissionStatus === "required" && (
                        <small className="monitoring-update-warning">
                          Потребуется подтверждение на устройстве
                        </small>
                      )}
                    </>
                  ) : (
                    <span className="monitoring-ok">
                      Только для Android
                    </span>
                  )}
                </td>
                <td>
                  {screen.platform.toLowerCase().includes("android") ? (
                    <details className="monitoring-controls">
                      <summary>Управление</summary>
                      <div className="monitoring-controls__panel">
                        <label>
                          <span>
                            <Volume2 size={15} aria-hidden="true" />
                            Громкость: {volumeFor(screen)}%
                          </span>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="5"
                            value={volumeFor(screen)}
                            onChange={(event) =>
                              setVolumeValues((values) => ({
                                ...values,
                                [screen.id]: Number(event.target.value),
                              }))
                            }
                          />
                        </label>
                        <Button
                          variant="secondary"
                          compact
                          disabled={
                            screen.status !== "online" ||
                            sendControl.isPending
                          }
                          onClick={() =>
                            sendControl.mutate({
                              screen,
                              type: "display_set_volume",
                              payload: { volume: volumeFor(screen) },
                            })
                          }
                        >
                          Применить громкость
                        </Button>

                        <div className="monitoring-controls__row">
                          <Button
                            variant="secondary"
                            compact
                            disabled={
                              screen.status !== "online" ||
                              sendControl.isPending
                            }
                            onClick={() =>
                              sendControl.mutate({
                                screen,
                                type: "display_mute",
                              })
                            }
                          >
                            <VolumeX size={15} aria-hidden="true" />
                            Выключить звук
                          </Button>
                          <Button
                            variant="secondary"
                            compact
                            disabled={
                              screen.status !== "online" ||
                              sendControl.isPending
                            }
                            onClick={() =>
                              sendControl.mutate({
                                screen,
                                type: "display_unmute",
                              })
                            }
                          >
                            <Volume2 size={15} aria-hidden="true" />
                            Включить звук
                          </Button>
                        </div>

                        <label>
                          <span>
                            <Sun size={15} aria-hidden="true" />
                            Яркость: {brightnessFor(screen)}%
                          </span>
                          <input
                            type="range"
                            min="1"
                            max="100"
                            step="5"
                            value={brightnessFor(screen)}
                            onChange={(event) =>
                              setBrightnessValues((values) => ({
                                ...values,
                                [screen.id]: Number(event.target.value),
                              }))
                            }
                          />
                        </label>
                        <Button
                          variant="secondary"
                          compact
                          disabled={
                            screen.status !== "online" ||
                            sendControl.isPending
                          }
                          onClick={() =>
                            sendControl.mutate({
                              screen,
                              type: "display_set_brightness",
                              payload: {
                                brightness: brightnessFor(screen),
                              },
                            })
                          }
                        >
                          Применить яркость
                        </Button>

                        <Button
                          variant="danger"
                          compact
                          disabled={
                            screen.status !== "online" ||
                            sendControl.isPending
                          }
                          onClick={() => restartPlayer(screen)}
                        >
                          <RotateCw size={15} aria-hidden="true" />
                          Перезапустить плеер
                        </Button>

                        {screen.status !== "online" && (
                          <small>Управление доступно только онлайн.</small>
                        )}
                      </div>
                    </details>
                  ) : (
                    <span className="monitoring-ok">
                      Только для Android
                    </span>
                  )}
                </td>
                <td>
                  {errorText(screen) ? (
                    <span className="monitoring-error">
                      <AlertTriangle size={15} aria-hidden="true" />
                      {errorText(screen)}
                    </span>
                  ) : (
                    <span className="monitoring-ok">Ошибок нет</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>

      {!query.isLoading && visible.length === 0 && (
        <div className="monitoring-empty">Подходящих экранов не найдено.</div>
      )}
    </div>
  );
}
