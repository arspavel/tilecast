import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { api } from "../api/client";
import type { PlaylistAssignment, Screen } from "../api/types";
import { relativeTime } from "./screenHealth";
import "./ScreenOverviewCards.css";

const playbackStates: Record<string, string> = {
  playing: "Воспроизводится",
  idle: "Нет контента",
  disabled: "Показ отключён",
  off_hours: "Вне рабочих часов",
  safe_mode: "Безопасный режим",
  starting: "Запускается",
  error: "Ошибка воспроизведения",
};

const selectionSources: Record<string, string> = {
  takeover: "Захват",
  quick_present: "Временный показ",
  schedule: "По расписанию",
  direct_fallback: "Контент по умолчанию",
};

const networkStates: Record<string, { label: string; tone: string }> = {
  online: { label: "В сети", tone: "ok" },
  stale: { label: "Связь неустойчива", tone: "warn" },
  offline: { label: "Не в сети", tone: "bad" },
  disabled: { label: "Отключён", tone: "muted" },
  revoked: { label: "Привязка отозвана", tone: "bad" },
};

function nextChangeText(value?: string) {
  if (!value) return undefined;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return undefined;
  const sameDay = at.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat("ru-RU", {
    ...(sameDay ? {} : { day: "numeric", month: "long" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="screen-card__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * The screen's Overview: who the screen is (editable in place) and what it is
 * doing now. Everything else the old overview listed lives on the other tabs.
 */
export function ScreenOverviewCards({
  screen,
  assignment,
  quickPresentName,
  nextTransition,
  canEdit,
  editing,
  onEdit,
  editor,
}: {
  screen: Screen;
  assignment?: PlaylistAssignment;
  quickPresentName?: string;
  /** Next schedule change: what the player reported, else the server's own preview. */
  nextTransition?: string;
  canEdit: boolean;
  editing: boolean;
  onEdit: () => void;
  editor: ReactNode;
}) {
  const network = networkStates[screen.status] ?? {
    label: "Нет данных",
    tone: "muted",
  };
  const playback = assignment?.playbackState
    ? (playbackStates[assignment.playbackState] ?? assignment.playbackState)
    : screen.status === "online"
      ? "Ожидание отчёта плеера"
      : "Нет данных";
  const source = quickPresentName
    ? "Временный показ"
    : assignment?.selectionSource
      ? selectionSources[assignment.selectionSource]
      : undefined;
  const content =
    quickPresentName ??
    screen.nowPlayingName ??
    assignment?.playlistName ??
    assignment?.layoutName;
  const next = nextChangeText(nextTransition);

  return (
    <div className="screen-cards">
      <section className="screen-card" aria-labelledby="screen-info-title">
        <header className="screen-card__header">
          <h3 id="screen-info-title">Сведения об экране</h3>
          {canEdit && !editing && (
            <button
              type="button"
              className="button button--secondary button--compact"
              onClick={onEdit}
            >
              <Pencil size={14} aria-hidden="true" /> Изменить
            </button>
          )}
        </header>
        {editing ? (
          <div className="screen-card__editor">{editor}</div>
        ) : (
          <dl className="screen-card__list">
            <Row label="Имя экрана">{screen.name}</Row>
            <Row label="Расположение">
              {screen.location || (
                <span className="screen-card__empty">Не указано</span>
              )}
            </Row>
            <Row label="Номер кабинета">
              {screen.roomNumber || (
                <span className="screen-card__empty">Не указан</span>
              )}
            </Row>
            <Row label="Инвентарный номер">
              {screen.inventoryNumber || (
                <span className="screen-card__empty">Не указан</span>
              )}
            </Row>
          </dl>
        )}
      </section>

      <section className="screen-card" aria-labelledby="screen-state-title">
        <header className="screen-card__header">
          <h3 id="screen-state-title">Состояние</h3>
          {screen.lastContactAt && (
            <span className="screen-card__meta">
              Связь {relativeTime(screen.lastContactAt)}
            </span>
          )}
        </header>
        <dl className="screen-card__list">
          <Row label="Сетевой статус">
            <span
              className={`screen-card__status screen-card__status--${network.tone}`}
            >
              <span aria-hidden="true" />
              {network.label}
            </span>
          </Row>
          <Row label="IP-адрес">
            {screen.lastKnownIp ? (
              <span className="screen-card__mono">{screen.lastKnownIp}</span>
            ) : (
              <span className="screen-card__empty">Нет данных</span>
            )}
          </Row>
          <Row label="Состояние контента">
            <span
              className={
                assignment?.playbackState === "playing"
                  ? "screen-card__good"
                  : undefined
              }
            >
              {playback}
            </span>
          </Row>
          <Row label="Текущий контент">
            {content ? (
              <span className="screen-card__stack">
                <span>{content}</span>
                {source && (
                  <small className="screen-card__source">{source}</small>
                )}
              </span>
            ) : (
              <span className="screen-card__empty">Ничего не назначено</span>
            )}
          </Row>
          <Row label="Следующая смена расписания">
            {next ? (
              next
            ) : (
              <span className="screen-card__stack">
                <span>Не запланирована</span>
                <small className="screen-card__note">
                  {quickPresentName
                    ? "После временного показа — контент по умолчанию"
                    : "Показывается контент по умолчанию"}
                </small>
              </span>
            )}
          </Row>
        </dl>
      </section>

      <ScreenServiceInfoCard screenId={screen.id} />

      <p className="screen-card__device">
        {[
          screen.platform?.toLowerCase().includes("webos")
            ? "LG webOS"
            : screen.platform?.toLowerCase().includes("android")
              ? "Android"
              : screen.platform,
          screen.playerVersion && `плеер ${screen.playerVersion}`,
          screen.screenWidth && screen.screenHeight
            ? `${screen.screenWidth}×${screen.screenHeight}`
            : undefined,
          // "LG" + "LG webOS TV" would read "LG LG webOS TV".
          screen.deviceModel?.startsWith(screen.deviceManufacturer ?? "\u0000")
            ? screen.deviceModel
            : [screen.deviceManufacturer, screen.deviceModel]
                .filter(Boolean)
                .join(" "),
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}

/**
 * What the panel shows on its own service overlay (the remote's Up button),
 * as the player last reported it. LG webOS players from 0.5.1 send it with
 * every heartbeat.
 */
function ScreenServiceInfoCard({ screenId }: { screenId: string }) {
  const report = useQuery({
    queryKey: ["screens", screenId, "service-info"],
    queryFn: () => api.screenServiceInfo(screenId),
    refetchInterval: 15_000,
  });
  const lines = report.data?.lines ?? [];
  const reportedAt = report.data?.reportedAt ?? undefined;
  // The player reports every 15 seconds; a minute of silence means the
  // lines below are what the panel showed when it was last heard from.
  const stale =
    reportedAt !== undefined &&
    Date.now() - new Date(reportedAt).getTime() > 60_000;

  return (
    <section
      className="screen-card screen-card--wide"
      aria-labelledby="screen-service-title"
    >
      <header className="screen-card__header">
        <div>
          <h3 id="screen-service-title">Служебная информация панели</h3>
          <small className="screen-card__note">
            То же, что панель показывает по кнопке «Вверх» на пульте
          </small>
        </div>
        {reportedAt && (
          <span
            className={`screen-card__meta${stale ? " screen-card__meta--stale" : ""}`}
          >
            {stale ? "Устарело: " : "Обновлено "}
            {relativeTime(reportedAt)}
          </span>
        )}
      </header>
      {lines.length > 0 ? (
        <dl className="screen-card__list">
          {lines.map((line, index) => {
            const split = line.indexOf(": ");
            return split > 0 ? (
              <Row key={index} label={line.slice(0, split)}>
                {line.slice(split + 2)}
              </Row>
            ) : (
              <div key={index} className="screen-card__row">
                <dd>{line}</dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="screen-card__placeholder">
          {report.isLoading
            ? "Загрузка…"
            : "Панель ещё не присылала данные. Их отправляет плеер LG webOS 0.5.1 и новее раз в 15 секунд, пока панель на связи."}
        </p>
      )}
    </section>
  );
}
