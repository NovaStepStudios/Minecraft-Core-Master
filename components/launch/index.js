const EventEmitter = require('events');
const path = require('path');
const { spawn } = require('child_process');

const VersionHandler = require('./handlers/Version');
const Authenticator = require('./authenticator/index');
const NativesHandler = require('./handlers/Natives');
const ClassPathHandler = require('./handlers/ClassPath');
const ArgumentsHandler = require('./handlers/Arguments');
const AssetsHandler = require('./handlers/Assets');
const LibrariesHandler = require('./handlers/Libraries');

class MinecraftExecutor extends EventEmitter {
  constructor() {
    super();
    this.childProcess = null;
  }

  async start(options = {}) {
    const opts = this._normalizeOptions(options);
    const debug = (msg) => {
      if (opts.debug) {
        this.emit('debug', msg);
        console.debug('[DEBUG]', msg);
      }
    };

    try {
      debug('Iniciando autenticación...');

      const provider = opts.client.provider || (opts.client.password ? 'mojang' : 'legacy');

      const auth = await Authenticator.login({
        ...opts.client,
        provider,
      }, {
        demo: opts.demo,
        root: opts.root,
        versionId: opts.version.versionID,
        gameDir: opts.gameDir || opts.root,
      });

      debug(`Autenticado como ${auth.name}`);
      if (opts.client.skinUrl) debug(`Skin URL personalizada: ${opts.client.skinUrl}`);
      if (opts.client.capeUrl) debug(`Cape URL personalizada: ${opts.client.capeUrl}`);

      debug(`Cargando versión ${opts.version.versionID}...`);
      const versionData = await VersionHandler.load(opts.root, opts.version.versionID);

      const AUTHLIB_NAME = 'com.mojang:authlib:1.5.25';
      if (!(versionData.libraries || []).some(lib => lib.name === AUTHLIB_NAME)) {
        debug('Agregando authlib a mano');
        versionData.libraries.push({
          name: AUTHLIB_NAME,
          url: 'https://libraries.minecraft.net/',
          serverreq: true,
          clientreq: true,
        });
      }

      debug('Validando librerías...');
      await LibrariesHandler.validate(opts.root, versionData);

      debug('Configurando assets...');
      await AssetsHandler.setup(opts.root, versionData);

      debug('Preparando natives...');
      await NativesHandler.setup(opts.root, versionData.id);

      debug('Construyendo classpath...');
      const classPath = await ClassPathHandler.build(opts.root, versionData);

      debug('Preparando argumentos de ejecución...');
      const args = ArgumentsHandler.build({
        opts,
        version: versionData,
        auth,
        classPath,
      });

      debug(`Ejecutando Java: ${opts.javaPath} ${args.join(' ')}`);

      this.childProcess = spawn(opts.javaPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false,
      });

      let stdout = '', stderr = '';

      this.childProcess.stdout.on('data', (data) => {
        const str = data.toString();
        stdout += str;
        this.emit('data', str);
        if (opts.debug) process.stdout.write(`[JAVA STDOUT] ${str}`);
      });

      this.childProcess.stderr.on('data', (data) => {
        const str = data.toString();
        stderr += str;
        this.emit('data', str);
        if (opts.debug) process.stderr.write(`[JAVA STDERR] ${str}`);
      });

      this.childProcess.on('error', err => {
        debug('Error al ejecutar Java');
        this.emit('error', err);
      });

      this.childProcess.on('close', code => {
        debug(`Java cerrado con código ${code}`);
        if (code !== 0) {
          const output = (stderr + stdout).trim() || '(sin salida)';
          this.emit('error', new Error(`Java finalizó con código ${code}\nSalida:\n${output}`));
        } else {
          this.emit('close', code);
        }
      });

      this.emit('started', { auth, opts, versionData });

    } catch (err) {
      this.emit('error', err);
    }
  }

  stop() {
    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = null;
      this.emit('debug', 'Proceso Java detenido');
    }
  }

  _normalizeOptions(userOpts) {
    return {
      root: userOpts.root || './',
      javaPath: userOpts.javaPath || 'java',
      memory: {
        max: userOpts.memory?.max || '2G',
        min: userOpts.memory?.min || '512M',
      },
      version: {
        versionID: userOpts.version?.versionID || '',
        type: userOpts.version?.type || 'release',
      },
      window: {
        width: userOpts.window?.width || 854,
        height: userOpts.window?.height || 480,
        fullscreen: userOpts.window?.fullscreen ?? false,
      },
      gameDir: userOpts.root,
      client: {
        username: userOpts.client?.username || 'Player',
        password: userOpts.client?.password || '',
        skinUrl: userOpts.client?.skinUrl || '',
        capeUrl: userOpts.client?.capeUrl || '',
        provider: userOpts.client?.provider || 'legacy',
        email: userOpts.client?.email || null,
      },
      jvmFlags: Array.isArray(userOpts.jvmFlags) ? userOpts.jvmFlags : [],
      mcFlags: Array.isArray(userOpts.mcFlags) ? userOpts.mcFlags : [],
      demo: userOpts.demo ?? false,
      debug: userOpts.debug ?? false,
    };
  }
}

module.exports = MinecraftExecutor;
