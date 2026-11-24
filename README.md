# 📋 ClipSync — Cross-Device Real-Time Clipboard Synchronization

Seamlessly synchronize your clipboard between your **Laptop** (Windows, macOS, Linux) and **Mobile Phone** (Android, iPhone / iOS).

> **Copy on Laptop → Instantly Paste on Phone**  
> **Copy on Phone → Instantly Paste on Laptop**

---

## ⚡ Quick Start (Run Locally)

### 1. Start the Server
Open a terminal in this directory (`clip-sync`) and run:
```bash
npm start
```
The server will start on port `3000` and display your local IP addresses:
```
======================================================
🚀 ClipSync Server is running on port 3000!
💻 Laptop Access:   http://localhost:3000
📱 Mobile Access:   http://192.168.1.15:3000
======================================================
```

### 2. Open on Laptop
Open `http://localhost:3000` in Chrome, Edge, Brave, or Firefox.

### 3. Connect Your Phone in 2 Seconds
1. Click the **Pair Mobile** button in the top-right corner on your laptop.
2. A **QR code** will appear on your laptop screen.
3. Open your mobile phone's Camera app and **scan the QR code** (make sure your phone is connected to the same Wi-Fi).
4. Tap the link to open the app on your phone.
5. **Both devices are now paired into the same private room!**

*(Tip: On your phone, tap your browser's share menu and select **"Add to Home Screen"** to install it as an app without going through the App Store!)*

---

## 🤖 100% Automatic Background Sync (Laptop Daemon)

If you don't want to keep a browser tab open, run the **Desktop Daemon**.  
With the daemon running:
- **Laptop → Mobile:** Whenever you press `Ctrl+C` anywhere on your laptop (VS Code, Word, Terminal, Browser, etc.), it is immediately beamed to your phone!
- **Mobile → Laptop:** Whenever you send or copy something on your phone, the daemon automatically updates your Windows/Mac clipboard, so you can just press `Ctrl+V` immediately!

### Option A: Python (Zero external dependencies on Windows)
```bash
python daemon/clip_daemon.py [YOUR_ROOM_CODE]
```
*(Example: `python daemon/clip_daemon.py SYNC-5432`)*

### Option B: Node.js
```bash
node daemon/clip_daemon.js [YOUR_ROOM_CODE]
```

---

## 🌐 Connecting Across Different Networks (Wi-Fi & Mobile 4G/5G)

If your laptop is on home Wi-Fi and your phone is on cellular data (4G/5G) or outside the house, use any of these free tunnels:

### Using Cloudflare Tunnels (Quickest & Free)
```bash
npx cloudflared tunnel --url http://localhost:3000
```
It gives you an `https://xxx.trycloudflare.com` URL that works anywhere in the world!

### Using Ngrok
```bash
ngrok http 3000
```

---

## 🔌 Complete REST API Reference

ClipSync exposes a clean, fast REST API alongside real-time WebSockets. This makes it effortless to integrate with **iOS Shortcuts**, **Android Tasker / Automate**, **cURL**, or custom scripts.

### 1. Push a New Clip
`POST /api/clip`

**Headers:** `Content-Type: application/json`

**Body:**
```json
{
  "room": "SYNC-1234",
  "text": "Hello from my mobile shortcut or script!",
  "deviceName": "iPhone 15",
  "deviceType": "mobile"
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/clip \
  -H "Content-Type: application/json" \
  -d '{"room":"SYNC-1234","text":"Copied text snippet","deviceName":"MyPhone"}'
```

**Response (201 Created):**
```json
{
  "success": true,
  "clip": {
    "id": "clip_1700000000000_abc123",
    "text": "Copied text snippet",
    "type": "text",
    "deviceName": "MyPhone",
    "deviceType": "mobile",
    "encrypted": false,
    "timestamp": "2026-11-24T09:30:00.000Z"
  }
}
```

---

### 2. Get Latest Clip
`GET /api/clip/latest?room=SYNC-1234`

**Response (200 OK):**
```json
{
  "room": "SYNC-1234",
  "latest": {
    "id": "clip_1700000000000_abc123",
    "text": "Copied text snippet",
    "deviceName": "MyPhone",
    "timestamp": "2026-11-24T09:30:00.000Z"
  }
}
```

---

### 3. Get Clip History
`GET /api/clip/history?room=SYNC-1234&limit=10`

**Response (200 OK):**
```json
{
  "room": "SYNC-1234",
  "count": 5,
  "clips": [ ... ]
}
```

---

### 4. Clear Room History
`DELETE /api/clip/history?room=SYNC-1234`

**Response (200 OK):**
```json
{
  "success": true,
  "message": "History cleared for room SYNC-1234"
}
```

---

### 5. Check Server Status & Local IP
`GET /api/status`

**Response (200 OK):**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "port": 3000,
  "localIps": [
    { "interface": "Wi-Fi", "ip": "192.168.1.15" }
  ],
  "activeRooms": 1
}
```

---

## 🔒 Security & Privacy (End-to-End Encryption)

ClipSync includes client-side **AES-256-GCM** encryption using the browser's native **Web Crypto API**:
- Enable **E2EE** in the settings modal and set a shared password.
- All text and clips are encrypted on your device with PBKDF2 + AES-GCM before transmission over the network or WebSocket.
- The server only relays and stores ciphertext. Neither the server nor any network observer can read your clipboard content!

---

## 📱 iOS Shortcut Setup (Optional 1-Tap Trigger)

On an iPhone:
1. Open the **Shortcuts** app and create a new Shortcut called "Sync to Laptop".
2. Add action: **Get Clipboard**.
3. Add action: **Get Contents of URL**:
   - URL: `http://<YOUR-IP>:3000/api/clip`
   - Method: `POST`
   - Request Body: JSON with `room` = `YOUR_ROOM`, `text` = `Clipboard`.
4. Now you can sync from your iPhone Action Button, Back Tap, or Control Center with 1 touch!
