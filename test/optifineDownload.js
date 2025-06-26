const optifine = require("../download/loaders/optifine/optifine.js");

(async () => {
  try {
    // instalar última estable para 1.20.1 en ./MinecraftAA
    await optifine.downloadAndInstall("1.20.1", "./MinecraftAA");
  } catch (e) {
    console.error("❌", e.message);
  }
})();
