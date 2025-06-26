const { MinecraftExecutor } = require("../index");

(async () => {
  const executor = new MinecraftExecutor();

  await executor.start({
    root: "./Minecraft",
    javaPath: "/home/stepnickasantiago/Escritorio/Projects/Minecraft-Core-Master/Minecraft/runtime/Java24/bin/java",
    memory: { max: "6G", min: "1G" },
    window: { width: 854, height: 480, fullscreen: false },
    version: { versionID: "1.21.6", type: "release" },
    authenticator: {
      username: "Stepnicka012",
      password: "StepnickaSantiago012"
    },
    //jvm: [],               // Opcional, flags JVM extras
    // mcArgs: [],         // Opcional, argumentos Minecraft extras
    debug: false,          // Opcional, activa logs detallados
  });

  executor.on("data", (data) => console.log("[MC STDOUT]", data));
  executor.on("error", (err) => console.error("[MC STDERR]", err));
  executor.on("close", (code) => console.log("Minecraft cerrado con código", code));
})();