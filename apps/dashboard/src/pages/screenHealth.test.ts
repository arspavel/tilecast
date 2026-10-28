import { describe, expect, it } from "vitest";
import type { Screen } from "../api/types";
import { screenHealth } from "./screenHealth";

const screen = (fields: Partial<Screen>) =>
  ({ status: "online", nowPlayingName: "Лобби", ...fields }) as Screen;

describe("screenHealth", () => {
  it("treats a playing online screen as working", () => {
    expect(screenHealth(screen({ playbackState: "playing" }))).toBe("working");
  });

  it("reports playback errors before the connection state", () => {
    expect(screenHealth(screen({ lastPlaybackError: "decoder" }))).toBe(
      "problem",
    );
  });

  it("flags an online screen that shows nothing", () => {
    expect(
      screenHealth(
        screen({ nowPlayingName: undefined, playbackState: "idle" }),
      ),
    ).toBe("problem");
  });

  it("counts Show now content as playing", () => {
    expect(
      screenHealth(
        screen({ nowPlayingName: undefined, playbackState: "idle" }),
        true,
      ),
    ).toBe("working");
  });

  it("groups stale and offline screens as unreachable", () => {
    expect(screenHealth(screen({ status: "stale" }))).toBe("offline");
    expect(screenHealth(screen({ status: "offline" }))).toBe("offline");
  });

  it("keeps disabled and revoked screens out of the problem count", () => {
    expect(
      screenHealth(screen({ status: "revoked", lastPlaybackError: "x" })),
    ).toBe("disabled");
  });
});
