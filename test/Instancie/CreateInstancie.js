const { MinecraftDownloader, Mojang } = require('../../dist/index');

(async () => {
  const CreateInstancie = new MinecraftDownloader();

  // Escuchar eventos
  CreateInstancie.on("progress", ({ current, stepPercent, totalPercent }) => {
    console.log(`[PROGRESS] ${current} - Paso: ${stepPercent}% - Total: ${totalPercent}%`);
  });

  CreateInstancie.on("info", (...args) => console.log("ℹ️ [INFO]", ...args));
  CreateInstancie.on("warn", (...args) => console.warn("⚠️ [WARN]", ...args));
  CreateInstancie.on("error", (...args) => console.error("❌ [ERROR]", ...args));
  CreateInstancie.on("step-done", (step) => console.log(`✅ Paso completado: ${step}`));
  CreateInstancie.on("done", () => console.log("🎉 Descarga completada!"));

  const user = await Mojang.login("Stepnicka012");

  const Opts = {
    root: "./.minecraft",
    version: "1.12.2",
    installJava: false,
    variantJava: "release",
    concurrency: 2,

    manifest: {
      name: "Mi Instancia",
      description: ["", ""],
      icon: ""
    },

    userConfig: {
      authenticator: user
    },

    gameConfig: {
      resolution: { width: "1280", height: "720", fullscreen: false },
      memory: { min: "512M", max: "4G" },
      javaArgs: [],
      gameArgs: []
    }
  };

  await CreateInstancie.createInstancie(Opts);

  console.log("🎉 Instancia lista para usar!");
})();
