import type { Screen } from "../api/types";

// One answer to "is this screen fine?" shared by Overview and Monitoring, so
// both pages count the same screens as working, failing or unreachable.
export type ScreenHealth = "working" | "problem" | "offline" | "disabled";

export const screenHealthNames: Record<ScreenHealth, string> = {
  working: "В работе",
  problem: "Проблема",
  offline: "Нет связи",
  disabled: "Отключён",
};

function activeWebsiteError(screen: Screen) {
  return ["failed", "timed_out", "showing_fallback"].includes(
    screen.websiteState ?? "",
  )
    ? screen.websiteFailureCategory
    : undefined;
}

export function hasError(screen: Screen) {
  return Boolean(
    screen.lastPlaybackError ||
    screen.lastSynchronizationError ||
    activeWebsiteError(screen) ||
    screen.configurationError ||
    screen.updateError,
  );
}

export function errorText(screen: Screen) {
  return (
    screen.lastPlaybackError ||
    screen.lastSynchronizationError ||
    activeWebsiteError(screen) ||
    screen.configurationError ||
    screen.updateError ||
    ""
  );
}

/** Online but showing nothing; Show now content counts as playing. */
export function isIdle(screen: Screen, presenting = false) {
  if (presenting) return false;
  const playbackIdle =
    !screen.playbackState ||
    ["idle", "stopped", "no_content"].includes(screen.playbackState);
  return (
    screen.status === "online" &&
    !screen.nowPlayingName &&
    playbackIdle &&
    !hasError(screen)
  );
}

export function screenHealth(screen: Screen, presenting = false): ScreenHealth {
  if (screen.status === "disabled" || screen.status === "revoked")
    return "disabled";
  if (screen.status === "offline" || screen.status === "stale")
    return "offline";
  if (hasError(screen) || isIdle(screen, presenting)) return "problem";
  return "working";
}

export function relativeTime(value?: string) {
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
