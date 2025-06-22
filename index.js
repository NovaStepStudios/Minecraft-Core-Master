const MinecraftDownloader = require("./components/download/index.js");
const CustomInstaller = require("./components/download/loaders/index.js");
const MinecraftExecutor = require("./components/launch/index.js");
module.exports = {
  MinecraftDownloader,
  MinecraftExecutor,
  CustomInstaller
};