"use strict";
require('dotenv').config();
const fetch = require('node-fetch').default;
const crypto = require('crypto');
const express = require('express');
const open = require('open').default;
const path = require('path');

const MS_AUTH_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';

const XBL_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_AUTH_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MINECRAFT_AUTH_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox';

class AuthenticatorMicrosoft {
  constructor() {
    this.clientId = process.env.MS_CLIENT_ID;
    this.clientSecret = process.env.MS_CLIENT_SECRET;
    this.scope = 'XboxLive.signin offline_access openid profile';
    this.redirectUri = 'http://localhost:3000/outh';
    this.port = 3000;
  }

  generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('hex');
    const challenge = this.base64URLEncode(
      crypto.createHash('sha256').update(verifier).digest()
    );
    return { verifier, challenge };
  }

  base64URLEncode(buffer) {
    return buffer.toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  async login() {
    const { verifier, challenge } = this.generatePKCE();

    const authUrl = `${MS_AUTH_URL}?client_id=${this.clientId}` +
      `&response_type=code&redirect_uri=${encodeURIComponent(this.redirectUri)}` +
      `&scope=${encodeURIComponent(this.scope)}` +
      `&code_challenge=${challenge}&code_challenge_method=S256&response_mode=query`;

    open(authUrl);

    const code = await this.waitForCode();

    const tokenResponse = await this.getTokens(code, verifier);

    const xblToken = await this.getXBLToken(tokenResponse.access_token);
    const xstsToken = await this.getXSTSToken(xblToken.Token);

    const mcAuth = await this.loginMinecraft(xstsToken.Token, xstsToken.DisplayClaims.xui[0].uhs);

    const profileRes = await fetch('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: `Bearer ${mcAuth.access_token}` },
    });

    if (!profileRes.ok) throw new Error(`Error obteniendo perfil de Minecraft: ${profileRes.statusText}`);
    const profile = await profileRes.json();

    return {
      uuid: profile.id,
      name: profile.name,
      accessToken: mcAuth.access_token,
      refreshToken: tokenResponse.refresh_token,
      type: 'microsoft',
      user_properties: '{}',
    };
  }

  waitForCode() {
    return new Promise((resolve, reject) => {
      const app = express();
      const server = app.listen(this.port, () => {
        console.log(`[Auth] Esperando código de autorización en http://localhost:${this.port}/outh ...`);
      });

      app.get('/outh', (req, res) => {
        const authCode = req.query.code;
        if (authCode) {
          // Servir archivo HTML local con mensaje personalizado
          res.sendFile(path.join(__dirname, 'success.html'));
          server.close();
          resolve(authCode);
        } else {
          res.status(400).send('No se recibió código de autorización');
          server.close();
          reject(new Error('No se recibió código de autorización'));
        }
      });

      setTimeout(() => {
        server.close();
        reject(new Error('Tiempo agotado esperando código de autorización'));
      }, 5 * 60 * 1000);
    });
  }

  async getTokens(code, verifier) {
    const params = new URLSearchParams();
    params.append('client_id', this.clientId);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', this.redirectUri);
    params.append('code_verifier', verifier);
    params.append('client_secret', this.clientSecret);

    const res = await fetch(MS_TOKEN_URL, {
      method: 'POST',
      body: params,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error obteniendo tokens MS: ${res.status} ${text}`);
    }

    return res.json();
  }

  async getXBLToken(msAccessToken) {
    const body = {
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msAccessToken}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    };

    const res = await fetch(XBL_AUTH_URL, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) {
        throw new Error('Tu cuenta de Microsoft no tiene un perfil de Xbox. Crealo gratis en https://account.xbox.com/');
      }
      throw new Error(`Error Xbox Live Auth: ${res.status} ${text}`);
    }

    return res.json();
  }

  async getXSTSToken(xblToken) {
    const body = {
      Properties: {
        SandboxId: 'RETAIL',
        UserTokens: [xblToken],
      },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    };

    const res = await fetch(XSTS_AUTH_URL, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error XSTS Auth: ${res.status} ${text}`);
    }

    return res.json();
  }

  async loginMinecraft(xstsToken, userHash) {
    const body = {
      identityToken: `XBL3.0 x=${userHash};${xstsToken}`,
    };

    const res = await fetch(MINECRAFT_AUTH_URL, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error Minecraft Auth: ${res.status} ${text}`);
    }

    return res.json();
  }
}

module.exports = AuthenticatorMicrosoft;
