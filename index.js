<<<<<<< HEAD
const MinecraftDownloader = require("./components/DownloadMc");
const MinecraftEjecuting = require("./components/LaunchMc");
module.exports = {
  MinecraftDownloader,
  MinecraftEjecuting
=======
const MinecraftDownloader = require("./components/download/index.js");
const CustomInstaller = require("./components/download/loaders/index.js");
const MinecraftExecutor = require("./components/launch/index.js");
module.exports = {
  MinecraftDownloader,
  MinecraftExecutor,
  CustomInstaller
>>>>>>> d78a581 (Update All Project)
};