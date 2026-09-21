import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AppLanguage = "en" | "ru";

const STORAGE_KEY = "tilecast-language";

type LanguageContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  t: (english: string) => string;
};

const russian: Record<string, string> = {
  Overview: "Обзор",
  Screens: "Экраны",
  Screen: "Экран",
  "Pair screen": "Подключить экран",
  "Pair a screen": "Подключить экран",
  "Bulk changes": "Массовые изменения",
  Archive: "Архив",
  "Screen archive": "Архив экранов",
  "Display Groups": "Группы экранов",
  "Display Group": "Группа экранов",
  Media: "Медиа",
  Content: "Контент",
  Widgets: "Виджеты",
  Widget: "Виджет",
  "Create widget": "Создать виджет",
  "Data Sources": "Источники данных",
  "Data source": "Источник данных",
  "Create data source": "Создать источник данных",
  "Content review": "Проверка контента",
  Playlists: "Плейлисты",
  Playlist: "Плейлист",
  Layouts: "Макеты",
  Layout: "Макет",
  Schedules: "Расписания",
  Schedule: "Расписание",
  Activity: "Активность",
  Settings: "Настройки",
  Account: "Учётная запись",
  Approvals: "Согласования",
  Forms: "Формы",
  Plugins: "Плагины",
  Campaigns: "Кампании",
  Notifications: "Уведомления",
  Critical: "Критично",
  "Needs attention": "Требует внимания",
  Info: "Информация",
  "No active notifications": "Нет активных уведомлений",
  "You're all caught up.": "Новых уведомлений нет.",
  Create: "Создать",
  "Upload media": "Загрузить медиа",
  "Create playlist": "Создать плейлист",
  "Create layout": "Создать макет",
  "Create schedule": "Создать расписание",
  Search: "Поиск",
  "Search Tilecast": "Поиск в Tilecast",
  "Search Tilecast…": "Поиск в Tilecast…",
  Save: "Сохранить",
  Cancel: "Отмена",
  Close: "Закрыть",
  Done: "Готово",
  Delete: "Удалить",
  Edit: "Изменить",
  Add: "Добавить",
  Remove: "Удалить",
  Back: "Назад",
  Next: "Далее",
  Continue: "Продолжить",
  Confirm: "Подтвердить",
  Apply: "Применить",
  Retry: "Повторить",
  Refresh: "Обновить",
  Loading: "Загрузка",
  "Loading…": "Загрузка…",
  Name: "Название",
  Description: "Описание",
  Status: "Статус",
  Online: "В сети",
  "Recently online": "Недавно в сети",
  Stale: "Давно не выходил на связь",
  Offline: "Не в сети",
  Disabled: "Отключён",
  "Pairing revoked": "Подключение отозвано",
  Enabled: "Включено",
  Error: "Ошибка",
  Warning: "Предупреждение",
  Success: "Готово",
  Email: "Электронная почта",
  Password: "Пароль",
  "Sign in": "Войти",
  "Sign out": "Выйти",
  Owner: "Владелец",
  Administrator: "Администратор",
  Editor: "Редактор",
  Viewer: "Наблюдатель",
  "Quick actions": "Быстрые действия",
  Presentations: "Презентации",
  Scheduling: "Расписание",
  Administration: "Администрирование",
  Navigation: "Навигация",
  "↑↓ Move": "↑↓ Перемещение",
  "Enter Open": "Enter Открыть",
  "Esc Close": "Esc Закрыть",
};

function initialLanguage(): AppLanguage {
  if (typeof window === "undefined") return "en";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "ru" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
}

const LanguageContext = createContext<LanguageContextValue>({
  language: "en",
  setLanguage: () => undefined,
  t: (english) => english,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState<AppLanguage>(initialLanguage);
  const value = useMemo<LanguageContextValue>(() => {
    const setLanguage = (next: AppLanguage) => {
      window.localStorage.setItem(STORAGE_KEY, next);
      updateLanguage(next);
    };
    return {
      language,
      setLanguage,
      t: (english) =>
        language === "ru" ? (russian[english] ?? english) : english,
    };
  }, [language]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  return (
    <div
      className="language-switcher"
      role="group"
      aria-label="Language / Язык"
    >
      <button
        type="button"
        aria-pressed={language === "ru"}
        onClick={() => setLanguage("ru")}
      >
        RU
      </button>
      <button
        type="button"
        aria-pressed={language === "en"}
        onClick={() => setLanguage("en")}
      >
        EN
      </button>
    </div>
  );
}
