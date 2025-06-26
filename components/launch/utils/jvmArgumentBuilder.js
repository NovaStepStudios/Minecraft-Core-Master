const { join, resolve, sep } = require('node:path');
const { spawnSync } = require('node:child_process');

class LaunchArgumentBuilder {
  constructor(opts) {
    this.opts = opts;

    this.opts.root = resolve(opts.root || './minecraft');
    this.opts.memory = opts.memory || { max: '2G', min: '1G' };
    this.opts.gameDirectory = opts.overrides?.gameDirectory || this.opts.root;
    this.opts.extraJvm = opts.jvm || [];
    this.opts.extraMcArgs = opts.mcArgs || [];

    this.versionFile = opts.versionFile;
    this.customFile = opts.customFile || {};

    this.classPath = opts.libs;
    this.nativePath = opts.nativePath;
  }

  #javaMajor(javaPath) {
    try {
      const out = spawnSync(javaPath, ['-version'], { encoding: 'utf8', stdio: 'pipe' });
      const m = out.stderr.match(/version \"(?:(\d+)\.)?(\d+)/);
      if (!m) return 8;
      return m[1] === '1' ? parseInt(m[2]) : parseInt(m[1]);
    } catch {
      return 8;
    }
  }

  #isLegacyVersion(versionId) {
    if (!versionId) return false;
    const [major, minor, patch] = versionId.split('.').map(n => parseInt(n) || 0);
    // Legacy si es menor a 1.6.1
    return (major < 1) || (major === 1 && (minor < 6 || (minor === 6 && patch < 1)));
  }

  #collectPlaceholders() {
    const auth = this.opts.authorization || {};
    const v = this.opts.version || {};
    let assetsRoot = join(this.opts.gameDirectory, 'assets');

    // Detectar legacy y ajustar assetsRoot
    const versionId = v.number || v.id || v.inheritsFrom || '';
    if (this.#isLegacyVersion(versionId)) {
      assetsRoot = join(this.opts.gameDirectory, 'assets', 'virtual', 'legacy');
    }

    return {
      '${auth_access_token}': auth.access_token || '',
      '${auth_session}': auth.access_token || '',
      '${auth_player_name}': auth.name || 'Player',
      '${auth_uuid}': auth.uuid || '00000000-0000-0000-0000-000000000000',
      '${auth_xuid}': auth.meta?.xuid || '',
      '${user_properties}': auth.user_properties || '{}',
      '${user_type}': auth.meta?.type || 'legacy',
      '${version_name}': v.number || this.opts.overrides?.versionName || 'unknown',
      '${assets_index_name}': this.opts.overrides?.assetIndex || v.custom || v.number || 'legacy',
      '${game_directory}': this.opts.gameDirectory,
      '${assets_root}': assetsRoot,
      '${game_assets}': assetsRoot,
      '${version_type}': v.type || 'release',
      '${clientid}': auth.meta?.clientId || auth.client_token || '',
      '${resolution_width}': this.opts.window?.width || 856,
      '${resolution_height}': this.opts.window?.height || 482,
      '${library_directory}': join(this.opts.gameDirectory, 'libraries').split(sep).join('/'),
      '${classpath_separator}': process.platform === 'win32' ? ';' : ':',
      '${natives_directory}': this.nativePath,
      '${classpath}': this.classPath,
    };
  }

  #buildJvmFlags() {
    const major = this.#javaMajor(this.opts.javaPath);
  
    const memoryFlags = [
      `-Xmx${this.opts.memory.max}`,
      `-Xms${this.opts.memory.min}`,
    ];
  
    const gcFlags = [
      '-XX:+UseG1GC',
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC',
      '-XX:G1NewSizePercent=20',
      '-XX:G1ReservePercent=15',
      '-XX:MaxGCPauseMillis=40',
      '-XX:G1HeapRegionSize=16M',
      '-XX:+AlwaysPreTouch', // mejora la estabilidad de heap en algunos entornos
    ];
  
    const performanceFlags = [
      '-Dsun.rmi.dgc.server.gcInterval=2147483646',
      '-Dsun.rmi.dgc.client.gcInterval=2147483646',
      '-Djava.awt.headless=true',
      '-Dfile.encoding=UTF-8',
    ];
  
    const compatibilityFlags = [
      `-Djava.library.path=${this.nativePath}`,
      '-cp', this.classPath,
    ];
  
    const nativeAccessFlags = (major >= 19)
      ? ['--enable-native-access=ALL-UNNAMED']
      : [];
  
    const extraFlags = [
      ...this.opts.customFile?.arguments?.jvm || [],
      ...this.opts.extraJvm
    ];
  
    return [
      ...memoryFlags,
      ...gcFlags,
      ...performanceFlags,
      ...nativeAccessFlags,
      ...compatibilityFlags,
      ...extraFlags,
    ];
  }  

  #buildGameArgs() {
    let { mainClass, minecraftArguments, arguments: argObj } = this.versionFile;

    if (this.customFile?.mainClass) {
      mainClass = this.customFile.mainClass;
    }

    if (!mainClass) throw new Error("mainClass no definido en el archivo de versión.");

    let gameArgs = [];

    if (minecraftArguments) {
      gameArgs = minecraftArguments.split(' ');
    } else if (argObj?.game) {
      gameArgs = [...argObj.game];
    } else if (this.customFile?.arguments?.game) {
      gameArgs = [...this.customFile.arguments.game];
    }

    gameArgs.push(...this.opts.extraMcArgs);

    return { mainClass, gameArgs };
  }

  build() {
    const placeholders = this.#collectPlaceholders();
    const jvmFlags = this.#buildJvmFlags();
    const { mainClass, gameArgs } = this.#buildGameArgs();

    let argv = [...jvmFlags, mainClass, ...gameArgs];

    argv = argv.map(arg => typeof arg === 'string'
      ? arg.replace(/\$\{[^}]+\}/g, m => placeholders[m] ?? m)
      : arg);

    argv.unshift(this.opts.javaPath);
    return argv;
  }
}

module.exports = { LaunchArgumentBuilder };
