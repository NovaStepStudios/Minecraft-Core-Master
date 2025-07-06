const { MinecraftExecutor } = require("../index");

(async () => {
  const executor = new MinecraftExecutor();

  await executor.start({
    root: "./Minecraft",
    javaPath: "java",
    memory: { max: "6G", min: "1G" },
    version: { versionID: "1.21.7", type: "release" },
    authenticator: {
      username: "Stepnicka012",
      password: "Santiago012"
    },
    debug: true,
  });

  executor.on("data", (data) => console.log("[MC STDOUT]", data));
  executor.on("error", (err) => console.error("[MC STDERR]", err));
  executor.on("close", (code) => console.log("Minecraft cerrado con código", code));
})();