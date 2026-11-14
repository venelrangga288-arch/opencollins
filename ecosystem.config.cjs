module.exports = {
  apps: [
    {
      name: "dgtlz-gateway",
      cwd: "C:/dgtlz/apps/gateway",
      script: "node",
      args: "--import tsx src/index.ts",
      env: { NODE_ENV: "production" },
      max_memory_restart: "400M",
    },
    {
      name: "dgtlz-worker",
      cwd: "C:/dgtlz/apps/gateway",
      script: "node",
      args: "--import tsx src/worker.ts",
      env: { NODE_ENV: "production" },
      max_memory_restart: "300M",
    },
    {
      name: "dgtlz-web",
      cwd: "C:/dgtlz/apps/web",
      script: "node",
      // Production server: pages are prebuilt (no on-demand compile), so
      // navigation is instant and there is no dev-reload churn.
      // Rebuild after changing web code: `cd apps/web && npx next build`.
      args: "../../node_modules/next/dist/bin/next start -p 3100",
      env: { NODE_ENV: "production" },
      max_memory_restart: "500M",
    },
  ],
};
