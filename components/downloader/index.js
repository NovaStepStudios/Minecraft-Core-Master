"use strict";
const EventEmitter = require('events');
const ForgeInstaller = require('./loaders/forge/forge');
const FabricInstaller = require('./loaders/fabric/fabric');
const LegacyFabricInstaller = require('./loaders/legacyfabric/legacyfabric');
const QuiltInstaller = require('./loaders/quilt/quilt');
const NeoForgeInstaller = require('./loaders/neoforge/neoforge');
const https = require('https');

class MinecraftLoaders {
  constructor() {}

  createInstaller(InstallerClass, options) {
    const emitter = new EventEmitter();
    const installer = new InstallerClass(options.root, options.version);

    if (installer.on) {
      installer.on('data', (msg) => emitter.emit('data', msg));
      installer.on('error', (err) => emitter.emit('error', err));
    }

    installer.install()
      .then(() => emitter.emit('done'))
      .catch((err) => emitter.emit('error', err));

    return emitter;
  }

  forge(options) {
    return this.createInstaller(ForgeInstaller, options);
  }

  fabric(options) {
    return this.createInstaller(FabricInstaller, options);
  }

  legacyfabric(options) {
    return this.createInstaller(LegacyFabricInstaller, options);
  }

  quilt(options) {
    return this.createInstaller(QuiltInstaller, options);
  }

  neoforge(options) {
    return this.createInstaller(NeoForgeInstaller, options);
  }

  getVersions(options) {
    const emitter = new EventEmitter();
    const { type } = options;

    const versionUrls = {
      forge: 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
      fabric: 'https://meta.fabricmc.net/v2/versions/game',
      legacyfabric: 'https://meta.legacyfabric.net/v2/versions/game',
      quilt: 'https://meta.quiltmc.org/v3/versions/game',
      neoforge: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/'
    };

    const url = versionUrls[type];
    if (!url) {
      process.nextTick(() => emitter.emit('error', new Error(`Unknown loader type: ${type}`)));
      return emitter;
    }

    https.get(url, (res) => {
      let rawData = '';
      res.on('data', (chunk) => rawData += chunk);
      res.on('end', () => {
        try {
          if (type === 'neoforge') {
            emitter.emit('data', rawData);
          } else {
            emitter.emit('data', JSON.parse(rawData));
          }
          emitter.emit('done');
        } catch (err) {
          emitter.emit('error', err);
        }
      });
    }).on('error', (err) => emitter.emit('error', err));

    return emitter;
  }
}

module.exports = MinecraftLoaders;
