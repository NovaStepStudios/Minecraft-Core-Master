const { v3: uuidv3 } = require('uuid');

// Namespace DNS de UUIDv3 para generar UUID únicos y constantes por username
function getUUID(username) {
  return uuidv3(username, uuidv3.DNS);
}

// Simula las propiedades de usuario que Mojang devuelve (puede usarse en algunos mods o launchers)
function getFakeUserProperties() {
  return JSON.stringify({
    preferredLanguage: ['en'],
    // Podés agregar más propiedades falsas si lo requieren (como skin, etc.)
  });
}

/**
 * Simula un login "online" sin conectarse a Mojang
 * @param {string} username 
 * @param {string} password 
 * @returns {object} Datos de sesión simulados
 */
async function login(username, password, clientToken = null) {
  if (!username) throw new Error('Username es requerido');
  const uuid = getUUID(username);

  // Esto engaña al juego creyendo que está logueado
  return {
    access_token: uuid, // Simula el token
    client_token: clientToken || uuid,
    uuid,
    name: username,
    selected_profile: {
      id: uuid,
      name: username,
    },
    user_properties: getFakeUserProperties(),
  };
}

// Simula validación del token (sin conexión)
async function validate(accessToken, clientToken) {
  // Siempre dice que es válido
  return true;
}

// Simula el refresh de token (sin conexión)
async function refresh(accessToken, clientToken) {
  const uuid = clientToken;
  return {
    access_token: accessToken,
    client_token: clientToken,
    uuid,
    name: 'Player',
    selected_profile: {
      id: uuid,
      name: 'Player',
    },
    user_properties: getFakeUserProperties(),
  };
}

// Simula invalidación del token (sin conexión)
async function invalidate(accessToken, clientToken) {
  return true;
}

// Simula signOut (nunca hace nada)
async function signOut(username, password) {
  return true;
}

// No es necesario ya que no hay API
function changeApiUrl(url) {
  // Ignorado
}

module.exports = {
  login,
  validate,
  refreshAuth: refresh,
  invalidate,
  signOut,
  changeApiUrl,
};
