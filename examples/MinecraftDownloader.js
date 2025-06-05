const {MinecraftDownloader} = require('./../components/DownloadMc');

const Downloading = new MinecraftDownloader("./Minecraft", true, "release");


Downloading.download();