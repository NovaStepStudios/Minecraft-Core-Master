const JavaInstaller = require("../components/downloader/Minecraft/Java-Installer");

const installer = new JavaInstaller("./.minecraft", "Java17", "./java-urls.json");

installer.on("progress", ({ percent }) => {
  console.log(`⏬ Descargando... ${percent}%`);
});

installer.on("done", dir => {
  console.log(`✅ Java instalado en: ${dir}`);
});

installer.on("error", err => {
  console.error("❌ Error:", err);
});

installer.start();