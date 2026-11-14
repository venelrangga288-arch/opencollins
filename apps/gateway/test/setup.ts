/**
 * Test environment defaults — the gateway refuses placeholder secrets, so the
 * suite must supply real-looking ones instead of relying on a local .env.
 */
process.env.API_KEY_HASH_SECRET ??= "test-only-hmac-secret-not-for-production-0001";
process.env.JWT_SECRET ??= "test-only-jwt-secret-not-for-production-0000001";
process.env.NODE_ENV ??= "test";
