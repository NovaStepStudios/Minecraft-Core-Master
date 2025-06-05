const { Client, Authenticator } = require("minecraft-launcher-core");

const launcher = new Client();

let opts = {
  authorization: Authenticator.getAuth("NovaStep Studios"),
  root: "./minecraft",
  version: {
    number: "1.21.5",
    type: "release",
  },
  memory: {
    max: "6G",
    min: "2G",
  },
};
launcher.launch(opts);

launcher.on("debug", (e) => console.log(e));
launcher.on("data", (e) => console.log(e));