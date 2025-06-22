const { MinecraftExecutor } = require('../index.js');

const launcher = new MinecraftExecutor();

let opts ={
  root: "./Minecraft",
  javaPath: "./runtime/Java24/bin/java",
  memory: { max: "4G", min: "1G" },
  window: { width: 854, height: 480, fullscreen: false },
  version: { versionID: "1.21.6-56.0.7",type: "release" },
  user: {
    name: "Player",
    uuid: "12345678-1234-1234-1234-123456789012",
    accessToken: "your-access-token",
    type: "mojang"
  },
}
launcher.start(opts).then(() => {
  console.log("Minecraft está ejecutándose.");
}).catch((err) => {
  console.error(`Error al iniciar Minecraft: ${err}`);
});

launcher.on('debug', (message) => {
  console.log(`[DEBUG] ${message}`);
});

launcher.on('error', (err) => {
  console.error(`[ERROR] ${err}`);
});

launcher.on('data', (data) => {
  console.log(`[DATA] ${data}`);
});