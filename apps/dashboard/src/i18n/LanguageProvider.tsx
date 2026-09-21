import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { russianCore } from "./russianCore";

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
  "Find, preview, and organize fullscreen playback for your screens.":
    "Находите, просматривайте и упорядочивайте полноэкранный контент для ваших экранов.",
  "Search names, descriptions, or previewed content":
    "Поиск по названиям, описаниям и содержимому",
  "All playlists": "Все плейлисты",
  "Recently updated": "Недавно обновлённые",
  Standard: "Стандартный",
  "Create playlist": "Создать плейлист",
  "No playlists yet": "Плейлистов пока нет",
  "Create your first playlist": "Создать первый плейлист",
  "Grid view": "Плитка",
  "List view": "Список",
  "My account": "Моя учётная запись",
  Profile: "Профиль",
  Users: "Пользователи",
  Organization: "Организация",
  Security: "Безопасность",
  General: "Общие",
  Appearance: "Оформление",
  Preferences: "Предпочтения",
  Dashboard: "Панель управления",
  Home: "Главная",
  Assets: "Медиафайлы",
  "Data sources": "Источники данных",
  "Content Review": "Проверка контента",
  "Submission Inbox": "Входящие материалы",
  Groups: "Группы",
  "Display groups": "Группы экранов",
  "Emergency alerts": "Экстренные оповещения",
  "Noise meters": "Шумомеры",
  "Countdown bars": "Полосы обратного отсчёта",
  "Brand bugs": "Логотипы",
  Active: "Активно",
  Inactive: "Неактивно",
  Draft: "Черновик",
  Published: "Опубликовано",
  Archived: "В архиве",
  New: "Создать",
  Duplicate: "Дублировать",
  Rename: "Переименовать",
  Preview: "Предпросмотр",
  Publish: "Опубликовать",
  Unpublish: "Снять с публикации",
  Upload: "Загрузить",
  Download: "Скачать",
  Filter: "Фильтр",
  Sort: "Сортировка",
  "Last updated": "Последнее обновление",
  "Created at": "Дата создания",
  "Updated at": "Дата обновления",
  Items: "Элементы",
  Revision: "Версия",
  Duration: "Длительность",
  Type: "Тип",
  Folder: "Папка",
  Tags: "Метки",
  Actions: "Действия",
  Details: "Сведения",
  Advanced: "Дополнительно",
  "No results": "Ничего не найдено",
  "Clear filters": "Сбросить фильтры",
  "Select all": "Выбрать всё",
  Selected: "Выбрано",
  "Unsaved changes": "Несохранённые изменения",
  "Discard changes": "Отменить изменения",
  "Save changes": "Сохранить изменения",
  Yes: "Да",
  No: "Нет",
  Never: "Никогда",
  None: "Нет",
  ...russianCore,
};

function translateEnglish(english: string): string {
  const exact = russian[english];
  if (exact) return exact;

  let match = english.match(/^Showing (\d+) of (\d+) playlists$/);
  if (match) return `Показано ${match[1]} из ${match[2]} плейлистов`;

  match = english.match(/^(\d+) items?$/);
  if (match) return `${match[1]} элемент(а)`;

  match = english.match(/^Revision (\d+)$/);
  if (match) return `Версия ${match[1]}`;

  match = english.match(/^Updated (\d+) (minute|hour|day|week)s? ago$/);
  if (match) {
    const units: Record<string, string> = {
      minute: "мин. назад",
      hour: "ч. назад",
      day: "дн. назад",
      week: "нед. назад",
    };
    return `Обновлено ${match[1]} ${units[match[2]!]}`;
  }

  return english;
}

const textSources = new WeakMap<Text, string>();
const textRendered = new WeakMap<Text, string>();
const attributeSources = new WeakMap<Element, Map<string, string>>();
const attributeRendered = new WeakMap<Element, Map<string, string>>();
const translatedAttributes = ["aria-label", "placeholder", "title", "alt"];

function translateTextNode(node: Text, language: AppLanguage) {
  const parent = node.parentElement;
  if (!parent || ["SCRIPT", "STYLE", "CODE", "PRE"].includes(parent.tagName))
    return;
  const current = node.nodeValue ?? "";
  const previousRendered = textRendered.get(node);
  const source =
    previousRendered !== undefined && current !== previousRendered
      ? current
      : (textSources.get(node) ?? current);
  textSources.set(node, source);
  const trimmed = source.trim();
  if (!trimmed) return;
  const translated = language === "ru" ? translateEnglish(trimmed) : trimmed;
  const leading = source.match(/^\s*/)?.[0] ?? "";
  const trailing = source.match(/\s*$/)?.[0] ?? "";
  const next = `${leading}${translated}${trailing}`;
  textRendered.set(node, next);
  if (current !== next) node.nodeValue = next;
}

function translateElement(element: Element, language: AppLanguage) {
  let sources = attributeSources.get(element);
  if (!sources) {
    sources = new Map<string, string>();
    attributeSources.set(element, sources);
  }
  let rendered = attributeRendered.get(element);
  if (!rendered) {
    rendered = new Map<string, string>();
    attributeRendered.set(element, rendered);
  }
  for (const attribute of translatedAttributes) {
    const current = element.getAttribute(attribute);
    if (current === null) continue;
    if (!sources.has(attribute) || current !== rendered.get(attribute))
      sources.set(attribute, current);
    const source = sources.get(attribute)!;
    const next = language === "ru" ? translateEnglish(source) : source;
    rendered.set(attribute, next);
    if (current !== next) element.setAttribute(attribute, next);
  }
}

function translateTree(root: Node, language: AppLanguage) {
  if (root instanceof Text) {
    translateTextNode(root, language);
    return;
  }
  if (!(root instanceof Element) && !(root instanceof Document)) return;
  if (root instanceof Element) translateElement(root, language);
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  let node = walker.nextNode();
  while (node) {
    if (node instanceof Text) translateTextNode(node, language);
    else if (node instanceof Element) translateElement(node, language);
    node = walker.nextNode();
  }
}

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
    translateTree(document.body, language);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => translateTree(node, language));
        } else if (mutation.type === "attributes") {
          translateElement(mutation.target as Element, language);
        } else if (mutation.type === "characterData") {
          translateTextNode(mutation.target as Text, language);
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: translatedAttributes,
    });
    return () => observer.disconnect();
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
