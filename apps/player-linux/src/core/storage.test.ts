import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore, type CredentialCipher } from "./storage";

// A reversible stand-in for the OS keystore (safeStorage in production).
const fakeCipher: CredentialCipher = {
  available: () => true,
  encrypt: (plaintext) => Buffer.from("enc:" + plaintext, "utf8"),
  decrypt: (data) => data.toString("utf8").replace(/^enc:/, ""),
};

async function withStore(
  cipher: CredentialCipher | undefined,
  fn: (store: StateStore, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "tilecast-store-"));
  try {
    const store = new StateStore(dir, cipher);
    await store.init();
    await fn(store, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("StateStore secret storage", () => {
  const secret = { deviceCredential: "top-secret-token", screenId: "s1" };

  it("encrypts secrets at rest and round-trips them", async () => {
    await withStore(fakeCipher, async (store, dir) => {
      await store.writeSecretJson("credential.json", secret);
      const onDisk = await readFile(path.join(dir, "credential.json"), "utf8");
      expect(onDisk).not.toContain("top-secret-token");
      expect(onDisk).toContain('"enc"');
      expect(await store.readSecretJson("credential.json")).toEqual(secret);
    });
  });

  it("falls back to plaintext when no cipher is available", async () => {
    await withStore(undefined, async (store, dir) => {
      await store.writeSecretJson("credential.json", secret);
      const onDisk = await readFile(path.join(dir, "credential.json"), "utf8");
      expect(onDisk).toContain("top-secret-token");
      expect(await store.readSecretJson("credential.json")).toEqual(secret);
    });
  });

  it("migrates a legacy plaintext record to encrypted at rest", async () => {
    await withStore(fakeCipher, async (store, dir) => {
      await writeFile(
        path.join(dir, "credential.json"),
        JSON.stringify(secret),
        "utf8",
      );
      expect(await store.readSecretJson("credential.json")).toEqual(secret);
      const onDisk = await readFile(path.join(dir, "credential.json"), "utf8");
      expect(onDisk).not.toContain("top-secret-token");
      expect(onDisk).toContain('"enc"');
    });
  });

  it("treats an encrypted record as absent when no cipher can open it", async () => {
    await withStore(fakeCipher, async (store, dir) => {
      await store.writeSecretJson("credential.json", secret);
      const noCipher = new StateStore(dir, undefined);
      expect(await noCipher.readSecretJson("credential.json")).toBeNull();
    });
  });
});
