const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { v3: uuidv3 } = require('uuid');
const { default: fetch } = require('node-fetch');
const AuthenticatorMicrosoft = require('./AuthenticatorMicrosoft');

const API_URL = 'https://api.minecraftservices.com/';

async function post(endpoint, body) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'minecraft-core-authenticator'
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  if (!text) return null;

  try {
    const json = JSON.parse(text);
    if (json.error) throw new Error(json.errorMessage || json.error);
    return json;
  } catch (err) {
    throw new Error(`Error en ${endpoint}: ${err.message}`);
  }
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

class UserManager {
  constructor(root) {
    this.root = root;
    this.profilesPath = path.join(root, 'launcher_profiles.json');
    this.skinsDir = path.join(root, 'skins');
    this._profilesCache = null;
    this.msAuthenticator = new AuthenticatorMicrosoft();
  }

  async _loadProfiles() {
    if (this._profilesCache) return this._profilesCache;

    try {
      const data = await fs.readFile(this.profilesPath, 'utf-8');
      const parsed = JSON.parse(data);
      this._profilesCache = Array.isArray(parsed)
        ? parsed
        : Object.values(parsed.profiles || {});
    } catch {
      this._profilesCache = [];
    }

    return this._profilesCache;
  }

  async _saveProfiles(profiles) {
    this._profilesCache = profiles;
    await fs.writeFile(
      this.profilesPath,
      JSON.stringify(profiles, null, 2),
      'utf-8'
    );
  }

  async resolve(user) {
    if (user?.uuid && user?.accessToken) return user;

    const profiles = await this._loadProfiles();
    const existingLegacy = profiles.find(p => p.uuid && p.type === 'legacy');
    if (existingLegacy) return existingLegacy;

    const newUser = {
      type: 'legacy',
      name: 'Player',
      uuid: crypto.randomUUID(),
      accessToken: ''
    };

    profiles.push(newUser);
    await this._saveProfiles(profiles);

    return newUser;
  }

  async loginMojang(username, password) {
    if (!username || !password) throw new Error("Username y password requeridos");

    const uuid = uuidv3(username, uuidv3.DNS);
    const response = await post('/authenticate', {
      agent: { name: 'Minecraft', version: 1 },
      username,
      password,
      clientToken: uuid,
      requestUser: true
    });

    const userProfile = {
      uuid: response.selectedProfile?.id,
      name: response.selectedProfile?.name,
      accessToken: response.accessToken,
      clientToken: response.clientToken,
      user_properties: parseProps(response.user?.properties),
      type: 'mojang'
    };

    const profiles = await this._loadProfiles();
    const idx = profiles.findIndex(p => p.uuid === userProfile.uuid);

    if (idx >= 0) {
      profiles[idx] = userProfile;
    } else {
      profiles.push(userProfile);
    }

    await this._saveProfiles(profiles);
    return userProfile;
  }

  // Login Microsoft usando AuthenticatorMicrosoft
  async loginMicrosoft(username, password) {
    if (!username || !password) throw new Error("Username y password requeridos para Microsoft");

    const msProfile = await this.msAuthenticator.login(username, password);

    const userProfile = {
      uuid: msProfile.id,  // UUID Microsoft
      name: msProfile.name || username,
      accessToken: msProfile.access_token,
      clientToken: msProfile.access_token,
      user_properties: '{}',
      type: 'microsoft'
    };

    const profiles = await this._loadProfiles();
    const idx = profiles.findIndex(p => p.uuid === userProfile.uuid);
    if (idx >= 0) profiles[idx] = userProfile;
    else profiles.push(userProfile);

    await this._saveProfiles(profiles);
    return userProfile;
  }

  /**
   * Login genérico para elegir método.
   * @param {string} username
   * @param {string} password
   * @param {boolean} useMicrosoft
   * @returns {Promise<object>} userProfile
   */
  async login(username, password, useMicrosoft = false) {
    if (useMicrosoft) {
      return this.loginMicrosoft(username, password);
    } else {
      return this.loginMojang(username, password);
    }
  }

  async getSkin(uuid) {
    return this._fileExists(`${uuid}_skin.png`);
  }

  async getCape(uuid) {
    return this._fileExists(`${uuid}_cape.png`);
  }

  async _fileExists(filename) {
    const filePath = path.join(this.skinsDir, filename);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      return null;
    }
  }
}

module.exports = UserManager;
