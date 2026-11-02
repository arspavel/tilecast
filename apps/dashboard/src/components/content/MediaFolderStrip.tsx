import { useState } from "react";
import { Folder, FolderOpen, FolderPlus, Inbox, Layers } from "lucide-react";
import type { ContentFolder } from "../../api/types";
import "./MediaFolderStrip.css";

/**
 * Folders shown as a strip above the Media library. Before this the folders
 * could be chosen on upload but were reachable only through a filter in the
 * filter popover, so a library organised into folders looked flat.
 *
 * value: "" is every file, "unfiled" is files in no folder, otherwise a folder id.
 */
export function MediaFolderStrip({
  folders,
  value,
  onChange,
  canManage,
  onCreate,
}: {
  folders: ContentFolder[];
  value: string;
  onChange: (value: string) => void;
  canManage: boolean;
  onCreate: (name: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const total = folders.reduce((sum, folder) => sum + folder.assetCount, 0);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await onCreate(trimmed);
      setName("");
      setCreating(false);
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Не удалось создать папку.",
      );
    }
  };

  const item = (
    key: string,
    label: string,
    icon: React.ReactNode,
    count?: number,
  ) => (
    <button
      key={key || "all"}
      type="button"
      className={`media-folder${value === key ? " media-folder--active" : ""}`}
      aria-pressed={value === key}
      onClick={() => onChange(key)}
      title={label}
    >
      {icon}
      <span className="media-folder__name">{label}</span>
      {count !== undefined && (
        <span className="media-folder__count">{count}</span>
      )}
    </button>
  );

  return (
    <nav className="media-folders" aria-label="Папки медиатеки">
      {item("", "Все файлы", <Layers size={16} aria-hidden="true" />)}
      {folders.map((folder) =>
        item(
          folder.id,
          folder.name,
          value === folder.id ? (
            <FolderOpen size={16} aria-hidden="true" />
          ) : (
            <Folder size={16} aria-hidden="true" />
          ),
          folder.assetCount,
        ),
      )}
      {folders.length > 0 &&
        item("unfiled", "Без папки", <Inbox size={16} aria-hidden="true" />)}
      {canManage &&
        (creating ? (
          <form
            className="media-folder-new"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <input
              autoFocus
              aria-label="Название новой папки"
              placeholder="Название папки"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setCreating(false);
              }}
            />
            <button
              type="submit"
              className="button button--primary button--compact"
            >
              Создать
            </button>
            <button
              type="button"
              className="button button--quiet button--compact"
              onClick={() => setCreating(false)}
            >
              Отмена
            </button>
            {error && <span className="field__error">{error}</span>}
          </form>
        ) : (
          <button
            type="button"
            className="media-folder media-folder--add"
            onClick={() => setCreating(true)}
          >
            <FolderPlus size={16} aria-hidden="true" />
            <span className="media-folder__name">Новая папка</span>
          </button>
        ))}
      {folders.length === 0 && !creating && (
        <span className="media-folders__hint">
          {total === 0 && canManage
            ? "Создайте папку, чтобы разложить файлы по разделам."
            : ""}
        </span>
      )}
    </nav>
  );
}
