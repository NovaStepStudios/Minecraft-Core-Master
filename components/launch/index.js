const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs/promises');
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
    if (this.opts.debug) console.log("[DEBUG] JVMManager resolvió javaPath a:", this.opts.javaPath);

    // --- Autenticación ---
    const userManager = new UserManager(this.opts.root);
    const name = this.opts.authenticator?.username;
    const provider = this.opts.authenticator?.provider || 'legacy';
    const password = this.opts.authenticator?.password || null;
    const email = this.opts.authenticator?.email || null;

    if (!name) throw new Error('[✖] El campo authenticator.username es obligatorio');
    if (provider === 'microsoft' && !email) throw new Error('[✖] El campo authenticator.email es obligatorio para Microsoft');

    const offlineUUID = name => crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest('hex');
    let profile;

    try {
      profile = await userManager.resolve({ name });
      if (!(await userManager.validateAccessToken(profile))) {
        if (!password) {
          console.warn('[Auth] Token inválido, usando modo offline.');
          profile = { name, uuid: offlineUUID(name), accessToken: 'null', type: 'legacy' };
        } else {
          console.log(`[Auth] Reintentando login (${provider})...`);
          profile = await userManager.login(name, password, provider, email);
        }
      }
    } catch (err) {
      console.warn(`[Auth] Error durante la autenticación: ${err.message}`);
      profile = { name, uuid: offlineUUID(name), accessToken: 'null', type: 'legacy' };
    }

    // --- Versión ---
    const versionResolver = new VersionResolver(this.opts.root, this.opts.version);
    await versionResolver.ensurePresent();
    const versionData = await versionResolver.getData();
    const versionId = versionData.id || versionData.inheritsFrom;

    if (!versionData.mainClass) {
      // Loguea todo para debug si no hay mainClass
      console.error("[ERROR] mainClass NO definido en versionData. Keys:", Object.keys(versionData).join(", "));
      throw new Error(`mainClass no definido para la versión ${versionId}`);
    }

    const [major, minor, patch] = versionId.split('.').map(n => parseInt(n) || 0);
    const isLegacy = major < 1 || (major === 1 && minor < 6) || (major === 1 && minor === 6 && patch < 1);

    const assetsManager = new AssetsManager(this.opts.root, versionData);
    await assetsManager.ensurePresent();

    const assetsDir = isLegacy
      ? path.join(this.opts.root, 'assets', 'virtual', 'legacy')
      : assetsManager.getAssetsDir();

    if (isLegacy) {
      const resourcesPath = path.join(this.opts.root, 'resources');
      try { await fs.access(resourcesPath); } catch {
        if (this.opts.debug) console.log('[LegacyFix] Creando carpeta resources/ vacía');
        await fs.mkdir(resourcesPath, { recursive: true });
      }
    }

    const { classpath, nativePath } = await this.prepareEnvironment({
      root: this.opts.root,
      versionData,
      debug: this.opts.debug,
    });

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
      libs: classpath,
      nativePath,
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

    const argv = await argBuilder.build();

    if (this.opts.debug) {
      console.log('> JAVA PATH:', this.opts.javaPath);
      console.log('> ARGUMENTOS:', argv.slice(1).join(' '));
      console.log('> AssetsDir:', assetsDir);
    }

    return this.#launch(argv);
  }
  async prepareEnvironment({ root, versionData, debug }) {
    const platform = platformName();
    const libManager = new LibraryManager(root, versionData, platform, { debug });

    // Construir classpath completo
    const classpath = await libManager.buildClasspath();

    // Determinar id de la versión para nativos
    let versionId = versionData.id || versionData.inheritsFrom;
    if (!versionId) throw new Error("No se pudo determinar el versionId");

    // Crear instancia de NativesManager para la versión actual
    const nativesManager = new NativesManager(root, versionData);
    await nativesManager.ensureDir();

    // Extraer nativos oficiales a la carpeta base de nativos
    await libManager.extractNatives(nativesManager.getNativesDir());

    // Verificar si la carpeta de nativos está vacía
    const nativesDir = nativesManager.getNativesDir();
    let nativesExist = false;
    try {
      const files = await fs.readdir(nativesDir);
      nativesExist = files.length > 0;
    } catch {
      nativesExist = false;
    }

    // Si no hay nativos, intentar usar los de la versión vanilla base
    if (!nativesExist && versionData.inheritsFrom) {
      if (debug) console.log(`[prepareEnvironment] No hay nativos para ${versionId}, intentando vanilla base ${versionData.inheritsFrom}`);

      // Cargar datos de la versión vanilla base
      const vanillaVersionResolver = new VersionResolver(root, { versionID: versionData.inheritsFrom });
      const vanillaVersionData = await vanillaVersionResolver.getData();

      const vanillaNativesManager = new NativesManager(root, vanillaVersionData);
      await vanillaNativesManager.ensureDir();

      const vanillaLibManager = new LibraryManager(root, vanillaVersionData, platform, { debug });
      await vanillaLibManager.extractNatives(vanillaNativesManager.getNativesDir());

      const nativePath = vanillaNativesManager.getNativesDir();

      if (debug) console.log(`[prepareEnvironment] nativePath vanilla usado: ${nativePath}`);

      return { classpath, nativePath };
    }

    // Preparar otros posibles nativos extraídos (con sufijos únicos)
    const nativeDirs = Array.from(libManager.extractedNatives)
      .filter(dir => dir !== nativesManager.getNativesDir())
      .map(nativePath => 
        path.join(root, 'natives', `${versionId}-${path.basename(nativePath).replace(/[:.]/g, '_')}`)
      );

    // Componer java.library.path con todos los directorios de nativos
    const nativePath = [nativesManager.getNativesDir(), ...nativeDirs].join(path.delimiter);

    if (debug) {
      console.log("[prepareEnvironment] classpath:", classpath);
      console.log("[prepareEnvironment] nativePath:", nativePath);
    }

    return { classpath, nativePath };
  }



  #launch(argv) {
    const proc = spawn(argv[0], argv.slice(1), {
      cwd: this.opts.overrides.gameDirectory || this.opts.root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', d => this.#push('data', d));
    proc.stderr.on('data', d => this.#push('error', d));

    proc.on('close', async (code) => {
      if (code !== 0 && this.log.length) await this.#writeCrash(code);
      this.emit('close', code);
      this.log = [];
    });

    proc.on('error', err => {
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
