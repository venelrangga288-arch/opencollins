module.exports = {
  apps: [
    {
      name: "lensa-insignia",
      cwd: "C:/Users/JayamAirways/Downloads/lin-main/lin-main",
      script: "server.ts",
      interpreter: "node",
      node_args: "--import tsx/esm",
      env: { NODE_ENV: "production", PORT: "3003" },
      max_memory_restart: "400M",
    },
  ],
};
