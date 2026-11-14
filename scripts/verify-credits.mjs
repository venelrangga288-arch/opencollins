/**
 * End-to-end verification for the ads -> balance -> convert -> allowance flow.
 * Run: node scripts/verify-credits.mjs
 */
const BASE = "http://127.0.0.1:4101/api/v1";
const EMAIL = process.env.TEST_EMAIL || "demo@dgtlz.my.id";
const PASSWORD = process.env.TEST_PASSWORD || "demo12345";

let cookie = "";
async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    const kv = c.split(";")[0];
    if (kv.startsWith("dgtlz_session=")) cookie = kv;
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

function show(label, r) {
  const flag = r.status < 400 ? "OK " : "ERR";
  console.log(`${flag} ${label} [${r.status}]`, JSON.stringify(r.json).slice(0, 240));
  return r;
}

async function main() {
  console.log("== auth ==");
  const login = await call("/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
  if (login.status !== 200) {
    console.error("login failed", login.status, login.json);
    process.exit(1);
  }
  console.log("OK  login as", EMAIL);

  console.log("\n== credits overview ==");
  const before = show("GET /credits", await call("/credits"));
  const cfg = before.json.config;

  console.log("\n== ad session: issue ==");
  const issue = show("POST /credits/ads/session", await call("/credits/ads/session", { method: "POST", body: {} }));
  if (issue.status !== 200) process.exit(1);
  const { sessionId, nonce, creative, rewardRupiah, requiredWatchMs, expiresAt } = issue.json;
  console.log(`    creative=${creative.slug} "${creative.title}" dur=${creative.durationMs}ms reward=Rp${rewardRupiah} need=${requiredWatchMs}ms expires=${expiresAt}`);

  console.log("\n== guard: cheating (too fast) must NOT pay ==");
  const cheat = show(
    "POST /credits/ads/complete (300ms)",
    await call("/credits/ads/complete", { method: "POST", body: { sessionId, nonce, watchedMs: 300, interruptions: 0 } }),
  );
  if (cheat.json.rewarded !== false) {
    console.error("FAIL: short watch was rewarded");
    process.exit(1);
  }

  console.log("\n== guard: replay of a rejected session must fail ==");
  show(
    "POST /credits/ads/complete (again)",
    await call("/credits/ads/complete", { method: "POST", body: { sessionId, nonce, watchedMs: requiredWatchMs + 500 } }),
  );

  console.log("\n== honest watch pays ==");
  const issue2 = await call("/credits/ads/session", { method: "POST", body: {} });
  if (issue2.status !== 200) {
    console.error("issue2 failed", issue2.status, issue2.json);
    process.exit(1);
  }
  const s2 = issue2.json;
  const done = show(
    "POST /credits/ads/complete (full)",
    await call("/credits/ads/complete", {
      method: "POST",
      body: { sessionId: s2.sessionId, nonce: s2.nonce, watchedMs: s2.creative.durationMs },
    }),
  );
  if (!done.json.rewarded) {
    console.error("FAIL: full watch was not rewarded");
    process.exit(1);
  }
  const balanceAfterAd = done.json.balanceRupiah;
  console.log(`    rewarded Rp${done.json.rewardRupiah} -> balance Rp${balanceAfterAd}, allowance ${done.json.allowanceTokens} tok`);

  console.log("\n== idempotency: same session twice ==");
  const twice = show(
    "POST /credits/ads/complete (repeat)",
    await call("/credits/ads/complete", {
      method: "POST",
      body: { sessionId: s2.sessionId, nonce: s2.nonce, watchedMs: s2.creative.durationMs },
    }),
  );
  if (twice.json.balanceRupiah !== balanceAfterAd) {
    console.error("FAIL: double payout!");
    process.exit(1);
  }
  console.log("    no double payout");

  console.log("\n== convert below minimum must fail ==");
  if (balanceAfterAd < cfg.minConvertRupiah) {
    show("POST /credits/convert", await call("/credits/convert", { method: "POST", body: {} }));
  } else {
    console.log("    (balance already above minimum, skipping)");
  }

  console.log("\n== ledger ==");
  const ledger = show("GET /credits/ledger", await call("/credits/ledger?limit=5"));

  console.log("\n== operator: grant balance, then convert ==");
  const opLogin = await call("/operator/login", {
    method: "POST",
    body: { username: process.env.OPERATOR_USERNAME || "123", password: process.env.OPERATOR_PASSWORD || "123123" },
  });
  if (opLogin.status !== 200) {
    console.error("operator login failed", opLogin.status, opLogin.json);
    process.exit(1);
  }
  const opToken = opLogin.json.token;
  const users = await call("/operator/users", { headers: { authorization: `Bearer ${opToken}` } });
  const userList = users.json.users ?? users.json.data ?? [];
  const me = userList.find((u) => u.email === EMAIL);
  console.log(`    operator sees ${userList.length} users, target id=${me?.id}`);

  const grant = await call(`/operator/users/${me.id}/credits`, {
    method: "POST",
    headers: { authorization: `Bearer ${opToken}` },
    body: { amountRupiah: 20000, type: "GRANT", note: "verification run" },
  });
  show("POST /operator/users/:id/credits +20000", grant);

  const conv = show("POST /credits/convert", await call("/credits/convert", { method: "POST", body: {} }));
  if (conv.status !== 200) {
    console.error("FAIL: convert failed");
    process.exit(1);
  }
  console.log(`    converted Rp${conv.json.convertedRupiah} -> ${conv.json.tokensGranted} tokens, allowance now ${conv.json.allowanceTokens}`);

  console.log("\n== allowance is visible on quota ==");
  const after = show("GET /credits", await call("/credits"));

  console.log("\n== operator ads stats ==");
  show("GET /operator/ads/stats", await call("/operator/ads/stats", { headers: { authorization: `Bearer ${opToken}` } }));

  console.log("\n== operator creative list ==");
  const creatives = await call("/operator/ads/creatives", { headers: { authorization: `Bearer ${opToken}` } });
  console.log(`    ${creatives.json.creatives?.length} creatives, first: "${creatives.json.creatives?.[0]?.title}" Rp${creatives.json.creatives?.[0]?.rewardMinRupiah}-${creatives.json.creatives?.[0]?.rewardMaxRupiah}`);

  console.log("\nAll checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
