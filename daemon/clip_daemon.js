#!/usr/bin/env node
/**
 * ClipSync Desktop Daemon (Node.js version)
 * Synchronizes OS clipboard with ClipSync room.
 */
const { execSync } = require('child_process');
const http = require('http');

const room = process.argv[2] || 'SYNC-ROOM';
const serverUrl = process.argv[3] || 'http://localhost:3000';
const pollIntervalMs = 800;

function getClipboard() {
  try {
    if (process.platform === 'win32') {
      return execSync('powershell.exe -command Get-Clipboard', { encoding: 'utf8' }).trimEnd();
    } else if (process.platform === 'darwin') {
      return execSync('pbpaste', { encoding: 'utf8' });
    } else {
      return execSync('xclip -selection clipboard -o', { encoding: 'utf8' });
    }
  } catch (e) {
    return '';
  }
}

function setClipboard(text) {
  try {
    if (process.platform === 'win32') {
      const escaped = text.replace(/`/g, '``').replace(/"/g, '`"');
      execSync(`powershell.exe -command "Set-Clipboard -Value \\"${escaped}\\""`);
    } else if (process.platform === 'darwin') {
      execSync('pbcopy', { input: text });
    } else {
      execSync('xclip -selection clipboard', { input: text });
    }
  } catch (e) {
    // Ignore clipboard errors
  }
}

function pushClip(text) {
  const url = new URL('/api/clip', serverUrl);
  const data = JSON.stringify({
    room,
    text,
    deviceName: '💻 Laptop Node Daemon',
    deviceType: 'laptop'
  });

  const req = http.request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  });

  req.on('error', () => {});
  req.write(data);
  req.end();
}

function checkLatest(callback) {
  const url = new URL(`/api/clip/latest?room=${encodeURIComponent(room)}`, serverUrl);
  http.get(url, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(body);
        callback(json.latest);
      } catch (e) {
        callback(null);
      }
    });
  }).on('error', () => callback(null));
}

console.log(`===============================================`);
console.log(`📋 ClipSync Node.js Daemon running!`);
console.log(`Room:   ${room}`);
console.log(`Server: ${serverUrl}`);
console.log(`===============================================\n`);

let lastLocal = getClipboard();
let lastServerId = null;

// Initial state
checkLatest(latest => {
  if (latest) lastServerId = latest.id;
});

setInterval(() => {
  // 1. Detect local copy
  const curLocal = getClipboard();
  if (curLocal && curLocal !== lastLocal) {
    lastLocal = curLocal;
    console.log(`[Laptop -> Mobile] Copied: "${curLocal.slice(0, 30)}..."`);
    pushClip(curLocal);
  }

  // 2. Detect remote clip from mobile
  checkLatest(latest => {
    if (latest && latest.id !== lastServerId) {
      lastServerId = latest.id;
      if (latest.text && latest.text !== lastLocal) {
        lastLocal = latest.text;
        setClipboard(latest.text);
        console.log(`[Mobile -> Laptop] Received from ${latest.deviceName}: "${latest.text.slice(0, 30)}..." -> Clipboard Updated!`);
      }
    }
  });
}, pollIntervalMs);
