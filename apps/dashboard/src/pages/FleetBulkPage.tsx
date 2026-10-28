import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, History, RotateCcw } from "lucide-react";
import { Link } from "react-router";
import { api } from "../api/client";
import type {
  BulkAction,
  BulkOperation,
  BulkOperationRequest,
  BulkPreview,
  PlayerRelease,
  Screen,
} from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { PageHeader, Select } from "../components/ui";
import { ScreenManagementTabs } from "../components/ScreenManagementTabs";
import "./FleetBulkPage.css";

// Player updates go through update deployments, not the bulk operation API,
// so the page offers them as one more action next to the server-side ones.
type PageAction = BulkAction | "update_player";

const actionLabels: Record<PageAction, string> = {
  assign_playlist: "Назначить плейлист",
  assign_layout: "Назначить макет",
  clear_assignment: "Снять назначение",
  set_enabled: "Включить или выключить воспроизведение",
  send_command: "Отправить команду",
  update_player: "Обновить плеер",
};

// The bulk command set is deliberately the safe, idempotent subset. A command
// that takes a screen off the air is a per-screen decision.
const bulkCommands = [
  { value: "sync_now", label: "Синхронизировать сейчас" },
  { value: "reload_playback", label: "Перезапустить воспроизведение" },
  { value: "clear_media_cache", label: "Очистить кэш медиа" },
  { value: "restart_player_process", label: "Перезапустить плеер" },
];

function screensLabel(count: number) {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return `${count} экранов`;
  if (ones === 1) return `${count} экран`;
  if (ones >= 2 && ones <= 4) return `${count} экрана`;
  return `${count} экранов`;
}

function isAndroid(screen: Screen) {
  return screen.platform.toLowerCase().includes("android");
}

type UpdateRow = {
  screen: Screen;
  verdict: "update" | "current" | "unsupported";
};

// The same rule ScreenDisplayControls uses for one screen: only an Android
// player older than the release is updated; a newer or equal one is left alone.
function updateRows(screens: Screen[], release: PlayerRelease): UpdateRow[] {
  return screens.map((screen) => ({
    screen,
    verdict: !isAndroid(screen)
      ? "unsupported"
      : (screen.playerVersionCode ?? 0) < release.versionCode
        ? "update"
        : "current",
  }));
}

export function FleetBulkPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const csrf = auth.status?.csrfToken ?? "";

  const screens = useQuery({ queryKey: ["screens"], queryFn: api.screens });
  const playlists = useQuery({
    queryKey: ["playlists"],
    queryFn: () => api.playlists(),
  });
  const layouts = useQuery({
    queryKey: ["layouts"],
    queryFn: () => api.layouts(),
  });
  const operations = useQuery({
    queryKey: ["bulk-operations"],
    queryFn: () => api.bulkOperations(5),
  });
  const releases = useQuery({
    queryKey: ["player-releases"],
    queryFn: api.playerReleases,
  });

  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<PageAction>("assign_playlist");
  const [playlistId, setPlaylistId] = useState("");
  const [layoutId, setLayoutId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [commandType, setCommandType] = useState("sync_now");
  const [releaseId, setReleaseId] = useState("");
  const [preview, setPreview] = useState<BulkPreview>();
  const [updatePreview, setUpdatePreview] = useState<UpdateRow[]>();
  const [result, setResult] = useState<BulkOperation>();
  const [updateResult, setUpdateResult] = useState<{
    targetCount: number;
    versionName: string;
  }>();
  // Kept separately because apply clears the preview before the result renders.
  const [undoWindowMinutes, setUndoWindowMinutes] = useState<number>();

  const items = screens.data?.items ?? [];
  const androidReleases = [...(releases.data?.items ?? [])]
    .filter(
      (release) =>
        release.platform === "android" &&
        release.verificationStatus === "verified" &&
        release.cacheStatus === "cached",
    )
    .sort((left, right) => right.versionCode - left.versionCode);
  const release =
    androidReleases.find((item) => item.id === releaseId) ?? androidReleases[0];

  function resetPreview() {
    setPreview(undefined);
    setUpdatePreview(undefined);
  }

  function buildRequest(): BulkOperationRequest {
    const request: BulkOperationRequest = {
      screenIds: selected,
      action: action as BulkAction,
    };
    if (action === "assign_playlist") request.playlistId = playlistId;
    if (action === "assign_layout") request.layoutId = layoutId;
    if (action === "set_enabled") request.enabled = enabled;
    if (action === "send_command") request.commandType = commandType;
    return request;
  }

  const build = useMutation({
    mutationFn: () => api.previewBulkOperation(buildRequest()),
    onSuccess: (data) => {
      setPreview(data);
      setResult(undefined);
      setUpdateResult(undefined);
      setUndoWindowMinutes(data.undoWindowMinutes);
    },
  });
  const apply = useMutation({
    mutationFn: () =>
      api.applyBulkOperation(
        { ...buildRequest(), expectedChangeCount: preview?.changeCount ?? 0 },
        csrf,
      ),
    onSuccess: (data) => {
      setResult(data);
      setPreview(undefined);
      void client.invalidateQueries({ queryKey: ["screens"] });
      void client.invalidateQueries({ queryKey: ["bulk-operations"] });
    },
  });
  const undo = useMutation({
    mutationFn: (id: string) => api.undoBulkOperation(id, csrf),
    onSuccess: () => {
      setResult(undefined);
      void client.invalidateQueries({ queryKey: ["screens"] });
      void client.invalidateQueries({ queryKey: ["bulk-operations"] });
    },
  });
  const deploy = useMutation({
    mutationFn: () => {
      const targets = (updatePreview ?? [])
        .filter((row) => row.verdict === "update")
        .map((row) => row.screen.id);
      if (!release || targets.length === 0)
        throw new Error("Нет экранов для обновления.");
      return api.createUpdateDeployment(
        {
          releaseId: release.id,
          name: `LSR signage Player ${release.versionName} · ${screensLabel(targets.length)}`,
          mode: "install_now",
          screenIds: targets,
          groupIds: [],
          canarySize: 0,
        },
        csrf,
      );
    },
    onSuccess: (data) => {
      setUpdateResult({
        targetCount: data.targetCount,
        versionName: release?.versionName ?? "",
      });
      setUpdatePreview(undefined);
      void client.invalidateQueries({ queryKey: ["screens"] });
      void client.invalidateQueries({ queryKey: ["update-deployments"] });
    },
  });

  const ready =
    selected.length > 0 &&
    (action !== "assign_playlist" || playlistId !== "") &&
    (action !== "assign_layout" || layoutId !== "") &&
    (action !== "update_player" || release !== undefined);

  const allSelected = items.length > 0 && selected.length === items.length;

  function previewChange() {
    if (action !== "update_player") {
      build.mutate();
      return;
    }
    if (!release) return;
    setResult(undefined);
    setUpdateResult(undefined);
    setUpdatePreview(
      updateRows(
        items.filter((item) => selected.includes(item.id)),
        release,
      ),
    );
  }

  return (
    <div className="bulk-page">
      <PageHeader
        title="Массовые изменения"
        description="Одно изменение сразу для многих экранов. Перед применением LSR signage покажет, что именно изменится, включая экраны, которые попадут в изменение через группу."
      />
      <ScreenManagementTabs current="bulk" />

      <div className="bulk-workspace">
        <section className="bulk-panel" aria-labelledby="bulk-screens-heading">
          <header className="bulk-panel__header">
            <div className="bulk-panel__heading">
              <h2 id="bulk-screens-heading">Экраны</h2>
              <p>
                Экраны одной группы воспроизводят общее назначение, поэтому
                выбор одного участника группы затрагивает и остальных. Они будут
                перечислены в предпросмотре.
              </p>
            </div>
            <div className="bulk-panel__actions">
              <span className="bulk-count">
                {`Выбрано ${selected.length} из ${items.length}`}
              </span>
              <button
                className="button button--quiet button--compact"
                type="button"
                disabled={items.length === 0}
                onClick={() => {
                  resetPreview();
                  setSelected(allSelected ? [] : items.map((item) => item.id));
                }}
              >
                {allSelected ? "Снять выбор" : "Выбрать все"}
              </button>
            </div>
          </header>

          {items.length === 0 ? (
            <div className="bulk-empty">
              {screens.isLoading
                ? "Загрузка экранов…"
                : "Пока нет подключённых экранов."}
            </div>
          ) : (
            <div className="bulk-picker">
              {items.map((item) => {
                const isSelected = selected.includes(item.id);
                return (
                  <label
                    className={`checkbox-control bulk-picker__option${
                      isSelected ? " bulk-picker__option--selected" : ""
                    }`}
                    key={item.id}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(event) => {
                        resetPreview();
                        setSelected((ids) =>
                          event.target.checked
                            ? [...ids, item.id]
                            : ids.filter((id) => id !== item.id),
                        );
                      }}
                    />
                    <span className="bulk-picker__label">
                      <span>{item.name}</span>
                      <small>
                        {[
                          item.syncGroupName
                            ? `Группа: ${item.syncGroupName}`
                            : item.location || "Местоположение не указано",
                          action === "update_player" && item.playerVersion
                            ? `плеер ${item.playerVersion}`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </section>

        <section
          className="bulk-panel bulk-change"
          aria-labelledby="bulk-change-heading"
        >
          <header className="bulk-panel__header">
            <div className="bulk-panel__heading">
              <h2 id="bulk-change-heading">Изменение</h2>
            </div>
          </header>

          <div className="bulk-panel__body">
            <div className="bulk-field">
              <label htmlFor="bulk-action">Действие</label>
              <Select
                id="bulk-action"
                value={action}
                onChange={(event) => {
                  setAction(event.target.value as PageAction);
                  resetPreview();
                }}
              >
                {(Object.keys(actionLabels) as PageAction[]).map((value) => (
                  <option key={value} value={value}>
                    {actionLabels[value]}
                  </option>
                ))}
              </Select>
            </div>

            {action === "assign_playlist" && (
              <div className="bulk-field">
                <label htmlFor="bulk-playlist">Плейлист</label>
                <Select
                  id="bulk-playlist"
                  value={playlistId}
                  onChange={(event) => {
                    setPlaylistId(event.target.value);
                    resetPreview();
                  }}
                >
                  <option value="">Выберите плейлист</option>
                  {playlists.data?.items?.map((playlist) => (
                    <option key={playlist.id} value={playlist.id}>
                      {playlist.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {action === "assign_layout" && (
              <div className="bulk-field">
                <label htmlFor="bulk-layout">Макет</label>
                <Select
                  id="bulk-layout"
                  value={layoutId}
                  onChange={(event) => {
                    setLayoutId(event.target.value);
                    resetPreview();
                  }}
                >
                  <option value="">Выберите макет</option>
                  {layouts.data?.items?.map((layout) => (
                    <option key={layout.id} value={layout.id}>
                      {layout.name}
                    </option>
                  ))}
                </Select>
                <p>Назначить можно только опубликованный макет.</p>
              </div>
            )}

            {action === "set_enabled" && (
              <div className="bulk-field">
                <label htmlFor="bulk-enabled">Воспроизведение</label>
                <Select
                  id="bulk-enabled"
                  value={enabled ? "enabled" : "disabled"}
                  onChange={(event) => {
                    setEnabled(event.target.value === "enabled");
                    resetPreview();
                  }}
                >
                  <option value="enabled">Включить воспроизведение</option>
                  <option value="disabled">Выключить воспроизведение</option>
                </Select>
              </div>
            )}

            {action === "send_command" && (
              <div className="bulk-field">
                <label htmlFor="bulk-command">Команда</label>
                <Select
                  id="bulk-command"
                  value={commandType}
                  onChange={(event) => {
                    setCommandType(event.target.value);
                    resetPreview();
                  }}
                >
                  {bulkCommands.map((command) => (
                    <option key={command.value} value={command.value}>
                      {command.label}
                    </option>
                  ))}
                </Select>
                <p>Команду нельзя отменить после того, как плеер её получил.</p>
              </div>
            )}

            {action === "update_player" && (
              <div className="bulk-field">
                <label htmlFor="bulk-release">Версия Android-плеера</label>
                {androidReleases.length === 0 ? (
                  <p>
                    {releases.isLoading
                      ? "Загрузка выпусков…"
                      : "Нет проверенного и загруженного выпуска. Проверьте выпуски в разделе "}
                    {!releases.isLoading && (
                      <Link to="/settings/player/updates">
                        «Обновления плеера»
                      </Link>
                    )}
                  </p>
                ) : (
                  <Select
                    id="bulk-release"
                    value={release?.id ?? ""}
                    onChange={(event) => {
                      setReleaseId(event.target.value);
                      resetPreview();
                    }}
                  >
                    {androidReleases.map((item, index) => (
                      <option key={item.id} value={item.id}>
                        {`${item.versionName}${index === 0 ? " (последняя)" : ""}`}
                      </option>
                    ))}
                  </Select>
                )}
                <p>
                  Обновятся только Android-плееры с более старой версией. Плеер
                  скачает выпуск и установит его сам; на устройствах без прав
                  владельца Android попросит подтвердить установку на экране.
                </p>
              </div>
            )}
          </div>

          {build.error && (
            <div className="notice notice--error" role="alert">
              {build.error.message}
            </div>
          )}

          <div className="bulk-panel__footer">
            <div className="bulk-panel__actions">
              <button
                className="button button--primary"
                type="button"
                disabled={!ready || build.isPending}
                onClick={previewChange}
              >
                {build.isPending ? "Проверка…" : "Показать, что изменится"}
              </button>
            </div>
          </div>
        </section>
      </div>

      {preview && (
        <PreviewSection
          preview={preview}
          applying={apply.isPending}
          error={apply.error?.message}
          onApply={() => apply.mutate()}
          onCancel={() => setPreview(undefined)}
        />
      )}

      {updatePreview && release && (
        <UpdatePreviewSection
          rows={updatePreview}
          release={release}
          applying={deploy.isPending}
          error={deploy.error?.message}
          onApply={() => deploy.mutate()}
          onCancel={() => setUpdatePreview(undefined)}
        />
      )}

      {updateResult && (
        <section className="bulk-panel" aria-labelledby="bulk-update-heading">
          <header className="bulk-panel__header">
            <div className="bulk-panel__heading">
              <h2 id="bulk-update-heading">Обновление запущено</h2>
              <p>
                {`Версия ${updateResult.versionName} отправлена на ${screensLabel(updateResult.targetCount)}. `}
                Ход установки виден в разделе{" "}
                <Link to="/settings/player/updates">«Обновления плеера»</Link>.
              </p>
            </div>
          </header>
        </section>
      )}

      {result && (
        <section className="bulk-panel" aria-labelledby="bulk-applied-heading">
          <header className="bulk-panel__header">
            <div className="bulk-panel__heading">
              <h2 id="bulk-applied-heading">Применено</h2>
            </div>
          </header>

          <div className="bulk-tally">
            <div>
              <strong>{result.appliedCount}</strong>
              <span>изменено</span>
            </div>
            <div>
              <strong>{result.skippedCount}</strong>
              <span>без изменений или пропущено</span>
            </div>
            {result.failedCount > 0 && (
              <div>
                <strong>{result.failedCount}</strong>
                <span>с ошибкой</span>
              </div>
            )}
          </div>

          {result.failedCount > 0 && (
            <div className="notice notice--error" role="alert">
              Некоторые экраны не изменились:
              <ul>
                {result.results
                  .filter((row) => row.error)
                  .map((row) => (
                    <li key={row.screenId}>
                      {row.name}: {row.error}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {undo.error && (
            <div className="notice notice--error" role="alert">
              {undo.error.message}
            </div>
          )}

          {result.reversible && (
            <div className="bulk-panel__footer">
              <p>
                {`Изменение можно отменить в течение ${undoWindowMinutes ?? 15} мин.`}
              </p>
              <div className="bulk-panel__actions">
                <button
                  className="button"
                  type="button"
                  disabled={undo.isPending}
                  onClick={() => undo.mutate(result.id)}
                >
                  <RotateCcw size={15} aria-hidden="true" />{" "}
                  {undo.isPending ? "Отмена…" : "Отменить изменение"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="bulk-panel" aria-labelledby="bulk-recent-heading">
        <header className="bulk-panel__header">
          <div className="bulk-panel__heading">
            <h2 id="bulk-recent-heading">Недавние массовые изменения</h2>
          </div>
        </header>
        {!operations.data?.length ? (
          <div className="bulk-empty">
            <History size={22} aria-hidden="true" />
            <p>Массовых изменений ещё не было.</p>
          </div>
        ) : (
          <div className="bulk-history">
            {operations.data.map((operation) => (
              <div className="bulk-history__row" key={operation.id}>
                <div className="bulk-row__copy">
                  <strong>{actionLabels[operation.action]}</strong>
                  <small>
                    {[
                      new Date(operation.createdAt).toLocaleString("ru-RU"),
                      screensLabel(operation.appliedCount),
                      operation.undoneAt ? "отменено" : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </div>
                {operation.reversible ? (
                  // Undo is consequential, so it keeps a visible outline rather
                  // than the quiet variant that reads as plain text at rest.
                  <button
                    className="button button--secondary button--compact"
                    type="button"
                    disabled={undo.isPending}
                    onClick={() => undo.mutate(operation.id)}
                  >
                    Отменить
                  </button>
                ) : (
                  <span className="bulk-history__note">
                    {operation.undoneAt ? "Отменено" : "Срок отмены истёк"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PreviewSection({
  preview,
  applying,
  error,
  onApply,
  onCancel,
}: {
  preview: BulkPreview;
  applying: boolean;
  error?: string;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <section
      className="bulk-panel bulk-panel--decision"
      aria-labelledby="bulk-preview-heading"
    >
      <header className="bulk-panel__header">
        <div className="bulk-panel__heading">
          <h2 id="bulk-preview-heading">Что изменится</h2>
          <p>Пока ничего не применено. Проверьте список и подтвердите.</p>
        </div>
      </header>

      <div className="bulk-tally">
        <div>
          <strong>{preview.changeCount}</strong>
          <span>изменится</span>
        </div>
        <div>
          <strong>{preview.unchangedCount}</strong>
          <span>уже в нужном состоянии</span>
        </div>
        {preview.blockedCount > 0 && (
          <div>
            <strong>{preview.blockedCount}</strong>
            <span>нельзя изменить</span>
          </div>
        )}
      </div>

      {preview.warnings.map((warning) => (
        <div className="notice notice--info" key={warning} role="status">
          {warning}
        </div>
      ))}

      <div className="bulk-rows">
        {preview.screens.map((row) => (
          <div className="bulk-row" key={row.screenId}>
            <div className="bulk-row__copy">
              <strong>
                {row.fromGroup
                  ? `${row.name} (через ${row.fromGroup})`
                  : row.name}
              </strong>
              {/* The arrow is decoration; "станет" is what a screen reader
                  needs so the two states are not read as one run-on value. */}
              <small className="bulk-transition">
                <span>{row.current}</span>
                <ArrowRight size={13} aria-hidden="true" />
                <span className="visually-hidden">станет</span>
                <span className="bulk-transition__next">{row.next}</span>
              </small>
            </div>
            <span className="bulk-row__verdict">
              {row.blocked ? (
                <span className="status-chip status-chip--offline">
                  {`Пропущен: ${row.blocked}`}
                </span>
              ) : row.changes ? (
                <span className="status-chip status-chip--recent">
                  Изменится
                </span>
              ) : (
                "Без изменений"
              )}
            </span>
          </div>
        ))}
      </div>

      {error && (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      )}

      <div className="bulk-panel__footer">
        <div className="bulk-panel__actions">
          <button
            className="button button--quiet"
            type="button"
            onClick={onCancel}
          >
            Отмена
          </button>
          <button
            className="button button--primary"
            type="button"
            disabled={applying || preview.changeCount === 0}
            onClick={onApply}
          >
            {applying
              ? "Применение…"
              : `Изменить ${screensLabel(preview.changeCount)}`}
          </button>
        </div>
      </div>
    </section>
  );
}

const updateVerdicts: Record<UpdateRow["verdict"], string> = {
  update: "Обновится",
  current: "Уже актуальная версия",
  unsupported: "Не Android — обновляется с сервера",
};

function UpdatePreviewSection({
  rows,
  release,
  applying,
  error,
  onApply,
  onCancel,
}: {
  rows: UpdateRow[];
  release: PlayerRelease;
  applying: boolean;
  error?: string;
  onApply: () => void;
  onCancel: () => void;
}) {
  const count = (verdict: UpdateRow["verdict"]) =>
    rows.filter((row) => row.verdict === verdict).length;
  const updating = count("update");
  return (
    <section
      className="bulk-panel bulk-panel--decision"
      aria-labelledby="bulk-update-preview-heading"
    >
      <header className="bulk-panel__header">
        <div className="bulk-panel__heading">
          <h2 id="bulk-update-preview-heading">Что обновится</h2>
          <p>
            {`Версия ${release.versionName}. Пока ничего не отправлено — проверьте список и подтвердите.`}
          </p>
        </div>
      </header>

      <div className="bulk-tally">
        <div>
          <strong>{updating}</strong>
          <span>обновится</span>
        </div>
        <div>
          <strong>{count("current")}</strong>
          <span>уже актуальная версия</span>
        </div>
        {count("unsupported") > 0 && (
          <div>
            <strong>{count("unsupported")}</strong>
            <span>не Android</span>
          </div>
        )}
      </div>

      <div className="bulk-rows">
        {rows.map(({ screen, verdict }) => (
          <div className="bulk-row" key={screen.id}>
            <div className="bulk-row__copy">
              <strong>{screen.name}</strong>
              <small className="bulk-transition">
                <span>{screen.playerVersion || "версия неизвестна"}</span>
                {verdict === "update" && (
                  <>
                    <ArrowRight size={13} aria-hidden="true" />
                    <span className="visually-hidden">станет</span>
                    <span className="bulk-transition__next">
                      {release.versionName}
                    </span>
                  </>
                )}
              </small>
            </div>
            <span className="bulk-row__verdict">
              {verdict === "update" ? (
                <span className="status-chip status-chip--recent">
                  {updateVerdicts.update}
                </span>
              ) : (
                updateVerdicts[verdict]
              )}
            </span>
          </div>
        ))}
      </div>

      {error && (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      )}

      <div className="bulk-panel__footer">
        <div className="bulk-panel__actions">
          <button
            className="button button--quiet"
            type="button"
            onClick={onCancel}
          >
            Отмена
          </button>
          <button
            className="button button--primary"
            type="button"
            disabled={applying || updating === 0}
            onClick={onApply}
          >
            {applying ? "Отправка…" : `Обновить ${screensLabel(updating)}`}
          </button>
        </div>
      </div>
    </section>
  );
}
