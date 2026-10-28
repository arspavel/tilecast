import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RotateCw, Sun, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { api } from "../api/client";
import type { Screen } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "./ui";
import "./ScreenDisplayControls.css";

const commandLabels: Record<string, string> = {
  display_set_volume: "Громкость изменена",
  display_mute: "Звук выключен",
  display_unmute: "Звук включён",
  display_set_brightness: "Яркость изменена",
  restart_player_process: "Команда перезапуска отправлена",
};

/**
 * Volume, sound, brightness, a player restart and the latest Android release
 * for one screen. These lived on the separate Monitoring page; they now sit in
 * the screen's own card, where an operator already is when a screen misbehaves.
 * The card's HDMI-CEC / DDC block stays for hardware that reports it.
 */
export function ScreenDisplayControls({ screen }: { screen: Screen }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const sectionRef = useRef<HTMLElement>(null);
  const [volume, setVolume] = useState(50);
  const [brightness, setBrightness] = useState(100);
  const [message, setMessage] = useState("");
  const csrfToken = auth.status?.csrfToken ?? "";
  const android = screen.platform.toLowerCase().includes("android");
  const online = screen.status === "online";

  const releases = useQuery({
    queryKey: ["player-releases"],
    queryFn: api.playerReleases,
    refetchInterval: 30_000,
    enabled: android,
  });
  const latest = [...(releases.data?.items ?? [])]
    .filter(
      (release) =>
        release.platform === "android" &&
        release.verificationStatus === "verified" &&
        release.cacheStatus === "cached",
    )
    .sort((left, right) => right.versionCode - left.versionCode)[0];
  const updateAvailable =
    latest && (screen.playerVersionCode ?? 0) < latest.versionCode;

  // The screen list's "Управление дисплеем" menu item links here.
  useEffect(() => {
    if (location.hash === "#display-controls")
      sectionRef.current?.scrollIntoView({ block: "start" });
  }, [location.hash]);

  const command = useMutation({
    mutationFn: ({
      type,
      payload = {},
    }: {
      type: string;
      payload?: Record<string, unknown>;
    }) => api.createScreenCommand(screen.id, type, payload, csrfToken),
    onMutate: () => setMessage(""),
    onSuccess: (_result, { type }) =>
      setMessage(`${commandLabels[type] ?? "Команда отправлена"}.`),
    onError: (error) =>
      setMessage(
        error instanceof Error ? error.message : "Команда не отправлена.",
      ),
  });

  const update = useMutation({
    mutationFn: () => {
      if (!latest) throw new Error("Нет проверенного выпуска Android.");
      return api.createUpdateDeployment(
        {
          releaseId: latest.id,
          name: `LSR signage Player ${latest.versionName} · ${screen.name}`,
          mode: "install_now",
          screenIds: [screen.id],
          groupIds: [],
          canarySize: 0,
        },
        csrfToken,
      );
    },
    onMutate: () => setMessage(""),
    onSuccess: async () => {
      setMessage("Обновление запущено. Плеер начнёт загрузку автоматически.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["screens"] }),
        queryClient.invalidateQueries({ queryKey: ["update-deployments"] }),
      ]);
    },
    onError: (error) =>
      setMessage(
        error instanceof Error ? error.message : "Обновление не запущено.",
      ),
  });

  const busy = command.isPending || update.isPending;
  const disabled = !online || busy;

  const restart = () => {
    if (
      window.confirm(
        `Перезапустить LSR signage Player на экране «${screen.name}»? Воспроизведение прервётся на несколько секунд.`,
      )
    )
      command.mutate({ type: "restart_player_process" });
  };

  const requestUpdate = () => {
    if (!latest) return;
    const approval =
      screen.installPermissionStatus === "required"
        ? "\n\nAndroid потребует подтвердить установку на самом устройстве."
        : "";
    if (
      window.confirm(
        `Обновить «${screen.name}» с версии ${screen.playerVersion || "неизвестно"} до ${latest.versionName}?${approval}`,
      )
    )
      update.mutate();
  };

  return (
    <section
      ref={sectionRef}
      id="display-controls"
      className="display-controls"
      aria-labelledby="display-controls-title"
    >
      <header>
        <h4 id="display-controls-title">Управление дисплеем</h4>
        {!online && <span>Доступно, когда экран на связи.</span>}
      </header>
      {android ? (
        <div className="display-controls__grid">
          <div className="display-controls__control">
            <label htmlFor={`volume-${screen.id}`}>
              <Volume2 size={15} aria-hidden="true" />
              Громкость: {volume}%
            </label>
            <input
              id={`volume-${screen.id}`}
              type="range"
              min="0"
              max="100"
              step="5"
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
            <div className="display-controls__row">
              <Button
                variant="secondary"
                compact
                disabled={disabled}
                onClick={() =>
                  command.mutate({
                    type: "display_set_volume",
                    payload: { volume },
                  })
                }
              >
                Применить
              </Button>
              <Button
                variant="secondary"
                compact
                disabled={disabled}
                onClick={() => command.mutate({ type: "display_mute" })}
              >
                <VolumeX size={15} aria-hidden="true" />
                Без звука
              </Button>
              <Button
                variant="secondary"
                compact
                disabled={disabled}
                onClick={() => command.mutate({ type: "display_unmute" })}
              >
                <Volume2 size={15} aria-hidden="true" />
                Со звуком
              </Button>
            </div>
          </div>
          <div className="display-controls__control">
            <label htmlFor={`brightness-${screen.id}`}>
              <Sun size={15} aria-hidden="true" />
              Яркость: {brightness}%
            </label>
            <input
              id={`brightness-${screen.id}`}
              type="range"
              min="1"
              max="100"
              step="5"
              value={brightness}
              onChange={(event) => setBrightness(Number(event.target.value))}
            />
            <div className="display-controls__row">
              <Button
                variant="secondary"
                compact
                disabled={disabled}
                onClick={() =>
                  command.mutate({
                    type: "display_set_brightness",
                    payload: { brightness },
                  })
                }
              >
                Применить
              </Button>
            </div>
          </div>
          <div className="display-controls__control">
            <span className="display-controls__label">
              <Download size={15} aria-hidden="true" />
              Плеер {screen.playerVersion || "—"}
            </span>
            <small>
              {latest
                ? updateAvailable
                  ? `Доступна версия ${latest.versionName}`
                  : "Установлена актуальная версия"
                : "Проверенный выпуск ещё не загружен"}
            </small>
            <div className="display-controls__row">
              {updateAvailable && (
                <Button
                  variant="secondary"
                  compact
                  disabled={disabled}
                  onClick={requestUpdate}
                >
                  Обновить до {latest.versionName}
                </Button>
              )}
              <Button
                variant="danger"
                compact
                disabled={disabled}
                onClick={restart}
              >
                <RotateCw size={15} aria-hidden="true" />
                Перезапустить плеер
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p className="display-controls__note">
          Громкость и яркость меняет Android-плеер. Для этого экрана доступно
          управление по HDMI-CEC на вкладке «Управление», если дисплей его
          поддерживает.
        </p>
      )}
      {message && (
        <p className="display-controls__message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
