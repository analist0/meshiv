// pm2: מריץ את משיב ברקע, מפעיל מחדש אם נפל, ועולה עם המחשב (אחרי pm2 startup)
module.exports = {
  apps: [
    {
      name: "meshiv",
      script: "src/server.js",
      cwd: __dirname,
      node_args: "--env-file=.env",
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: "1500M",
      time: true,
    },
  ],
};
