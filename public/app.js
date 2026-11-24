// ClipSync Client Application
(function () {
  'use strict';

  // State
  let socket = null;
  let qrcodeInstance = null;
  let serverIps = [];
  let isAutoSyncEnabled = localStorage.getItem('clipsync_auto_sync') === 'true';
  let isSoundEnabled = localStorage.getItem('clipsync_sound') !== 'false';
  let isE2EEEnabled = localStorage.getItem('clipsync_e2ee') === 'true';
  let e2eePassword = localStorage.getItem('clipsync_e2ee_pass') || '';
  let e2eeKey = null;

  // Device Info
  const isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(navigator.userAgent);
  let defaultDeviceName = localStorage.getItem('clipsync_device_name') || (isMobile ? '📱 Mobile Device' : '💻 Laptop');
  let currentRoom = getInitialRoom();

  // DOM Elements
  const roomCodeText = document.getElementById('roomCodeText');
  const qrRoomCode = document.getElementById('qrRoomCode');
  const connectionBadge = document.getElementById('connectionBadge');
  const devicesList = document.getElementById('devicesList');
  const clipsFeed = document.getElementById('clipsFeed');
  const emptyHistoryState = document.getElementById('emptyHistoryState');
  const historyCountBadge = document.getElementById('historyCountBadge');

  const btnPushClipboard = document.getElementById('btnPushClipboard');
  const manualTextInput = document.getElementById('manualTextInput');
  const btnSendText = document.getElementById('btnSendText');
  const btnClearInput = document.getElementById('btnClearInput');
  const charCount = document.getElementById('charCount');

  const latestIncomingCard = document.getElementById('latestIncomingCard');
  const latestClipContent = document.getElementById('latestClipContent');
  const latestSenderBadge = document.getElementById('latestSenderBadge');
  const latestTimeBadge = document.getElementById('latestTimeBadge');
  const latestOpenLinkBtn = document.getElementById('latestOpenLinkBtn');
  const btnCopyLatest = document.getElementById('btnCopyLatest');
  const copyLatestLabel = document.getElementById('copyLatestLabel');

  const btnClearHistory = document.getElementById('btnClearHistory');
  const toggleAutoSync = document.getElementById('toggleAutoSync');
  const toggleSound = document.getElementById('toggleSound');

  // Modals
  const btnOpenQr = document.getElementById('btnOpenQr');
  const qrModal = document.getElementById('qrModal');
  const btnCloseQrModal = document.getElementById('btnCloseQrModal');
  const networkIpSelect = document.getElementById('networkIpSelect');
  const btnCopyPairUrl = document.getElementById('btnCopyPairUrl');
  const copyPairUrlText = document.getElementById('copyPairUrlText');

  const btnOpenSettings = document.getElementById('btnOpenSettings');
  const settingsModal = document.getElementById('settingsModal');
  const btnCloseSettingsModal = document.getElementById('btnCloseSettingsModal');
  const settingRoomInput = document.getElementById('settingRoomInput');
  const settingDeviceInput = document.getElementById('settingDeviceInput');
  const btnGenerateRoom = document.getElementById('btnGenerateRoom');
  const toggleE2EE = document.getElementById('toggleE2EE');
  const e2eePasswordContainer = document.getElementById('e2eePasswordContainer');
  const settingPasswordInput = document.getElementById('settingPasswordInput');
  const btnSaveSettings = document.getElementById('btnSaveSettings');

  // History cache
  let clipHistory = [];
  let latestClip = null;

  // ==========================================
  // Initialization
  // ==========================================
  function init() {
    toggleAutoSync.checked = isAutoSyncEnabled;
    toggleSound.checked = isSoundEnabled;
    toggleE2EE.checked = isE2EEEnabled;
    if (isE2EEEnabled) {
      e2eePasswordContainer.classList.remove('hidden');
      settingPasswordInput.value = e2eePassword;
    }

    settingRoomInput.value = currentRoom;
    settingDeviceInput.value = defaultDeviceName;
    roomCodeText.textContent = currentRoom;
    qrRoomCode.textContent = currentRoom;

    // Service worker registration
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW registration error:', err));
    }

    // Connect WebSocket
    initSocket();

    // Fetch server status & IPs
    fetchServerStatus();

    // Setup Event Listeners
    setupEvents();

    // Initialize E2EE if configured
    if (isE2EEEnabled && e2eePassword) {
      deriveCryptoKey(e2eePassword);
    }
  }

  function getInitialRoom() {
    // Check URL parameters first (e.g. ?room=ABCD)
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      const sanitized = roomParam.trim().toUpperCase();
      localStorage.setItem('clipsync_room', sanitized);
      return sanitized;
    }
    // Check localStorage
    const saved = localStorage.getItem('clipsync_room');
    if (saved) return saved;
    // Generate random room code
    const generated = 'SYNC-' + Math.floor(1000 + Math.random() * 9000);
    localStorage.setItem('clipsync_room', generated);
    return generated;
  }

  // ==========================================
  // Socket.io Connection
  // ==========================================
  function initSocket() {
    socket = io({
      reconnectionAttempts: 10,
      timeout: 10000
    });

    socket.on('connect', () => {
      connectionBadge.className = 'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      connectionBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Connected';
      
      // Join Room
      socket.emit('join-room', {
        room: currentRoom,
        deviceName: defaultDeviceName,
        deviceType: isMobile ? 'mobile' : 'laptop'
      });
    });

    socket.on('disconnect', () => {
      connectionBadge.className = 'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20';
      connectionBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span> Disconnected';
    });

    socket.on('room-users', (users) => {
      renderDeviceRoster(users);
    });

    socket.on('init-history', async (clips) => {
      clipHistory = [];
      for (const clip of clips) {
        const decrypted = await processIncomingClip(clip);
        clipHistory.push(decrypted);
      }
      renderHistory();
    });

    socket.on('new-clip', async (clip) => {
      const processed = await processIncomingClip(clip);
      handleNewIncomingClip(processed);
    });

    socket.on('clip-sent', (clip) => {
      showToast('✓ Beamed to devices!', 'success');
      // Update local history if not already present
      if (!clipHistory.some(c => c.id === clip.id)) {
        clipHistory.unshift(clip);
        renderHistory();
      }
    });

    socket.on('clear-history', () => {
      clipHistory = [];
      latestClip = null;
      latestIncomingCard.classList.add('hidden');
      renderHistory();
      showToast('History cleared', 'info');
    });
  }

  // ==========================================
  // End-to-End Encryption (AES-GCM)
  // ==========================================
  async function deriveCryptoKey(password) {
    try {
      const enc = new TextEncoder();
      const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );
      e2eeKey = await window.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: enc.encode('clipsync-salt-v1'),
          iterations: 100000,
          hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    } catch (e) {
      console.error('Key derivation failed:', e);
    }
  }

  async function encryptText(text) {
    if (!isE2EEEnabled || !e2eeKey) return { text, encrypted: false };
    try {
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(text);
      const ciphertext = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        e2eeKey,
        encoded
      );
      // Combine iv and ciphertext into base64
      const ivArr = Array.from(iv);
      const ctArr = Array.from(new Uint8Array(ciphertext));
      const combined = JSON.stringify({ iv: ivArr, data: ctArr });
      return { text: btoa(combined), encrypted: true };
    } catch (err) {
      console.error('Encryption failed:', err);
      return { text, encrypted: false };
    }
  }

  async function decryptText(payload) {
    if (!payload.encrypted || !e2eeKey) return payload.text;
    try {
      const json = JSON.parse(atob(payload.text));
      const iv = new Uint8Array(json.iv);
      const data = new Uint8Array(json.data);
      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        e2eeKey,
        data
      );
      return new TextDecoder().decode(decrypted);
    } catch (err) {
      console.warn('Decryption failed (passwords may not match):', err);
      return '🔒 [Encrypted Clip - Provide matching password in Settings]';
    }
  }

  async function processIncomingClip(clip) {
    if (clip.encrypted) {
      const decryptedText = await decryptText(clip);
      return { ...clip, text: decryptedText };
    }
    return clip;
  }

  // ==========================================
  // Clip Sync Actions
  // ==========================================
  async function pushSystemClipboard() {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        showToast('Clipboard access requires HTTPS or localhost', 'error');
        return;
      }

      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        showToast('Clipboard is currently empty', 'warning');
        return;
      }

      await sendClipData(text);
    } catch (err) {
      console.warn('Clipboard read failed:', err);
      showToast('Clipboard permission denied. Use the manual box below.', 'warning');
      manualTextInput.focus();
    }
  }

  async function sendClipData(rawText) {
    const text = rawText.trim();
    if (!text) return;

    // Detect type
    const isUrl = /^https?:\/\/[^\s]+$/i.test(text);
    const clipType = isUrl ? 'url' : 'text';

    const payload = await encryptText(text);

    socket.emit('send-clip', {
      text: payload.text,
      type: clipType,
      encrypted: payload.encrypted,
      deviceName: defaultDeviceName,
      deviceType: isMobile ? 'mobile' : 'laptop'
    });
  }

  async function handleNewIncomingClip(clip) {
    latestClip = clip;
    clipHistory.unshift(clip);
    renderHistory();

    // Play chime sound
    if (isSoundEnabled) playChime();

    // Vibrate on mobile
    if (navigator.vibrate) {
      navigator.vibrate([80, 50, 80]);
    }

    // Display banner
    latestIncomingCard.classList.remove('hidden');
    latestClipContent.textContent = clip.text;
    latestSenderBadge.textContent = `${clip.deviceType === 'mobile' ? '📱' : '💻'} ${clip.deviceName}`;
    latestTimeBadge.textContent = 'Just now';

    // URL detection for 1-tap open
    if (/^https?:\/\/[^\s]+$/i.test(clip.text)) {
      latestOpenLinkBtn.href = clip.text;
      latestOpenLinkBtn.classList.remove('hidden');
      latestOpenLinkBtn.classList.add('inline-flex');
    } else {
      latestOpenLinkBtn.classList.add('hidden');
      latestOpenLinkBtn.classList.remove('inline-flex');
    }

    // Try auto-writing to clipboard if focused
    if (document.hasFocus() && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(clip.text);
        copyLatestLabel.textContent = 'Copied to System!';
        btnCopyLatest.classList.add('bg-emerald-400');
        setTimeout(() => {
          copyLatestLabel.textContent = 'Copy to Clipboard';
        }, 2500);
      } catch (e) {
        // Requires user gesture on some browsers
        copyLatestLabel.textContent = 'Tap to Copy';
      }
    } else {
      copyLatestLabel.textContent = 'Tap to Copy';
    }

    showToast(`Received from ${clip.deviceName}!`, 'info');
  }

  // ==========================================
  // UI Rendering
  // ==========================================
  function renderDeviceRoster(users) {
    if (!devicesList) return;
    devicesList.innerHTML = '<span class="text-slate-400">Devices online:</span>';

    users.forEach(user => {
      const isMe = user.socketId === socket.id;
      const badge = document.createElement('span');
      badge.className = `inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-xs ${
        isMe
          ? 'bg-indigo-950/50 text-indigo-300 border-indigo-700/50'
          : 'bg-slate-800 text-slate-200 border-slate-700'
      }`;
      badge.innerHTML = `
        <span class="w-1.5 h-1.5 rounded-full ${isMe ? 'bg-indigo-400' : 'bg-emerald-400'}"></span>
        <span>${escapeHtml(user.deviceName)}${isMe ? ' (You)' : ''}</span>
      `;
      devicesList.appendChild(badge);
    });
  }

  function renderHistory() {
    historyCountBadge.textContent = clipHistory.length;

    if (clipHistory.length === 0) {
      emptyHistoryState.classList.remove('hidden');
      clipsFeed.innerHTML = '';
      clipsFeed.appendChild(emptyHistoryState);
      return;
    }

    emptyHistoryState.classList.add('hidden');
    clipsFeed.innerHTML = '';

    clipHistory.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'clip-card bg-slate-800/60 hover:bg-slate-800/90 border border-slate-700/80 rounded-2xl p-4 transition shadow-sm flex flex-col gap-2.5';

      const isUrl = /^https?:\/\/[^\s]+$/i.test(item.text);
      const timeStr = formatRelativeTime(item.timestamp);

      card.innerHTML = `
        <div class="flex items-center justify-between text-xs text-slate-400">
          <div class="flex items-center gap-1.5">
            <span class="font-medium text-slate-300">${item.deviceType === 'mobile' ? '📱' : '💻'} ${escapeHtml(item.deviceName)}</span>
            ${item.encrypted ? '<span class="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.2 rounded font-mono">E2EE</span>' : ''}
          </div>
          <span class="text-[11px] text-slate-500">${timeStr}</span>
        </div>

        <div class="font-mono text-xs text-slate-200 break-all select-all max-h-28 overflow-y-auto bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
          ${escapeHtml(item.text)}
        </div>

        <div class="flex items-center justify-between gap-2 pt-1">
          <span class="text-[11px] text-slate-500 font-mono">${item.text.length} chars</span>
          <div class="flex items-center gap-2">
            ${isUrl ? `
              <a href="${escapeHtml(item.text)}" target="_blank" class="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-700/60 hover:bg-slate-700 text-indigo-300 transition flex items-center gap-1">
                <span>Open</span> ↗
              </a>
            ` : ''}
            <button data-index="${index}" class="btn-copy-history px-3 py-1 text-xs font-semibold rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white transition flex items-center gap-1">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
              <span>Copy</span>
            </button>
          </div>
        </div>
      `;

      // Copy button handler
      const copyBtn = card.querySelector('.btn-copy-history');
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(item.text);
          copyBtn.innerHTML = '<span>✓ Copied!</span>';
          copyBtn.classList.replace('bg-indigo-600/80', 'bg-emerald-600');
          setTimeout(() => {
            copyBtn.innerHTML = `
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
              <span>Copy</span>
            `;
            copyBtn.classList.replace('bg-emerald-600', 'bg-indigo-600/80');
          }, 1800);
        } catch (e) {
          showToast('Failed to copy to clipboard', 'error');
        }
      });

      clipsFeed.appendChild(card);
    });
  }

  // ==========================================
  // Audio & Notification
  // ==========================================
  function playChime() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1); // A5

      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } catch (e) {
      // AudioContext may be restricted until user gesture
    }
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    const colors = {
      info: 'bg-indigo-600 text-white border-indigo-500',
      success: 'bg-emerald-600 text-white border-emerald-500',
      warning: 'bg-amber-600 text-white border-amber-500',
      error: 'bg-rose-600 text-white border-rose-500'
    };

    toast.className = `px-4 py-2.5 rounded-xl border shadow-xl text-xs font-semibold transition-all transform duration-300 translate-y-2 opacity-0 flex items-center gap-2 ${colors[type] || colors.info}`;
    toast.textContent = message;

    container.appendChild(toast);
    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    });

    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  // ==========================================
  // QR Code & Network Pairing
  // ==========================================
  async function fetchServerStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      serverIps = data.localIps || [];

      networkIpSelect.innerHTML = '';
      const isCloud = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

      // If running on a cloud domain (Render, Railway, etc.), prioritize the public web URL
      if (isCloud || serverIps.length === 0) {
        const cloudOpt = document.createElement('option');
        cloudOpt.value = window.location.host;
        cloudOpt.textContent = `🌐 Cloud URL (${window.location.host})`;
        cloudOpt.selected = true;
        networkIpSelect.appendChild(cloudOpt);
      }

      // Add network interface IPs (for local Wi-Fi use)
      serverIps.forEach(net => {
        const opt = document.createElement('option');
        opt.value = `${net.ip}:${data.port}`;
        opt.textContent = `${net.interface} — ${net.ip}:${data.port}`;
        if (!isCloud && networkIpSelect.children.length === 0) {
          opt.selected = true;
        }
        networkIpSelect.appendChild(opt);
      });

      updateQrCode();
    } catch (e) {
      console.warn('Could not fetch server status:', e);
    }
  }

  function getPairUrl() {
    const host = networkIpSelect.value || window.location.host;
    const protocol = window.location.protocol;
    return `${protocol}//${host}/?room=${encodeURIComponent(currentRoom)}`;
  }

  function updateQrCode() {
    const container = document.getElementById('qrcodeContainer');
    container.innerHTML = '';
    const pairUrl = getPairUrl();

    if (window.QRCode) {
      qrcodeInstance = new QRCode(container, {
        text: pairUrl,
        width: 180,
        height: 180,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    }
  }

  // ==========================================
  // Event Listeners Setup
  // ==========================================
  function setupEvents() {
    // 1-Click Push Clipboard
    btnPushClipboard.addEventListener('click', pushSystemClipboard);

    // Send Manual Input
    btnSendText.addEventListener('click', () => {
      const val = manualTextInput.value.trim();
      if (val) {
        sendClipData(val);
        manualTextInput.value = '';
        charCount.textContent = '0 chars';
      }
    });

    // Enter to send in textarea (Shift+Enter for new line)
    manualTextInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        btnSendText.click();
      }
    });

    manualTextInput.addEventListener('input', () => {
      charCount.textContent = `${manualTextInput.value.length} chars`;
    });

    btnClearInput.addEventListener('click', () => {
      manualTextInput.value = '';
      charCount.textContent = '0 chars';
    });

    // Copy latest banner button
    btnCopyLatest.addEventListener('click', async () => {
      if (!latestClip) return;
      try {
        await navigator.clipboard.writeText(latestClip.text);
        copyLatestLabel.textContent = '✓ Copied!';
        btnCopyLatest.classList.add('bg-emerald-400');
        setTimeout(() => {
          copyLatestLabel.textContent = 'Copy to Clipboard';
        }, 2000);
      } catch (e) {
        showToast('Clipboard write failed', 'error');
      }
    });

    // Clear History
    btnClearHistory.addEventListener('click', () => {
      if (confirm('Clear all clips in this room for all connected devices?')) {
        socket.emit('request-clear');
      }
    });

    // Auto-sync focus listener
    window.addEventListener('focus', async () => {
      if (!isAutoSyncEnabled) return;
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          const text = await navigator.clipboard.readText();
          if (text && text.trim()) {
            // Check if it's already the latest clip
            const alreadyLatest = latestClip && latestClip.text === text.trim();
            if (!alreadyLatest) {
              await sendClipData(text);
            }
          }
        }
      } catch (e) {
        // Silent fail on unfocused permission
      }
    });

    toggleAutoSync.addEventListener('change', (e) => {
      isAutoSyncEnabled = e.target.checked;
      localStorage.setItem('clipsync_auto_sync', isAutoSyncEnabled);
      showToast(`Auto-Sync on focus ${isAutoSyncEnabled ? 'Enabled' : 'Disabled'}`);
    });

    toggleSound.addEventListener('change', (e) => {
      isSoundEnabled = e.target.checked;
      localStorage.setItem('clipsync_sound', isSoundEnabled);
    });

    // QR Code Modal
    btnOpenQr.addEventListener('click', () => {
      qrRoomCode.textContent = currentRoom;
      updateQrCode();
      qrModal.classList.remove('hidden');
    });

    btnCloseQrModal.addEventListener('click', () => {
      qrModal.classList.add('hidden');
    });

    networkIpSelect.addEventListener('change', updateQrCode);

    btnCopyPairUrl.addEventListener('click', async () => {
      const url = getPairUrl();
      try {
        await navigator.clipboard.writeText(url);
        copyPairUrlText.textContent = '✓ Copied URL!';
        setTimeout(() => copyPairUrlText.textContent = 'Copy Mobile URL', 2000);
      } catch (e) {
        prompt('Copy this URL to open on mobile:', url);
      }
    });

    // Settings Modal
    btnOpenSettings.addEventListener('click', () => {
      settingRoomInput.value = currentRoom;
      settingDeviceInput.value = defaultDeviceName;
      toggleE2EE.checked = isE2EEEnabled;
      settingPasswordInput.value = e2eePassword;
      settingsModal.classList.remove('hidden');
    });

    btnCloseSettingsModal.addEventListener('click', () => {
      settingsModal.classList.add('hidden');
    });

    btnGenerateRoom.addEventListener('click', () => {
      settingRoomInput.value = 'SYNC-' + Math.floor(1000 + Math.random() * 9000);
    });

    toggleE2EE.addEventListener('change', (e) => {
      if (e.target.checked) {
        e2eePasswordContainer.classList.remove('hidden');
      } else {
        e2eePasswordContainer.classList.add('hidden');
      }
    });

    btnSaveSettings.addEventListener('click', async () => {
      const newRoom = settingRoomInput.value.trim().toUpperCase() || currentRoom;
      const newDevice = settingDeviceInput.value.trim() || defaultDeviceName;
      isE2EEEnabled = toggleE2EE.checked;
      e2eePassword = settingPasswordInput.value.trim();

      localStorage.setItem('clipsync_room', newRoom);
      localStorage.setItem('clipsync_device_name', newDevice);
      localStorage.setItem('clipsync_e2ee', isE2EEEnabled);
      localStorage.setItem('clipsync_e2ee_pass', e2eePassword);

      currentRoom = newRoom;
      defaultDeviceName = newDevice;

      roomCodeText.textContent = currentRoom;
      qrRoomCode.textContent = currentRoom;

      if (isE2EEEnabled && e2eePassword) {
        await deriveCryptoKey(e2eePassword);
      } else {
        e2eeKey = null;
      }

      // Rejoin room
      socket.emit('join-room', {
        room: currentRoom,
        deviceName: defaultDeviceName,
        deviceType: isMobile ? 'mobile' : 'laptop'
      });

      settingsModal.classList.add('hidden');
      showToast('Settings saved & Room re-joined', 'success');
    });
  }

  // ==========================================
  // Utilities
  // ==========================================
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatRelativeTime(isoString) {
    if (!isoString) return '';
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 5) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(isoString).toLocaleDateString();
  }

  // Start app
  document.addEventListener('DOMContentLoaded', init);
})();
