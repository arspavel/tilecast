export type ScreenPlatformFamily = "android" | "linux" | "windows";

// Screens report a specific platform string ("fire-tv", "android-tv",
// "linux", "windows", …). Windows is intentionally a separate family so an
// APK deployment is never offered for a Windows player. Windows releases are
// installed locally until the server gains a signed Windows update channel.
export const screenPlatformFamily = (platform: string): ScreenPlatformFamily =>
  /windows|win32/i.test(platform)
    ? "windows"
    : platform === "linux"
      ? "linux"
      : "android";

export const isAndroidScreen = (platform: string) =>
  /android|fire-tv|google-tv/i.test(platform);
