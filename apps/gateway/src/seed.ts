/**
 * Seed: admin account + sample pricing. Run: npm run seed (from apps/gateway).
 */
import "dotenv/config";
import { prisma } from "@dgtlz/db";
import bcrypt from "bcryptjs";

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@dgtlz.my.id";
  const password = process.env.ADMIN_PASSWORD ?? "ChangeMe!2026";
  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, name: "Admin", role: "ADMIN" },
    update: { role: "ADMIN" },
    select: { id: true, email: true, role: true },
  });
  console.log(`admin ready: ${admin.email} (role=${admin.role})`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`default password: ${password} — ROTATE after first login!`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
