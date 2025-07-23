const { v3: uuidv3 } = require('uuid');

function getUUID(username) {
  return uuidv3(username, uuidv3.DNS);
}

function getFakeUserProperties() {
  // JSON.stringify ya retorna string, en tu handler lo usas directamente como string base64.
  return JSON.stringify({
    preferredLanguage: ['en'],
  });
}

async function login(username, password, clientToken = null) {
  if (!username) throw new Error('Username es requerido');
  const uuid = getUUID(username);

  return {
    uuid,                // uuid simple para args
    name: username,      // nombre de usuario
    accessToken: uuid,   // access token (fake)
    userProperties: {
      value: Buffer.from(getFakeUserProperties()).toString('base64') // base64 string para userProperties
    },
    selected_profile: {
      id: uuid,
      name: username,
    }
  };
}

async function validate() {
  return true;
}

async function refresh(accessToken, clientToken) {
  const uuid = clientToken;
  return {
    uuid,
    name: 'Player',
    accessToken,
    userProperties: {
      value: Buffer.from(getFakeUserProperties()).toString('base64')
    },
    selected_profile: {
      id: uuid,
      name: 'Player',
    }
  };
}

async function invalidate() {
  return true;
}

async function signOut() {
  return true;
}

function changeApiUrl() {}

module.exports = {
  login,
  validate,
  refreshAuth: refresh,
  invalidate,
  signOut,
  changeApiUrl,
};
