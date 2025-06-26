const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const crypto = require('crypto');

const { platformName } = require('./utils/platform');
const { formatTimestamp } = require('./utils/time');
const { JVMManager } = require('./utils/jvmManager');

const UserManager = require('./utils/UserManager');
const { VersionResolver } = require('./utils/VersionResolver');
const { LibraryManager } = require('./utils/LibraryManager');
const { AssetsManager } = require('./utils/AssetsManager');
const { NativesManager } = require('./utils/NativesManager');
const { LaunchArgumentBuilder } = require('./utils/jvmArgumentBuilder');

class MinecraftExecutor extends EventEmitter {
  log = [];

  async start(opts) {
    if (!opts?.version?.versionID) throw new Error('Falta versionID');

    this.opts = {
      root: path.resolve(opts.root || './minecraft'),
      memory: opts.memory || { max: '2G', min: '1G' },
      window: opts.window || { width: 854, height: 480, fullscreen: false },
      overrides: opts.overrides || {},
      jvm: opts.jvm || [],
      mcArgs: opts.mcArgs || [],
      version: opts.version,
      authenticator: opts.authenticator,
      debug: opts.debug ?? false,
      javaPath: opts.javaPath || null,
    };

    this.opts.javaPath = await JVMManager.resolve(this.opts.javaPath, this.opts.root);

    // --- Usuario / Auth ---
    const userManager = new UserManager(this.opts.root);
    const name = this.opts.authenticator?.username;
    if (!name) throw new Error('authenticator.username es obligatorio');

    const offlineUUID = (name) =>
      crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest('hex');

    let profile;
    if (this.opts.authenticator.password) {
      profile = await userManager.loginMojang(name, this.opts.authenticator.password);
    } else {
      profile = await userManager.resolve({ name }) || {
        name,
        uuid: offlineUUID(name),
        accessToken: 'null',
        type: 'legacy',
      };
    }
    // --- Version ---
    const versionResolver = new VersionResolver(this.opts.root, this.opts.version);
    await versionResolver.ensurePresent();
    const versionData = await versionResolver.getData();
    const versionId = versionData.id || versionData.inheritsFrom;

    // Detectar versión legacy (menor a 1.6.1)
    const [major, minor, patch] = versionId.split('.').map(n => parseInt(n) || 0);
    const isLegacy =
      major < 1 ||
      (major === 1 && minor < 6) ||
      (major === 1 && minor === 6 && patch < 1);

    // --- Assets ---
    const assetsManager = new AssetsManager(this.opts.root, versionData);
    await assetsManager.ensurePresent();

    // Forzar assetsDir según legacy o no
    const assetsDir = isLegacy
      ? path.join(this.opts.root, 'assets', 'virtual', 'legacy')
      : assetsManager.getAssetsDir();

    // --- Resources (solo para versiones legacy) ---
    if (isLegacy) {
      const resourcesPath = path.join(this.opts.root, 'resources');
      try {
        await fs.access(resourcesPath);
        // Ya existe
      } catch {
        if (this.opts.debug)
          console.log('[LegacyFix] Creando carpeta resources/ vacía para versión legacy');
        await fs.mkdir(resourcesPath, { recursive: true });
      }
    }

    // --- Natives ---
    const nativesManager = new NativesManager(this.opts.root, versionData);
    await nativesManager.ensureDir();
    const nativesDir = nativesManager.getNativesDir();

    // Extra natives folders para versiones específicas
    const extraNativeDirs = [];
    try {
      const nativesRoot = path.join(this.opts.root, 'natives');
      const list = await fs.readdir(nativesRoot);
      for (const name of list) {
        const full = path.join(nativesRoot, name);
        if (name.startsWith(versionId) && fsSync.statSync(full).isDirectory()) {
          extraNativeDirs.push(full);
        }
      }
    } catch {}

    const javaLibPath = [nativesDir, ...extraNativeDirs].join(path.delimiter);

    // --- Librerías ---
    const libManager = new LibraryManager(this.opts.root, versionData, platformName(), {
      debug: this.opts.debug,
    });
    const classPath = await libManager.buildClasspath();

    // --- Argumentos JVM / Game ---
    const argBuilder = new LaunchArgumentBuilder({
      javaPath: this.opts.javaPath,
      root: this.opts.root,
      memory: this.opts.memory,
      authorization: {
        access_token: profile.accessToken,
        name: profile.name,
        uuid: profile.uuid,
        type: profile.type,
        user_properties: profile.userProperties || '{}',
        meta: profile.meta || {},
        client_token: profile.clientToken || '',
      },
      version: {
        number: versionId,
        type: versionData.type,
        custom: versionData.custom || null,
      },
      versionFile: versionData,
      customFile: opts.customFile || {},
      libs: classPath,
      nativePath: javaLibPath,
      extraJvm: this.opts.jvm,
      extraMcArgs: this.opts.mcArgs,
      window: this.opts.window,
      overrides: {
        ...this.opts.overrides,
        assetsDir,
        versionName: versionId,
        assetIndex: versionData.assets || versionData.assetIndex?.id || versionId,
      },
    });

    const argv = argBuilder.build();

    if (this.opts.debug) {
      console.log('> JAVA PATH:', this.opts.javaPath);
      console.log('> ARGUMENTOS:', argv.slice(1).join(' '));
      console.log('> AssetsDir:', assetsDir);
    }

    return this.#launch(argv);
  }

  #launch(argv) {
    const proc = spawn(argv[0], argv.slice(1), {
      cwd: this.opts.overrides.gameDirectory || this.opts.root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (d) => this.#push('data', d));
    proc.stderr.on('data', (d) => this.#push('error', d));

    proc.on('close', async (code) => {
      if (code !== 0 && this.log.length) await this.#writeCrash(code);
      this.emit('close', code);
      this.log = [];
    });

    proc.on('error', (err) => {
      this.emit('error', err.message);
      this.emit('close', 1);
    });

    return proc;
  }

  #push(chan, buf) {
    const msg = buf.toString();
    this.emit(chan, msg);
    this.log.push(`${formatTimestamp()} ${chan === 'error' ? '[ERR]' : ''} ${msg}`);
  }

  async #writeCrash(code) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logDir = path.join(this.opts.root, 'logs');
    const file = path.join(logDir, `mc_crash_${ts}_code${code}.log`);
    try {
      await fs.mkdir(logDir, { recursive: true });
      await fs.writeFile(file, this.log.join(''));
    } catch (err) {
      console.error('Error al guardar el crash log:', err.message);
    }
  }
}

module.exports = MinecraftExecutor;
