const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v3: uuidv3 } = require('uuid');
const https = require('https');
const AuthenticatorMicrosoft = require('./AuthenticatorMicrosoft');

const MOJANG_AUTH_URL = 'https://authserver.mojang.com/authenticate';

const DEFAULT_LAUNCHER_VERSION = {
  name: 'player',
  format: 1,
  profilesFormat: 1,
};

function nowISO() {
  return new Date().toISOString();
}

function parseProps(array) {
  if (!Array.isArray(array)) return '{}';
  const obj = {};
  for (const { name, value } of array) {
    if (!obj[name]) obj[name] = [];
    obj[name].push(value);
  }
  return JSON.stringify(obj);
}

function buildTextures(username, uuid, skinUrl, capeUrl) {
  const textures = {
    timestamp: Date.now(),
    profileId: uuid.replace(/-/g, ''),
    profileName: username,
    textures: {},
  };
  if (skinUrl) textures.textures.SKIN = { url: skinUrl };
  if (capeUrl) textures.textures.CAPE = { url: capeUrl };
  const value = Buffer.from(JSON.stringify(textures)).toString('base64');
  return {
    name: 'textures',
    value,
  };
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
      clientToken: crypto.randomUUID(),
      launcherVersion: DEFAULT_LAUNCHER_VERSION,
      settings: {},
    };
  }
}

async function writeProfiles(filePath, data) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function saveOrUpdateUserProfile(root, userProfile) {
  const profilesPath = getLauncherProfilesPath(root);
  const profilesData = await readProfiles(profilesPath);

  if (!profilesData.clientToken) {
    profilesData.clientToken = crypto.randomUUID();
  }

  profilesData.profiles[userProfile.uuid] = {
    name: userProfile.name,
    type: userProfile.type,
    created: nowISO(),
    lastUsed: nowISO(),
  };

  profilesData.authenticationDatabase[userProfile.uuid] = {
    accessToken: userProfile.accessToken || '',
    username: userProfile.name,
    profiles: {
      [userProfile.uuid]: { displayName: userProfile.name },
    },
    userProperties: userProfile.userProperties || '[{}]',
    displayName: userProfile.name,
    type: userProfile.type,
  };

  profilesData.selectedUser = {
    account: userProfile.uuid,
    profile: userProfile.uuid,
  };

  profilesData.launcherVersion = DEFAULT_LAUNCHER_VERSION;

  await writeProfiles(profilesPath, profilesData);
}

function postJSON(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const { hostname, pathname } = new URL(url);

    const options = {
      hostname,
      path: pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'minecraft-core-master',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => resolve(raw));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function loginMojang(root, username, password) {
  if (!username || !password) throw new Error('[✖] Username y password requeridos para Mojang');

  console.log(`[Auth] Iniciando sesión Mojang para ${username}...`);

  const profilesPath = getLauncherProfilesPath(root);
  const profilesData = await readProfiles(profilesPath);
  let existingProfileEntry = Object.entries(profilesData.profiles)
    .find(([, p]) => p.name === username && p.type === 'mojang');

  let clientToken = profilesData.clientToken || crypto.randomUUID();
  if (existingProfileEntry) {
    const [uuid] = existingProfileEntry;
    const authData = profilesData.authenticationDatabase[uuid];
    if (authData && authData.accessToken) clientToken = authData.accessToken;
  }

  let raw;
  try {
    raw = await postJSON(MOJANG_AUTH_URL, {
      agent: { name: 'Minecraft', version: 1 },
      username,
      password,
      clientToken,
      requestUser: true,
    });
  } catch (err) {
    throw new Error(`[✖] Error al conectar con Mojang: ${err.message}`);
  }

  if (!raw) throw new Error('[✖] Respuesta vacía de Mojang');

  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`[✖] Error parseando respuesta Mojang: ${err.message}`);
  }

  if (json.error) throw new Error(`[✖] ${json.errorMessage || json.error}`);

  const userProperties = parseProps(json.user?.properties);

  const userProfile = {
    uuid: json.selectedProfile?.id,
    name: json.selectedProfile?.name,
    accessToken: json.accessToken,
    clientToken: json.clientToken || clientToken,
    userProperties: [{ name: 'textures', value: Buffer.from(userProperties).toString('base64') }],
    user_properties: userProperties,
    type: 'mojang',
  };

  await saveOrUpdateUserProfile(root, userProfile);
  console.log(`[✔] Login exitoso Mojang: ${userProfile.name}`);
  return userProfile;
}

async function loginMicrosoft(root, username, password, email) {
  if (!username || !password || !email)
    throw new Error('[✖] Username, password y email requeridos para Microsoft');

  console.log(`[Auth] Iniciando sesión Microsoft para ${username} (email: ${email})...`);

  const msAuthenticator = new AuthenticatorMicrosoft();
  const msProfile = await msAuthenticator.login(username, password, email);

  const userProfile = {
    uuid: msProfile.id,
    name: msProfile.name || username,
    email,
    accessToken: msProfile.access_token,
    clientToken: msProfile.access_token,
    userProperties: [{ name: 'textures', value: Buffer.from('{}').toString('base64') }],
    user_properties: '{}',
    type: 'microsoft',
  };

  await saveOrUpdateUserProfile(root, userProfile);
  console.log(`[✔] Login exitoso Microsoft: ${userProfile.name}`);
  return userProfile;
}

function getOfflineUUID(username, password = '') {
  const hash = crypto.createHash('sha1');
  hash.update(`OfflinePlayer:${username.toLowerCase()}:${password}`);
  const fullHash = hash.digest('hex');
  return [
    fullHash.substring(0, 8),
    fullHash.substring(8, 12),
    '3' + fullHash.substring(13, 16),
    fullHash.substring(16, 20),
    fullHash.substring(20, 32),
  ].join('-');
}

function buildTexturesLocal(username, uuid, skinUrl, capeUrl) {
  const textures = {
    timestamp: Date.now(),
    profileId: uuid.replace(/-/g, ''),
    profileName: username,
    textures: {},
  };
  if (skinUrl) textures.textures.SKIN = { url: skinUrl };
  if (capeUrl) textures.textures.CAPE = { url: capeUrl };
  const value = Buffer.from(JSON.stringify(textures)).toString('base64');
  return {
    name: 'textures',
    value,
  };
}

async function loginLegacy(root, username, password, skinUrl, capeUrl) {
  if (!username) throw new Error('[✖] Username es requerido para cuenta legacy');

  console.log(`[Auth] Usando cuenta legacy offline: ${username}`);

  const uuid = getOfflineUUID(username, password || '');
  const accessToken = crypto.randomUUID();
  const textures = buildTexturesLocal(username, uuid, skinUrl, capeUrl);

  const userProperties = [textures];

  const userProfile = {
    uuid,
    name: username,
    accessToken,
    clientToken: accessToken,
    userProperties,
    user_properties: JSON.stringify([textures]),
    type: 'legacy',
  };

  await saveOrUpdateUserProfile(root, userProfile);
  console.log(`[✔] Perfil offline creado: ${username}`);

  return userProfile;
}

module.exports = {
  async login(client, options = {}) {
    const { root = './', versionId = 'latest-release', gameDir = './' } = options;
    const provider = client.provider || 'legacy';

    switch (provider) {
      case 'microsoft':
        return await loginMicrosoft(root, client.username, client.password, client.email);
      case 'mojang':
        return await loginMojang(root, client.username, client.password);
      case 'legacy':
      default:
        return await loginLegacy(root, client.username, client.password, client.skinUrl, client.capeUrl);
    }
  },
  loginMojang,
  loginMicrosoft,
  loginLegacy,
};
