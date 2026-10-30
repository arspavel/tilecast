import { afterEach, describe, expect, it, vi } from "vitest";
import { randomId } from "./randomId";

const realCrypto = globalThis.crypto;
const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("works over plain HTTP, where crypto.randomUUID is missing", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => realCrypto.getRandomValues(array),
    });
    const first = randomId();
    expect(first).toMatch(uuidV4);
    expect(randomId()).not.toBe(first);
  });

  it("uses crypto.randomUUID when the browser has it", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-2222-4333-8444-555555555555",
      getRandomValues: () => new Uint8Array(16),
    });
    expect(randomId()).toBe("11111111-2222-4333-8444-555555555555");
  });
});
