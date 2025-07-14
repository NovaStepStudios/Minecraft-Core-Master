const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MojangAuthenticator = require('./MojangAuthenticator');

const DEFAULT_LAUNCHER_VERSION = {
  name: 'player',
  format: 1,
  profilesFormat: 1,
};

function generateUUIDv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.randomBytes(1)[0] & 15 >> c / 4).toString(16)
  );
}

function nowISO() {
  return new Date().toISOString();
}

function getLauncherProfilesPath(rootDir) {
  return path.join(rootDir, 'launcher_profiles.json');
}

async function readProfiles(filePath) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      profiles: {},
      authenticationDatabase: {},
      selectedUser: null,
      clientToken: generateUUIDv4(),
      launcherVersion: DEFAULT_LAUNCHER_VERSION,
      settings: {}
    };
  }
}

async function writeProfiles(filePath, data) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  /**
   * Login universal + creación de launcher_profiles.json con rutas personalizables.
   * 
   * @param {Object} client - { username, password }
   * @param {Object} options - { 
   *   demo?: boolean, 
   *   provider?: 'mojang'|'legacy', 
   *   root: string, 
   *   versionId: string, 
   *   gameDir: string 
   * }
   */
  async login(client, options = {}) {
    const {
      demo = false,
      provider = 'legacy',
      root = './',
      versionId = 'latest-release',
      gameDir = './'
    } = options;

    if (!client.username) throw new Error('Username es requerido');

    let userData;

    if (demo) {
      userData = {
        name: client.username,
        uuid: '00000000-0000-0000-0000-000000000000',
        accessToken: 'demo-token',
        type: 'demo'
      };
    } else {
      switch (provider) {
        case 'mojang':
          if (!client.password) throw new Error('Password requerido para Mojang');
          userData = await MojangAuthenticator.login(client.username, client.password);
          break;

        case 'legacy':
          userData = {
            name: client.username,
            uuid: generateUUIDv4(),
            accessToken: '',
            type: 'legacy'
          };
          break;

        default:
          throw new Error(`Provider inválido: ${provider}`);
      }
    }

    const profilesPath = getLauncherProfilesPath(root);
    const profilesData = await readProfiles(profilesPath);
    const userKey = userData.uuid.replace(/-/g, '');

    profilesData.authenticationDatabase[userKey] = {
      accessToken: userData.accessToken,
      username: userData.name,
      profiles: {
        [userData.uuid]: {
          displayName: userData.name
        }
      }
    };

    profilesData.profiles = {
      Player: {
        name: 'Player',
        type: 'custom',
        created: nowISO(),
        lastUsed: nowISO(),
        icon: '',
        lastVersionId: versionId,
        gameDir: path.resolve(gameDir),
        javaDir: '',
        javaArgs: '',
        logConfig: '',
        logConfigIsXML: false,
        resolution: {
          width: 854,
          height: 480
        }
      }
    };

    profilesData.selectedUser = {
      account: userKey,
      profile: userData.uuid
    };

    profilesData.clientToken ||= generateUUIDv4();
    profilesData.launcherVersion = DEFAULT_LAUNCHER_VERSION;

    await writeProfiles(profilesPath, profilesData);

    return userData;
  }
};
