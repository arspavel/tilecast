import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { russianCore } from "./russianCore";
import { russianExtended } from "./russianExtended";
import { russianFinal } from "./russianFinal";
import { russianAuto } from "./russianAuto";
import { russianSweep1 } from "./russianSweep1";
import { russianSweep2 } from "./russianSweep2";
import { russianSweep3 } from "./russianSweep3";
import { russianSweep4 } from "./russianSweep4";

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
  "Search LSR signage": "Поиск в LSR signage",
  "Search LSR signage…": "Поиск в LSR signage…",
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
  ...russianAuto,
  ...russianCore,
  ...russianExtended,
  ...russianFinal,
  ...russianSweep1,
  ...russianSweep2,
  ...russianSweep3,
  ...russianSweep4,
};

// "18h 56m", "3d 2h", "45s" → "18 ч 56 мин"
function russianDuration(value: string) {
  return value
    .replace(/(\d+)\s*d\b/g, "$1 дн")
    .replace(/(\d+)\s*h\b/g, "$1 ч")
    .replace(/(\d+)\s*m\b/g, "$1 мин")
    .replace(/(\d+)\s*s\b/g, "$1 с");
}

function screensWord(count: string) {
  const n = Number(count);
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return "экранов";
  if (ones === 1) return "экран";
  if (ones >= 2 && ones <= 4) return "экрана";
  return "экранов";
}

// Strings built from a template in code: one text node with the value inside.
const templatePatterns: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/^(.+) unit$/, (m) => `Единица: ${translateEnglish(m[1]!).toLowerCase()}`],
  [/^([\d\s.,]+) windows$/, (m) => `${m[1]} окон показа`],
  [/^([\d\s.,]+) ended early$/, (m) => `${m[1]} закончились раньше`],
  [/^([\d\s.,]+) while offline$/, (m) => `${m[1]} без связи`],
  [/^([\d\s.,]+) closed by hand$/, (m) => `${m[1]} закрыто вручную`],
  [/^([\d\s.,]+) min$/, (m) => `${m[1]} мин`],
  [/^(\d+)–(\d+) days$/, (m) => `${m[1]}–${m[2]} дн.`],
  [/^healthy · migration (\d+)$/, (m) => `исправно · миграция ${m[1]}`],
  [
    /^No (.+) screens are enrolled\.$/,
    (m) => `Нет подключённых экранов ${m[1]}.`,
  ],
  [/^Ongoing for (.+)$/, (m) => `Длится ${russianDuration(m[1]!)}`],
  [/^Lasted (.+)$/, (m) => `Длилось ${russianDuration(m[1]!)}`],
  [/^During (.+)$/, (m) => `В течение ${russianDuration(m[1]!)}`],
  [/^Median (.+)$/, (m) => `Медиана ${russianDuration(m[1]!)}`],
  [/^· ended (.+)$/, (m) => `· закончилось ${m[1]}`],
  [/^Published r(\d+)$/, (m) => `Опубликовано, в. ${m[1]}`],
  [/^Published revision (.+)$/, (m) => `Опубликованная версия ${m[1]}`],
  [
    /^Updated (\d+) (minute|hour|day)s? ago$/,
    (m) =>
      `Обновлено ${m[1]} ${{ minute: "мин.", hour: "ч", day: "дн." }[m[2]!]} назад`,
  ],
  [/^Updated (.+)$/, (m) => `Обновлено ${m[1]}`],
  [/^Last used (.+)$/, (m) => `Использовался ${m[1]}`],
  [/^· Last used (.+)$/, (m) => `· использовался ${m[1]}`],
  [/^· Last signed in (.+)$/, (m) => `· последний вход ${m[1]}`],
  [/^· Last delivered (.+)$/, (m) => `· последняя доставка ${m[1]}`],
  [/^· Next scheduled: (.+)$/, (m) => `· следующая по расписанию: ${m[1]}`],
  [/^Last error: (.+)$/, (m) => `Последняя ошибка: ${m[1]}`],
  [/^Captured (.+)$/, (m) => `Снято ${m[1]}`],
  [/^Snapshot captured (.+)$/, (m) => `Снимок сделан ${m[1]}`],
  [/^Latest preview from (.+)$/, (m) => `Последний предпросмотр: ${m[1]}`],
  [/^Until (.+)$/, (m) => `До ${m[1]}`],
  [/^Ready · (.+)$/, (m) => `Готово · ${m[1]}`],
  [/^Version (.+)$/, (m) => `Версия ${m[1]}`],
  [/^Room (.+)$/, (m) => `Помещение ${m[1]}`],
  [/^Retired (.+)$/, (m) => `Выведен ${m[1]}`],
  [/^Display Group: (.+)$/, (m) => `Группа экранов: ${m[1]}`],
  [/^Plays (.+)$/, (m) => `Показывает ${m[1]}`],
  [/^Shows Layout (.+)$/, (m) => `Показывает макет ${m[1]}`],
  [/^On (\d+) screens?$/, (m) => `На ${m[1]} ${screensWord(m[1]!)}`],
  [/^Set display volume to (.+)$/, (m) => `Громкость дисплея: ${m[1]}`],
  [/^Set display brightness to (.+)$/, (m) => `Яркость дисплея: ${m[1]}`],
  [/^Set display input to (.+)$/, (m) => `Вход дисплея: ${m[1]}`],
  [/^\+(\d+) more$/, (m) => `ещё ${m[1]}`],
  [
    /^Page (\d+) of (\d+) · (\d+) pending$/,
    (m) => `Страница ${m[1]} из ${m[2]} · ожидают: ${m[3]}`,
  ],
  [
    /^Page (\d+) of (\d+) · (\d+) total$/,
    (m) => `Страница ${m[1]} из ${m[2]} · всего ${m[3]}`,
  ],
  [/^Uploading… (\d+)%$/, (m) => `Загрузка… ${m[1]}%`],
  [/^Uploading (\d+)%$/, (m) => `Загрузка ${m[1]}%`],
  [/^Takeover active — (.+)$/, (m) => `Идёт захват — ${m[1]}`],
  [/^Takeover active on (.+)$/, (m) => `Идёт захват на ${m[1]}`],
  [/^Hello, (.+)\.$/, (m) => `Здравствуйте, ${m[1]}.`],
  [/^You're set, (.+)\.$/, (m) => `Готово, ${m[1]}.`],
  [
    /^No results for “(.+)”\.$/,
    (m) => `Ничего не найдено по запросу «${m[1]}».`,
  ],
  [
    /^Delete (.+)\? This cannot be undone\.$/,
    (m) => `Удалить ${m[1]}? Это нельзя отменить.`,
  ],
  [
    /^Permanently delete (.+)\? This cannot be undone\.$/,
    (m) => `Удалить ${m[1]} навсегда? Это нельзя отменить.`,
  ],
  [/^Move (.+) to the archive\?$/, (m) => `Отправить ${m[1]} в архив?`],
  [
    /^Delete the folder "(.+)"\? Its assets stay in the library and become unfiled\.$/,
    (m) => `Удалить папку «${m[1]}»? Файлы останутся в медиатеке без папки.`,
  ],
  [
    /^Delete the collection "(.+)"\? Its assets stay in the library\.$/,
    (m) => `Удалить коллекцию «${m[1]}»? Файлы останутся в медиатеке.`,
  ],
  [
    /^Delete the tag "(.+)"\? It is removed from all assets\.$/,
    (m) => `Удалить метку «${m[1]}»? Она будет снята со всех файлов.`,
  ],
  [/^New name for (.+)$/, (m) => `Новое название для ${m[1]}`],
  [
    /^Delete (.+)\? Screens will not be deleted\.$/,
    (m) => `Удалить ${m[1]}? Экраны не будут удалены.`,
  ],
  [/^Delete “(.+)”\?$/, (m) => `Удалить «${m[1]}»?`],
  [/^Delete (.+)\?$/, (m) => `Удалить ${m[1]}?`],
  [/^Deactivate (.+)\?$/, (m) => `Отключить ${m[1]}?`],
  [/^Revoke pairing for (.+)\?$/, (m) => `Отозвать привязку ${m[1]}?`],
  [/^Actions for (.+)$/, (m) => `Действия для ${m[1]}`],
  [/^Rename “(.+)”$/, (m) => `Переименовать «${m[1]}»`],
  [
    /^(Rename|Edit|Duplicate|Archive|Clear|Search|Remove|Select|Delete|Cancel|Revoke|Replace|Choose|Copy|Add) (.{1,60})$/,
    (m) =>
      `${{ Rename: "Переименовать", Edit: "Изменить", Duplicate: "Дублировать", Archive: "В архив", Clear: "Очистить", Search: "Поиск", Remove: "Удалить", Select: "Выбрать", Delete: "Удалить", Cancel: "Отменить", Revoke: "Отозвать", Replace: "Заменить", Choose: "Выбрать", Copy: "Копировать", Add: "Добавить" }[m[1]!]} ${m[2]}`,
  ],
  [/^Move (.+) up$/, (m) => `Переместить ${m[1]} вверх`],
  [/^Move (.+) down$/, (m) => `Переместить ${m[1]} вниз`],
  [
    /^Test message sent to (.+)\.$/,
    (m) => `Тестовое сообщение отправлено на ${m[1]}.`,
  ],
  [
    /^Releases could not be loaded\. (.+)$/,
    (m) => `Не удалось загрузить выпуски. ${m[1]}`,
  ],
  [/^Show all (\d+) releases$/, (m) => `Показать все выпуски (${m[1]})`],
  [
    /^Restored revision (\d+) as revision (\d+)\.$/,
    (m) => `Версия ${m[1]} восстановлена как версия ${m[2]}.`,
  ],
  [/^Live stream · (.+)$/, (m) => `Трансляция · ${m[1]}`],
  [/^Impaired (.+)%$/, (m) => `Есть проблемы ${m[1]}%`],
  [/^Down (.+)%$/, (m) => `Не работает ${m[1]}%`],
  [/^No data (.+)%$/, (m) => `Нет данных ${m[1]}%`],
  [/^Loading (.+)…$/, (m) => `Загрузка: ${translateEnglish(m[1]!)}…`],
  [
    /^Fix (\d+) fields before continuing$/,
    (m) => `Исправьте поля (${m[1]}), чтобы продолжить`,
  ],
  [
    /^Character limit reached \((.+)\)$/,
    (m) => `Достигнут предел символов (${m[1]})`,
  ],
  [/^Uploading (.+)$/, (m) => `Загрузка ${m[1]}`],
];

export function translateEnglish(english: string): string {
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

  match = english.match(/^(\d+)\s*(m|h|d|w) ago$/);
  if (match) {
    const units: Record<string, string> = {
      m: "мин. назад",
      h: "ч. назад",
      d: "дн. назад",
      w: "нед. назад",
    };
    return `${match[1]} ${units[match[2]!]}`;
  }

  match = english.match(/^(.+) screens? down$/);
  if (match) return `${match[1]} экран(а) не в сети`;

  match = english.match(/^Per screen · (.+) with downtime$/);
  if (match) return `По экранам · ${match[1]} с простоем`;

  // Only a short "Open <thing>" is a button; a sentence that starts with the
  // word ("Open incidents right now, …") must not turn into «Открыть …».
  match = english.match(/^Open ([^,.;:]{1,40})$/);
  if (match && match[1]!.split(" ").length <= 4)
    return `Открыть ${translateEnglish(match[1]!)}`;

  for (const [pattern, render] of templatePatterns) {
    match = english.match(pattern);
    if (match) return render(match);
  }

  match = english.match(/^Configure (.+) for LSR signage\.$/);
  if (match)
    return `Настройте параметр «${translateEnglish(match[1]!)}» для LSR signage.`;

  match = english.match(/^(\d+) of (\d+) selected$/);
  if (match) return `Выбрано ${match[1]} из ${match[2]}`;

  match = english.match(/^Showing (\d+) of (\d+) (.+)$/);
  if (match)
    return `Показано ${match[1]} из ${match[2]}: ${translateEnglish(match[3]!)}`;

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
      t: (english) => (language === "ru" ? translateEnglish(english) : english),
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
