const JVMDownloader = require("../download/downloaders/jvmDownloader.js");

const downloader = new JVMDownloader(".steplauncher","Java24");

downloader.on("progress", msg => console.log(msg));
downloader.on("error", err => console.error("ERROR:", err));
downloader.on("done", msg => {
  console.log("TERMINADO:", msg);
  process.exit(0);
});

downloader.download();
