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
      args: "--import tsx ../../node_modules/next/dist/bin/next dev -p 3100",
      env: { NODE_ENV: "development" },
      max_memory_restart: "500M",
    },
  ],
};
