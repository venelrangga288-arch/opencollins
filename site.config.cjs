module.exports = {
  apps: [
    {
      name: "dgtlz-site",
      cwd: "C:/dgtlzrebrand",
      script: "node_modules/vite/bin/vite.js",
      args: "--port 3000 --host 0.0.0.0",
      interpreter: "node",
      max_memory_restart: "300M",
    },
  ],
};
