import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
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
