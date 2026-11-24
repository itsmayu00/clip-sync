#!/usr/bin/env python3
"""
ClipSync Desktop Background Daemon
-----------------------------------
Runs silently in the background on your laptop (Windows, macOS, Linux).
- Automatic Copy: Whenever you copy text anywhere (Ctrl+C), it sends it to your mobile!
- Automatic Paste: Whenever your phone sends a clip, it places it in your OS clipboard so Ctrl+V works immediately!

Zero external dependencies required on Windows (uses built-in ctypes Win32 API and urllib).
"""

import sys
import time
import json
import urllib.request
import urllib.error
import urllib.parse
import os

# Config defaults
DEFAULT_SERVER = "http://localhost:3000"
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")


def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "server": DEFAULT_SERVER,
        "room": "SYNC-ROOM",
        "deviceName": "💻 Laptop Background Daemon",
        "pollIntervalSeconds": 0.8
    }


def save_config(cfg):
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        print(f"Failed to save config: {e}")


# ============================================================
# Cross-Platform Native OS Clipboard Access (Zero Extra Pip Packages)
# ============================================================

def get_os_clipboard():
    """Reads current clipboard text from OS without requiring external packages."""
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        CF_UNICODETEXT = 13
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        if not user32.OpenClipboard(None):
            return ""
        try:
            h_glb = user32.GetClipboardData(CF_UNICODETEXT)
            if not h_glb:
                return ""
            user32.CloseClipboard()
            user32.OpenClipboard(None)
            h_glb = user32.GetClipboardData(CF_UNICODETEXT)
            if not h_glb:
                return ""
            ptr = kernel32.GlobalLock(h_glb)
            if not ptr:
                return ""
            try:
                return ctypes.c_wchar_p(ptr).value or ""
            finally:
                kernel32.GlobalUnlock(h_glb)
        except Exception:
            return ""
        finally:
            user32.CloseClipboard()

    elif sys.platform == "darwin":  # macOS
        import subprocess
        try:
            p = subprocess.Popen(['pbpaste'], stdout=subprocess.PIPE)
            stdout, _ = p.communicate()
            return stdout.decode('utf-8')
        except Exception:
            return ""

    else:  # Linux (xclip / xsel)
        import subprocess
        for cmd in [['xclip', '-selection', 'clipboard', '-o'], ['xsel', '-b', '-o']]:
            try:
                p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                stdout, _ = p.communicate()
                return stdout.decode('utf-8')
            except Exception:
                continue
        return ""


def set_os_clipboard(text):
    """Sets current clipboard text in OS without requiring external packages."""
    if not text:
        return

    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        CF_UNICODETEXT = 13
        GMEM_MOVEABLE = 0x0002
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        encoded = text.encode('utf-16le') + b'\x00\x00'
        h_mem = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(encoded))
        if not h_mem:
            return

        ptr = kernel32.GlobalLock(h_mem)
        if not ptr:
            return

        ctypes.memmove(ptr, encoded, len(encoded))
        kernel32.GlobalUnlock(h_mem)

        if user32.OpenClipboard(None):
            user32.EmptyClipboard()
            user32.SetClipboardData(CF_UNICODETEXT, h_mem)
            user32.CloseClipboard()

    elif sys.platform == "darwin":  # macOS
        import subprocess
        p = subprocess.Popen(['pbcopy'], stdin=subprocess.PIPE)
        p.communicate(text.encode('utf-8'))

    else:  # Linux
        import subprocess
        for cmd in [['xclip', '-selection', 'clipboard'], ['xsel', '-b', '-i']]:
            try:
                p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
                p.communicate(text.encode('utf-8'))
                break
            except Exception:
                continue


# ============================================================
# API Sync Engine
# ============================================================

def push_to_server(server_url, room, text, device_name):
    """Pushes a local clip to the server so mobile receives it."""
    url = f"{server_url.rstrip('/')}/api/clip"
    payload = json.dumps({
        "room": room,
        "text": text,
        "deviceName": device_name,
        "deviceType": "laptop"
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "ClipSync-Daemon"}
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            return resp.status == 201
    except Exception as e:
        # Server unreachable or error
        return False


def get_latest_from_server(server_url, room):
    """Fetches the latest clip from the server room."""
    url = f"{server_url.rstrip('/')}/api/clip/latest?room={urllib.parse.quote(room)}"
    req = urllib.request.Request(url, headers={"User-Agent": "ClipSync-Daemon"})
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("latest")
    except Exception:
        return None


# ============================================================
# Main Loop
# ============================================================

def main():
    config = load_config()

    print("====================================================")
    print("   📋 ClipSync Desktop Background Daemon")
    print("====================================================")

    # Allow CLI arguments: python clip_daemon.py [ROOM_CODE] [SERVER_URL]
    if len(sys.argv) > 1:
        config["room"] = sys.argv[1].strip().upper()
    if len(sys.argv) > 2:
        config["server"] = sys.argv[2].strip()

    save_config(config)

    server = config["server"]
    room = config["room"]
    device_name = config.get("deviceName", "💻 Laptop Daemon")
    poll_sec = config.get("pollIntervalSeconds", 0.8)

    print(f"Connected to Room : {room}")
    print(f"Server URL        : {server}")
    print(f"Device Name       : {device_name}")
    print(f"Sync Interval     : {poll_sec}s")
    print("----------------------------------------------------")
    print("Running in background! Minimize this window.")
    print("• Anything you copy on this laptop (Ctrl+C) -> beams to Mobile")
    print("• Anything sent from your Mobile -> ready in Ctrl+V here")
    print("Press Ctrl+C to stop.\n")

    last_local_clip = get_os_clipboard()
    last_processed_server_id = None

    # Initial check on server's latest clip so we don't overwrite local clipboard on startup
    initial_server_clip = get_latest_from_server(server, room)
    if initial_server_clip:
        last_processed_server_id = initial_server_clip.get("id")

    while True:
        try:
            # 1. Check if user copied something new locally on Laptop
            current_local_clip = get_os_clipboard()
            if current_local_clip and current_local_clip != last_local_clip:
                last_local_clip = current_local_clip
                preview = (current_local_clip[:40] + '...') if len(current_local_clip) > 40 else current_local_clip
                print(f"[Laptop -> Mobile] Copied: {repr(preview)}")
                push_to_server(server, room, current_local_clip, device_name)

            # 2. Check if Mobile sent a new clip to server
            latest_server_clip = get_latest_from_server(server, room)
            if latest_server_clip and latest_server_clip.get("id") != last_processed_server_id:
                last_processed_server_id = latest_server_clip.get("id")
                incoming_text = latest_server_clip.get("text", "")
                sender = latest_server_clip.get("deviceName", "Remote")

                # If the incoming clip was sent by someone else (not ourselves)
                if incoming_text and incoming_text != last_local_clip:
                    last_local_clip = incoming_text
                    set_os_clipboard(incoming_text)
                    preview = (incoming_text[:40] + '...') if len(incoming_text) > 40 else incoming_text
                    print(f"[Mobile -> Laptop] Received from {sender}: {repr(preview)} -> Set to OS Clipboard!")

            time.sleep(poll_sec)

        except KeyboardInterrupt:
            print("\nClipSync Daemon stopped.")
            break
        except Exception as e:
            time.sleep(poll_sec * 2)


if __name__ == "__main__":
    main()
