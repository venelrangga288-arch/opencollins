import { describe, it, expect } from "vitest";
import { extractBearerKey, generateApiKey, hashApiKey, isDgtlzKey, verifyApiKey } from "../src/api-keys.js";

const SECRET = "test-secret-that-is-not-change-me";

describe("api key generation", () => {
  it("creates keys with dgtlz_live_ prefix and 32-char body", () => {
    const { key, prefix } = generateApiKey();
    expect(key.startsWith("dgtlz_live_")).toBe(true);
    expect(key.length).toBe("dgtlz_live_".length + 32);
    expect(isDgtlzKey(key)).toBe(true);
    expect(prefix.length).toBe("dgtlz_live_".length + 8);
    expect(prefix).toBe(key.slice(0, prefix.length));
  });

  it("generates unique keys", () => {
    const a = generateApiKey(SECRET).key;
    const b = generateApiKey(SECRET).key;
    expect(a).not.toBe(b);
  });
});

describe("api key hashing", () => {
  it("hashes deterministically with HMAC", () => {
    const { key } = generateApiKey(SECRET);
    expect(hashApiKey(key, SECRET)).toBe(hashApiKey(key, SECRET));
    expect(hashApiKey(key, SECRET)).not.toBe(key);
  });

  it("refuses placeholder secrets", () => {
    const { key } = generateApiKey(SECRET);
    expect(() => hashApiKey(key, "change-me-32-bytes-hex")).toThrow();
    expect(() => hashApiKey(key, "")).toThrow();
  });
});

describe("api key verification", () => {
  it("verifies the correct key", () => {
    const { key, hash } = generateApiKey(SECRET);
    expect(verifyApiKey(key, hash, SECRET)).toBe(true);
  });

  it("rejects wrong keys", () => {
    const { hash } = generateApiKey(SECRET);
    const other = generateApiKey(SECRET).key;
    expect(verifyApiKey(other, hash, SECRET)).toBe(false);
  });

  it("rejects tampered keys of same length", () => {
    const { key, hash } = generateApiKey(SECRET);
    const tampered = key.slice(0, -1) + (key.endsWith("A") ? "B" : "A");
    expect(verifyApiKey(tampered, hash, SECRET)).toBe(false);
  });
});

describe("extractBearerKey", () => {
  it("parses Bearer tokens", () => {
    expect(extractBearerKey("Bearer dgtlz_live_abc")).toBe("dgtlz_live_abc");
    expect(extractBearerKey("bearer dgtlz_live_abc")).toBe("dgtlz_live_abc");
  });
  it("returns null for missing/malformed headers", () => {
    expect(extractBearerKey(undefined)).toBeNull();
    expect(extractBearerKey("")).toBeNull();
    expect(extractBearerKey("Basic xyz")).toBeNull();
  });
});
