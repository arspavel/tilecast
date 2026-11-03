// Russian names for the screen Activity tab. The server sends event codes
// (manifest.activated, screen.playlist_assigned) and English titles built from
// them; the code is translated here, so the wording does not depend on how the
// server phrased it. Unknown codes keep the server's title.

export const timelineDomainLabels: Record<string, string> = {
  playback: "Показ",
  connectivity: "Связь",
  reliability: "Надёжность",
  scheduling: "Расписание",
  manifest: "Контент",
  commands: "Команды",
  updates: "Обновления",
  takeovers: "Захваты",
  state: "Состояние",
  incidents: "Инциденты",
  audit: "Действия",
};

const titles: Record<string, string> = {
  // Player activity events
  "player.connected": "Плеер подключился",
  "player.disconnected": "Плеер отключился",
  "player.hello": "Плеер представился серверу",
  "player.status": "Плеер сообщил состояние",
  "manifest.activated": "Контент обновлён на экране",
  "manifest.changed": "Изменён контент экрана",
  "config.changed": "Изменены настройки плеера",
  "playback.started": "Начат показ",
  "playback.stalled": "Показ завис",
  "playback.resumed": "Показ возобновлён",
  "playback.auto_skip": "Элемент пропущен",
  "playback.disable_requested": "Запрошено отключение показа",
  "playback.enable_requested": "Запрошено включение показа",
  "display.disconnected": "Дисплей отключён",
  "display.reconnected": "Дисплей снова подключён",
  "storage.pressure": "Мало места на устройстве",
  "storage.recovered": "Место на устройстве освободилось",
  "sync.drift_exceeded": "Рассинхронизация в группе",
  "sync.drift_recovered": "Синхронизация восстановлена",
  "schedule.became_active": "Началось расписание",
  "schedule.ended": "Закончилось расписание",
  "command.created": "Отправлена команда",
  "command.acknowledged": "Плеер принял команду",
  "command.started": "Команда выполняется",
  "command.succeeded": "Команда выполнена",
  "command.completed": "Команда выполнена",
  "command.failed": "Команда не выполнена",
  "command.expired": "Команда устарела",
  "takeover.active": "Идёт захват",
  "takeover.assigned": "Назначен захват",
  "takeover.changed": "Изменён захват",
  "takeover.activation_failed": "Захват не запустился",
  "takeover.content_preparing": "Подготовка контента захвата",
  "update.downloading": "Загрузка обновления",
  "update.installed": "Обновление установлено",
  "update.failed": "Обновление не удалось",
  // Administrative actions
  "screen.pairing.approved": "Экран привязан",
  "screen.pairing.rejected": "Привязка отклонена",
  "screen.pairing.credential_replaced": "Привязка восстановлена",
  "screen.pairing.hardware_replaced": "Оборудование заменено",
  "screen.pairing.replacement_approved": "Замена оборудования одобрена",
  "screen.credential.revoked": "Привязка отозвана",
  "screen.playlist_assigned": "Назначен плейлист",
  "screen.playlist_unassigned": "Плейлист снят",
  "screen.layout_assigned": "Назначен макет",
  "screen.updated": "Изменены сведения об экране",
  "screen.details": "Изменены сведения об экране",
  "screen.enabled": "Экран включён",
  "screen.disabled": "Экран отключён",
  "screen.policy_changed": "Изменены настройки экрана",
  "screen.policy_reset": "Настройки экрана сброшены",
  // State intervals
  online: "В сети",
  offline: "Не в сети",
  healthy: "Показ в порядке",
  degraded: "Есть проблемы",
  safe_mode: "Безопасный режим",
};

export function timelineTitle(kind: string | undefined, title: string) {
  return (kind && titles[kind]) || title;
}

const values: Record<string, string> = {
  success: "Успешно",
  succeeded: "Успешно",
  failure: "Ошибка",
  failed: "Ошибка",
  completed: "Завершено",
  interrupted: "Прервано",
  skipped: "Пропущено",
  playing: "Воспроизводится",
  healthy: "Исправно",
  degraded: "Есть проблемы",
  impaired: "Есть проблемы",
  offline: "Не в сети",
  online: "В сети",
  unknown: "Неизвестно",
  not_measured: "Не измерено",
};

/** Result and health values; anything unknown falls back to `fallback`. */
export function timelineValue(
  value: string,
  fallback: (value: string) => string,
) {
  return values[value] ?? fallback(value);
}

/** "By Pavel" and "Ended: completed" from the server, in Russian. */
export function timelineDescription(description: string) {
  if (description.startsWith("By ")) return `Кто: ${description.slice(3)}`;
  if (description.startsWith("Ended: "))
    return `Завершено: ${timelineValue(description.slice(7).replaceAll(" ", "_"), (v) => v.replaceAll("_", " "))}`;
  return titles[description.toLowerCase().replaceAll(" ", ".")] ?? description;
}
