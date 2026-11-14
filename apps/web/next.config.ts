import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Serve the original Collins static landing (public/collins/index.html)
      // at /collins — the workstation link inside it stays relative
      // (/collins/workstation.html, matched automatically from public/).
      {
        source: "/collins",
        destination: "/collins/index.html",
      },
    ];
  },
};

export default nextConfig;
