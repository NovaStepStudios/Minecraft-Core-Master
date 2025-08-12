"use strict";
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const VersionHandler = require('./handlers/Version');
// Ya no usarás este Authenticator, lo reemplazamos por minecraft-auth
// const Authenticator = require('./authenticator/index');
const NativesHandler = require('./handlers/Natives');
const ClassPathHandler = require('./handlers/ClassPath');
const ArgumentsHandler = require('./handlers/Arguments');
const AssetsHandler = require('./handlers/Assets');
const LibrariesHandler = require('./handlers/Libraries');

// Importar minecraft-auth oficial
const minecraftAuth = require('minecraft-auth');

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

      // Detectar proveedor (provider)
      const provider = (opts.client.provider || (opts.client.password ? 'mojang' : 'cracked')).toLowerCase();

      let account;

      if (provider === 'microsoft') {
        minecraftAuth.MicrosoftAuth.setup({
          appID: opts.client.appID,
          mode: opts.client.mode,
          appSecret: opts.client.appSecret || undefined,
        });

        account = new minecraftAuth.MicrosoftAccount();

        debug('Esperando código de autenticación Microsoft (OAuth)...');
        const code = await minecraftAuth.MicrosoftAuth.listenForCode();

        if (!code) throw new Error('No se obtuvo código de autenticación Microsoft');

        await account.authFlow(code);
      } else if (provider === 'mojang') {
        account = new minecraftAuth.MojangAccount();

        debug(`Autenticando con Mojang: ${opts.client.username}`);
        await account.Login(opts.client.username, opts.client.password);

      } else if (provider === 'cracked' || provider === 'legacy') {
        account = new minecraftAuth.CrackedAccount(opts.client.username || 'Player');
        debug(`Usando modo cracked con usuario ${account.username}`);

      } else {
        throw new Error(`Proveedor de autenticación desconocido: ${provider}`);
      }

      debug(`Autenticado como ${account.username}`);

      await account.getProfile();

      // Construir objeto auth compatible con tu launcher
      const auth = {
        name: account.username,
        uuid: account.uuid,
        access_token: account.accessToken,
        profile: account.profile,
        ownership: account.ownership,
        provider,
      };

      debug(`Cargando versión ${opts.version.versionID}...`);
      const versionData = await VersionHandler.load(opts.root, opts.version.versionID);

      const AUTHLIB_NAME = 'com.mojang:authlib:1.5.25';
      if (!(versionData.libraries || []).some(lib => lib.name === AUTHLIB_NAME)) {
        debug('Agregando AutoLib a mano');
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
      const { classPath, modulePath } = await ClassPathHandler.build(opts.root, versionData);

      debug('Preparando argumentos de ejecución...');
      const args = ArgumentsHandler.build({
        opts,
        version: versionData,
        auth,
        classPath,
        modulePath,
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
        this._saveErrorLog(err, {
          profile: opts.client.username,
          version: opts.version.versionID,
          javaPath: opts.javaPath,
          component: 'Executor',
          root: opts.root
        });
        this.emit('error', err);
      });

      this.childProcess.on('close', code => {
        debug(`Java cerrado con código ${code}`);
        if (code !== 0) {
          const output = (stderr + stdout).trim() || '(sin salida)';
          const error = new Error(`Java finalizó con código ${code}\nSalida:\n${output}`);
          this._saveErrorLog(error, {
            profile: opts.client.username,
            version: opts.version.versionID,
            javaPath: opts.javaPath,
            component: 'Executor',
            root: opts.root,
            stdout,
            stderr,
          });
          this.emit('error', error);
        } else {
          this.emit('close', code);
        }
      });

      this.emit('started', { auth, opts, versionData });

    } catch (err) {
      this._saveErrorLog(err, {
        profile: opts.client.username,
        version: opts.version.versionID,
        javaPath: opts.javaPath,
        component: 'Executor',
        root: opts.root
      });
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

  _saveErrorLog(err, context = {}) {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
    const timeStr = `${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}-${now.getSeconds().toString().padStart(2, '0')}`;
    const fileName = `minecraft-core-master_step_executor_${dateStr}_${timeStr}_${context.profile || 'UnknownUser'}.log`;

    const logContent = `
    =========== MINECRAFT CORE MASTER ERROR LOG ===========
    Date       : ${now.toISOString()}
    Profile    : ${context.profile || 'UnknownUser'}
    Version    : ${context.version || 'UnknownVersion'}
    OS         : ${process.platform}
    Java Path  : ${context.javaPath || 'UnknownJavaPath'}
    Component  : ${context.component || 'General'}

    ERROR MESSAGE:
    ${err.message}

    STACKTRACE:
    ${err.stack}

    JAVA STDOUT:
    ${context.stdout || '(empty)'}

    JAVA STDERR:
    ${context.stderr || '(empty)'}
    =======================================================
    `;

    const logDir = path.resolve(context.root || './', 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const logPath = path.join(logDir, fileName);
    fs.writeFileSync(logPath, logContent, 'utf-8');
    console.error(`❌ [ERROR LOG] Guardado en: ${logPath}`);
  }

  _normalizeOptions(userOpts) {
    return {
      root: userOpts.root || './Minecraft-Core-Master',
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
        provider: userOpts.client?.provider || 'legacy',
        email: userOpts.client?.email || null,
        mode: userOpts.client?.mode || 'native',
        appID: userOpts.client?.appID || null,
        appSecret: userOpts.client?.appSecret || null,
      },
      jvmFlags: Array.isArray(userOpts.jvmFlags) ? userOpts.jvmFlags : [],
      mcFlags: Array.isArray(userOpts.mcFlags) ? userOpts.mcFlags : [],
      demo: userOpts.demo ?? false,
      debug: userOpts.debug ?? false,
    };
  }
}

module.exports = MinecraftExecutor;
