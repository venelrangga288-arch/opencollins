/**
 * Seeds the 15 ad creatives from the downloaded manifest, plus the singleton
 * CreditConfig row.
 *
 * Idempotent: re-running updates metadata (title/tagline/urls) but never
 * touches operator-tuned reward ranges or the active flag.
 *
 * Run: npx tsx apps/gateway/src/seed-ads.ts
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@dgtlz/db";

interface ManifestEntry {
  slug: string;
  title: string;
  brand: string;
  tagline: string;
  accent: string;
  videoUrl: string;
  posterUrl: string;
  durationMs: number;
  sourceUrl: string;
  license: string;
}

const MANIFEST = "apps/web/public/ads/manifest.json";

async function main() {
  const prisma = new PrismaClient();
  try {
    const entries: ManifestEntry[] = JSON.parse(readFileSync(MANIFEST, "utf8"));
    let created = 0;
    let updated = 0;

    for (const entry of entries) {
      const before = await prisma.adCreative.findUnique({ where: { slug: entry.slug }, select: { id: true } });
      await prisma.adCreative.upsert({
        where: { slug: entry.slug },
        create: {
          slug: entry.slug,
          title: entry.title,
          brand: entry.brand,
          tagline: entry.tagline,
          videoUrl: entry.videoUrl,
          posterUrl: entry.posterUrl,
          accent: entry.accent,
          durationMs: entry.durationMs,
          source: "HOUSE",
          sourceUrl: entry.sourceUrl,
          license: entry.license,
          rewardMinRupiah: 700,
          rewardMaxRupiah: 5000,
          active: true,
        },
        update: {
          title: entry.title,
          brand: entry.brand,
          tagline: entry.tagline,
          videoUrl: entry.videoUrl,
          posterUrl: entry.posterUrl,
          accent: entry.accent,
          durationMs: entry.durationMs,
          sourceUrl: entry.sourceUrl,
          license: entry.license,
        },
      });
      if (before) updated++;
      else created++;
    }

    await prisma.creditConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: {},
    });

    console.log(`ad creatives: ${created} created, ${updated} updated (total ${entries.length})`);
    console.log("credit config: singleton ready");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
