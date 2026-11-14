/**
 * Test environment defaults.
 *
 * The core package validates that API_KEY_HASH_SECRET is a real secret
 * (it refuses placeholders). Tests must provide one so they never depend on
 * a developer's local .env being present.
 */
process.env.API_KEY_HASH_SECRET ??= "test-only-hmac-secret-not-for-production-0001";
process.env.JWT_SECRET ??= "test-only-jwt-secret-not-for-production-0000001";
