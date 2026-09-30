/**
 * Durable player state on disk.
 *
 * Every state file is small JSON written atomically (temp file + fsync +
 * rename) so a power cut mid-write can never leave a half-written credential,
 * manifest, or escalation record. Files live under an XDG-style data
 * directory and are created with owner-only permissions because the
 * credential file is a bearer secret.
 */

import { promises as fs } from "fs";
import * as fsSync from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import { logger } from "./log";

const log = logger("storage");

/**
 * Encrypts and decrypts a bearer secret at rest. The Electron main process
 * backs this with safeStorage (DPAPI on Windows, Keychain on macOS, the
 * platform keyring on Linux); tests and unpackaged runs may pass none, in
 * which case secrets fall back to plaintext.
 */
export interface CredentialCipher {
  available(): boolean;
  encrypt(plaintext: string): Buffer;
  decrypt(data: Buffer): string;
}

interface SecretEnvelope {
  v: number;
  enc: string;
}

function isSecretEnvelope(value: unknown): value is SecretEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { enc?: unknown }).enc === "string" &&
    typeof (value as { v?: unknown }).v === "number"
  );
}

export function defaultDataDir(): string {
  if (process.platform === "win32") {
    const base =
      process.env.LOCALAPPDATA ??
      process.env.APPDATA ??
      path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Tilecast", "Player");
  }
  const xdg = process.env.XDG_DATA_HOME;
  const base =
    xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".local", "share");
  return path.join(base, "tilecast-player");
}

export class StateStore {
  constructor(
    readonly dataDir: string,
    private readonly cipher?: CredentialCipher,
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(this.dataDir, "cache"), {
      recursive: true,
      mode: 0o700,
    });
    await fs.mkdir(path.join(this.dataDir, "cache", "media"), {
      recursive: true,
      mode: 0o700,
    });
  }

  filePath(name: string): string {
    return path.join(this.dataDir, name);
  }

  mediaDir(): string {
    return path.join(this.dataDir, "cache", "media");
  }

  async readJson<T>(name: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(this.filePath(name), "utf8");
      return JSON.parse(raw) as T;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      // A corrupt state file (torn write predating this player, disk fault)
      // must not brick startup. Quarantine it and start from empty state.
      try {
        await fs.rename(this.filePath(name), this.filePath(name + ".corrupt"));
      } catch {
        // Nothing else to do; treat as missing.
      }
      return null;
    }
  }

  async writeJson(name: string, value: unknown): Promise<void> {
    const target = this.filePath(name);
    // A unique temporary name keeps two independent writers from ever
    // truncating each other's in-flight snapshot. Callers still serialize
    // logical updates, but this is an additional crash/concurrency guard for
    // recovery paths and future state files.
    const temp = `${target}.tmp-${randomUUID()}`;
    const data = JSON.stringify(value, null, 2);
    const handle = await fs.open(temp, "w", 0o600);
    try {
      await handle.writeFile(data, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, target);
    // Sync the directory so the rename itself survives power loss.
    try {
      const dir = fsSync.openSync(this.dataDir, "r");
      fsSync.fsyncSync(dir);
      fsSync.closeSync(dir);
    } catch {
      // Directory fsync is best-effort (not supported on all filesystems).
    }
  }

  /**
   * Read a secret written by writeSecretJson. Encrypted-at-rest records are
   * decrypted with the configured cipher; a legacy plaintext record is
   * returned and, when a cipher is available, transparently migrated to
   * encrypted form. An encrypted record with no cipher, or one that fails to
   * decrypt, is treated as absent so the caller re-establishes it.
   */
  async readSecretJson<T>(name: string): Promise<T | null> {
    const stored = await this.readJson<SecretEnvelope | T>(name);
    if (stored === null) {
      return null;
    }
    if (isSecretEnvelope(stored)) {
      if (!this.cipher?.available()) {
        return null;
      }
      try {
        const plaintext = this.cipher.decrypt(
          Buffer.from(stored.enc, "base64"),
        );
        return JSON.parse(plaintext) as T;
      } catch {
        try {
          await fs.rename(
            this.filePath(name),
            this.filePath(name + ".corrupt"),
          );
        } catch {
          // Treat as missing.
        }
        return null;
      }
    }
    // Legacy plaintext record: migrate it to encrypted-at-rest when possible.
    if (this.cipher?.available()) {
      await this.writeSecretJson(name, stored);
    }
    return stored as T;
  }

  /**
   * Persist a bearer secret, encrypting it at rest when a cipher is available.
   * Without one (e.g. a headless Linux box with no keyring) it falls back to
   * plaintext so the player still runs, and records that it did so.
   */
  async writeSecretJson(name: string, value: unknown): Promise<void> {
    if (this.cipher?.available()) {
      const enc = this.cipher.encrypt(JSON.stringify(value)).toString("base64");
      const envelope: SecretEnvelope = { v: 1, enc };
      await this.writeJson(name, envelope);
      return;
    }
    log.warn("storing secret without encryption at rest", { name });
    await this.writeJson(name, value);
  }

  async delete(name: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(name));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  async clearMedia(): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.mediaDir());
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    await Promise.all(
      entries.map((entry) =>
        fs.rm(path.join(this.mediaDir(), entry), { force: true }),
      ),
    );
  }
}
