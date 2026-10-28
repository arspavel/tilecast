// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { FleetBulkPage } from "./FleetBulkPage";
import { api } from "../api/client";
import type { BulkPreview } from "../api/types";

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ status: { csrfToken: "csrf", user: { role: "owner" } } }),
}));

const preview: BulkPreview = {
  action: "assign_playlist",
  screens: [
    {
      screenId: "s1",
      name: "Cafeteria",
      current: "Playlist: Old menu",
      next: "Playlist: New menu",
      changes: true,
      selected: true,
    },
    {
      screenId: "s2",
      name: "Gym",
      current: "Nothing assigned",
      next: "Playlist: New menu",
      changes: true,
      selected: false,
      fromGroup: "North Wing",
    },
    {
      screenId: "s3",
      name: "Old lobby TV",
      current: "Nothing assigned",
      next: "Playlist: New menu",
      changes: false,
      blocked: "Archived",
      selected: true,
    },
  ],
  changeCount: 2,
  unchangedCount: 0,
  blockedCount: 1,
  groupAddedCount: 1,
  warnings: [
    "1 more screens are included because they share a Display Group (North Wing). A Display Group plays one assignment on every member.",
  ],
  reversible: true,
  undoWindowMinutes: 15,
};

// Studio's Select is a Signal combobox, not a native <select>: open it, then
// click the option.
async function choose(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string | RegExp,
) {
  await user.click(await screen.findByLabelText(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FleetBulkPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Fleet bulk changes", () => {
  beforeEach(() => {
    // The page reads a handful of fields from each list; the fixtures carry
    // those and are widened rather than restating whole API shapes.
    const widen = <T,>(value: unknown) => value as T;
    vi.spyOn(api, "screens").mockResolvedValue(
      widen<Awaited<ReturnType<typeof api.screens>>>({
        items: [
          { id: "s1", name: "Cafeteria" },
          { id: "s2", name: "Gym", syncGroupName: "North Wing" },
        ],
        total: 2,
      }),
    );
    vi.spyOn(api, "playlists").mockResolvedValue(
      widen<Awaited<ReturnType<typeof api.playlists>>>({
        items: [{ id: "p1", name: "New menu" }],
        total: 1,
      }),
    );
    vi.spyOn(api, "layouts").mockResolvedValue(
      widen<Awaited<ReturnType<typeof api.layouts>>>({ items: [], total: 0 }),
    );
    vi.spyOn(api, "bulkOperations").mockResolvedValue([]);
    vi.spyOn(api, "playerReleases").mockResolvedValue(
      widen<Awaited<ReturnType<typeof api.playerReleases>>>({ items: [] }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("will not preview until screens and a playlist are chosen", async () => {
    renderPage();
    const button = await screen.findByRole("button", {
      name: /Показать, что изменится/,
    });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("names the screens pulled in by a Display Group before anything is applied", async () => {
    const build = vi
      .spyOn(api, "previewBulkOperation")
      .mockResolvedValue(preview);
    renderPage();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("checkbox", { name: /Cafeteria/ }),
    );
    await choose(user, "Плейлист", "New menu");
    await user.click(
      screen.getByRole("button", { name: /Показать, что изменится/ }),
    );

    await waitFor(() => expect(build).toHaveBeenCalled());
    expect(await screen.findByText(/Gym \(через North Wing\)/)).toBeTruthy();
    expect(screen.getByText(/share a Display Group/)).toBeTruthy();
  });

  it("reports a blocked screen as skipped rather than dropping it", async () => {
    vi.spyOn(api, "previewBulkOperation").mockResolvedValue(preview);
    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("checkbox", { name: /Cafeteria/ }),
    );
    await choose(user, "Плейлист", "New menu");
    await user.click(
      screen.getByRole("button", { name: /Показать, что изменится/ }),
    );

    expect(await screen.findByText(/Пропущен: Archived/)).toBeTruthy();
  });

  it("confirms with the number of screens that actually move", async () => {
    vi.spyOn(api, "previewBulkOperation").mockResolvedValue(preview);
    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("checkbox", { name: /Cafeteria/ }),
    );
    await choose(user, "Плейлист", "New menu");
    await user.click(
      screen.getByRole("button", { name: /Показать, что изменится/ }),
    );

    // Three rows are listed, two of them change. The button must say two.
    expect(
      await screen.findByRole("button", { name: "Изменить 2 экрана" }),
    ).toBeTruthy();
  });

  it("sends the confirmed change count so a moved fleet is caught", async () => {
    vi.spyOn(api, "previewBulkOperation").mockResolvedValue(preview);
    const apply = vi.spyOn(api, "applyBulkOperation").mockResolvedValue({
      id: "op1",
      action: "assign_playlist",
      screenCount: 3,
      appliedCount: 2,
      skippedCount: 1,
      failedCount: 0,
      results: [],
      reversible: true,
      createdAt: "2026-03-04T12:00:00Z",
    });
    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("checkbox", { name: /Cafeteria/ }),
    );
    await choose(user, "Плейлист", "New menu");
    await user.click(
      screen.getByRole("button", { name: /Показать, что изменится/ }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Изменить 2 экрана" }),
    );

    await waitFor(() => expect(apply).toHaveBeenCalled());
    const [applied] = apply.mock.calls[0] ?? [];
    expect(applied?.expectedChangeCount).toBe(2);
  });

  it("offers undo after a reversible change", async () => {
    vi.spyOn(api, "previewBulkOperation").mockResolvedValue(preview);
    vi.spyOn(api, "applyBulkOperation").mockResolvedValue({
      id: "op1",
      action: "assign_playlist",
      screenCount: 3,
      appliedCount: 2,
      skippedCount: 1,
      failedCount: 0,
      results: [],
      reversible: true,
      createdAt: "2026-03-04T12:00:00Z",
    });
    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("checkbox", { name: /Cafeteria/ }),
    );
    await choose(user, "Плейлист", "New menu");
    await user.click(
      screen.getByRole("button", { name: /Показать, что изменится/ }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Изменить 2 экрана" }),
    );

    expect(
      await screen.findByRole("button", { name: /Отменить изменение/ }),
    ).toBeTruthy();
  });

  it("warns that a command cannot be undone", async () => {
    renderPage();
    const user = userEvent.setup();
    await choose(user, "Действие", "Отправить команду");
    expect(
      screen.getByText(/нельзя отменить после того, как плеер её получил/),
    ).toBeTruthy();
  });

  it("updates only the Android players that are older than the release", async () => {
    const widen = <T,>(value: unknown) => value as T;
    vi.spyOn(api, "screens").mockResolvedValue(
      widen<Awaited<ReturnType<typeof api.screens>>>({
        items: [
          {
            id: "s1",
            name: "Cafeteria",
            platform: "android",
            playerVersion: "0.36.0",
            playerVersionCode: 59,
          },
          {
            id: "s2",
            name: "Gym",
            platform: "android",
            playerVersion: "0.37.0",
            playerVersionCode: 60,
          },
          {
            id: "s3",
            name: "Lobby LG",
            platform: "webos",
            playerVersion: "0.3.2",
          },
        ],
        total: 3,
      }),
    );
    vi.spyOn(api, "playerReleases").mockResolvedValue(
      widen<Awaited<ReturnType<typeof api.playerReleases>>>({
        items: [
          {
            id: "r60",
            platform: "android",
            versionCode: 60,
            versionName: "0.37.0",
            verificationStatus: "verified",
            cacheStatus: "cached",
          },
        ],
      }),
    );
    const deploy = vi
      .spyOn(api, "createUpdateDeployment")
      .mockResolvedValue({ id: "d1", targetCount: 1 });
    renderPage();
    const user = userEvent.setup();

    await choose(user, "Действие", "Обновить плеер");
    await user.click(screen.getByRole("button", { name: "Выбрать все" }));
    await user.click(
      screen.getByRole("button", { name: /Показать, что изменится/ }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Обновить 1 экран" }),
    );

    await waitFor(() => expect(deploy).toHaveBeenCalled());
    const [input] = deploy.mock.calls[0] ?? [];
    expect(input?.releaseId).toBe("r60");
    expect(input?.screenIds).toEqual(["s1"]);
    expect(await screen.findByText("Обновление запущено")).toBeTruthy();
  });
});
