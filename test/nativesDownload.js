const NativesDownloader = require("../download/downloaders/nativesDownloader.js");

const downloader = new NativesDownloader("Minecraft", "1.20.4");

downloader.on("progress", msg => console.log(msg));
downloader.on("error", err => console.error("ERROR:", err));
downloader.on("done", msg => {
  console.log("TERMINADO:", msg);
  process.exit(0);
});

downloader.start();
