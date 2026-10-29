import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Switch } from "../components/ui";

// What the server stops reaching when it works without the Internet. Addresses
// inside the local network keep working: an internal mail server, calendar or
// API is still reachable.
const serverEffects = [
  "Проверка и загрузка новых версий плееров с GitHub — выпуски загружаются в «Обновлениях плеера» вручную",
  "Источники данных с адресами в интернете: погода, качество воздуха, RSS и новости, календари, таблицы Google, транспорт",
  "Погодные оповещения NWS в плагине «Экстренные оповещения»",
  "Письма через внешний почтовый сервер и вебхуки на адреса в интернете",
];

/**
 * The "Работать без интернета" switch. TILECAST_OFFLINE on the server forces
 * the mode on, so the switch is then shown locked.
 */
export function NetworkModeSection() {
  const auth = useAuth();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["network-mode"],
    queryFn: api.networkMode,
  });
  const update = useMutation({
    mutationFn: (offline: boolean) =>
      api.setNetworkMode(offline, auth.status?.csrfToken ?? ""),
    onSuccess: (data) => client.setQueryData(["network-mode"], data),
  });
  const mode = query.data;
  const toggle = (offline: boolean) => {
    const question = offline
      ? "Включить работу без интернета? Сервер перестанет обращаться к адресам за пределами локальной сети."
      : "Разрешить серверу снова обращаться в интернет?";
    if (window.confirm(question)) update.mutate(offline);
  };

  return (
    <section className="settings-subsection">
      <header>
        <h3>Работа без интернета</h3>
        <p>
          Сервер LSR signage обращается только к адресам внутри локальной сети.
          Экраны, Studio и контент на сервере продолжают работать как обычно.
        </p>
      </header>
      {query.error ? (
        <div className="notice notice--error" role="alert">
          Не удалось загрузить режим сети. {query.error.message}
        </div>
      ) : !mode ? (
        <div className="table-loading">Загрузка…</div>
      ) : (
        <>
          <Switch
            label="Работать без интернета"
            description={
              mode.forced
                ? "Включено на сервере переменной TILECAST_OFFLINE. Выключить можно только там."
                : mode.effective
                  ? "Включено. Обращения сервера в интернет отключены."
                  : "Выключено. Сервер может обращаться в интернет."
            }
            checked={mode.effective}
            disabled={mode.forced || update.isPending}
            onChange={(event) => toggle(event.target.checked)}
          />
          {update.error && (
            <div className="notice notice--error" role="alert">
              {update.error.message}
            </div>
          )}
          <div
            className={`notice ${mode.effective ? "notice--info" : ""}`}
            role="status"
          >
            <strong>
              {mode.effective
                ? "Сейчас отключено:"
                : "При включении отключится:"}
            </strong>
            <ul>
              {serverEffects.map((effect) => (
                <li key={effect}>{effect}</li>
              ))}
            </ul>
            Веб-сайты и YouTube в плейлистах и макетах открывают сами экраны, а
            не сервер. Чтобы экраны не выходили в интернет, уберите такие
            элементы из контента или закройте выход в интернет для экранов в
            сети.
          </div>
        </>
      )}
    </section>
  );
}
