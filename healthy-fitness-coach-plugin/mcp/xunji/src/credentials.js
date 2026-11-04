'use strict';

const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { homedir } = require('node:os');

const KEYCHAIN_SERVICE = 'HealthyFitnessCoach.Xunji';
const KEYCHAIN_ACCOUNT = 'xunji-api-key';
const { connectorError } = require('./errors.js');

function credentialPath(localAppData) {
  return join(localAppData, 'HealthyFitnessCoach', 'credentials', 'xunji-credential.dpapi');
}

function isCredentialValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readWindowsCredential({ localAppData = process.env.LOCALAPPDATA, spawnProcess = spawn } = {}) {
  if (!localAppData) return Promise.reject(connectorError('missing_credentials'));
  const path = credentialPath(localAppData).replace(/'/g, "''");
  const command = `$path='${path}'; if (!(Test-Path -LiteralPath $path -PathType Leaf)) { exit 3 }; $secure=Get-Content -LiteralPath $path -Raw | ConvertTo-SecureString; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }`;
  return new Promise((resolve, reject) => {
    const child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', () => reject(connectorError('missing_credentials')));
    child.on('close', (code) => {
      const value = output.endsWith('\r\n') ? output.slice(0, -2) : (output.endsWith('\n') ? output.slice(0, -1) : output);
      if (code !== 0 || !isCredentialValue(value)) return reject(connectorError('missing_credentials'));
      resolve(value);
    });
  });
}

function dataHome({ platform = process.platform, home = homedir(), localAppData = process.env.LOCALAPPDATA } = {}) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support');
  if (platform === 'win32') return localAppData;
  return undefined;
}

function readMacCredential({ spawnProcess = spawn, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    let timer;
    let output = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      output = '';
      error ? reject(connectorError('missing_credentials')) : resolve(value);
    };
    try {
      child = spawnProcess('/usr/bin/security', [
        'find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
      timer = setTimeout(() => { finish(true); child.kill(); }, timeoutMs);
      child.stdout.on('data', chunk => {
        output += chunk;
        if (output.length > 16_384) { finish(true); child.kill(); }
      });
      child.on('error', () => finish(true));
      child.on('close', code => {
        const value = output.endsWith('\n') ? output.slice(0, -1) : output;
        finish(code !== 0 || !isCredentialValue(value), value);
      });
    } catch (_) { finish(true); }
  });
}

function readCredential(options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'darwin') return readMacCredential(options);
  if (platform === 'win32') return readWindowsCredential(options);
  return Promise.reject(connectorError('missing_credentials'));
}

module.exports = { credentialPath, isCredentialValue, readWindowsCredential,
  readMacCredential, readCredential, dataHome, KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT };
