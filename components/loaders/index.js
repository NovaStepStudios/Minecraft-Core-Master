const EventEmitter = require('events');
const ForgeInstaller = require('./loaders/forge/forge');
const FabricInstaller = require('./loaders/fabric/fabric');
const LegacyFabricInstaller = require('./loaders/legacyfabric/legacyfabric');
const QuiltInstaller = require('./loaders/quilt/quilt');

function createInstaller(InstallerClass, options) {
    const emitter = new EventEmitter();
    const installer = new InstallerClass(options.root, options.version);

    // Reenvía eventos si el installer los tiene (opcional)
    if (installer.on) {
        installer.on('data', (msg) => emitter.emit('data', msg));
        installer.on('error', (err) => emitter.emit('error', err));
    }

    installer.install()
        .then(() => emitter.emit('done'))
        .catch((err) => emitter.emit('error', err));

    return emitter;
}

module.exports = {
    forge(options) {
        return createInstaller(ForgeInstaller, options);
    },

    fabric(options) {
        return createInstaller(FabricInstaller, options);
    },

    legacyfabric(options) {
        return createInstaller(LegacyFabricInstaller, options);
    },

    quilt(options) {
        return createInstaller(QuiltInstaller, options);
    },

    getVersions(options) {
        const emitter = new EventEmitter();
        const { type } = options;

        const versionUrls = {
            forge: 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
            fabric: 'https://meta.fabricmc.net/v2/versions/game',
            legacyfabric: 'https://meta.legacyfabric.net/v2/versions/game',
            quilt: 'https://meta.quiltmc.org/v3/versions/game',
        };

        const url = versionUrls[type];
        if (!url) {
            process.nextTick(() => emitter.emit('error', new Error(`Unknown loader type: ${type}`)));
            return emitter;
        }

        // Node.js estándar, sin fetch nativo (usa https)
        const https = require('https');
        https.get(url, (res) => {
            let rawData = '';
            res.on('data', (chunk) => rawData += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(rawData);
                    emitter.emit('data', parsed);
                    emitter.emit('done');
                } catch (err) {
                    emitter.emit('error', err);
                }
            });
        }).on('error', (err) => emitter.emit('error', err));

        return emitter;
    }
};
