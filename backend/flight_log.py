"""
JT-Zero Encrypted Flight Log
═══════════════════════════════
Records telemetry, VO positions, feature points (point cloud) and system metrics
to encrypted files on SD card. Designed for post-flight analysis and 3D replay.

Security:
  - AES-256 encryption via Fernet (cryptography library)
  - Encryption key derived from user password via PBKDF2 (100k iterations)
  - Password stored as SHA-256 hash in config.json
  - API access requires password authentication

File format:
  - Each flight session → one .jtzlog file (encrypted JSON lines)
  - ~3-5 KB/s write rate (~10-18 MB/hour)
"""

import os
import sys
import json
import time
import hashlib
import base64
import struct
import threading
from datetime import datetime, timezone

# Encryption: try cryptography (Fernet/AES), fallback to basic XOR
try:
    from cryptography.fernet import Fernet
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False

LOG_DIR = os.path.expanduser("~/jt-zero/logs")
CONFIG_FILE = os.path.expanduser("~/jt-zero/config.json")
SALT = b"jtzero-flight-log-v1"  # fixed salt for key derivation


def _load_config():
    """Load config.json or return defaults."""
    try:
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    except Exception:
        return {}


def _save_config(cfg):
    """Save config.json."""
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, 'w') as f:
        json.dump(cfg, f, indent=2)


def hash_password(password: str) -> str:
    """Hash password with SHA-256 + salt for storage."""
    return hashlib.sha256((password + SALT.decode()).encode()).hexdigest()


def verify_password(password: str) -> bool:
    """Verify password against stored hash."""
    cfg = _load_config()
    stored_hash = cfg.get("log_password_hash")
    if not stored_hash:
        return False
    return hash_password(password) == stored_hash


def set_password(password: str):
    """Set new log access password."""
    cfg = _load_config()
    cfg["log_password_hash"] = hash_password(password)
    _save_config(cfg)


def is_password_set() -> bool:
    """Check if password has been configured."""
    cfg = _load_config()
    return bool(cfg.get("log_password_hash"))


def _derive_key(password: str) -> bytes:
    """Derive Fernet encryption key from password via PBKDF2."""
    if CRYPTO_AVAILABLE:
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=SALT,
            iterations=100_000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(password.encode()))
        return key
    else:
        # Fallback: SHA-256 based key
        return hashlib.sha256((password + SALT.decode()).encode()).digest()


def _encrypt_data(data: bytes, password: str) -> bytes:
    """Encrypt data with password-derived key."""
    if CRYPTO_AVAILABLE:
        key = _derive_key(password)
        f = Fernet(key)
        return f.encrypt(data)
    else:
        # Basic XOR fallback (not cryptographically strong)
        key = _derive_key(password)
        return bytes(b ^ key[i % len(key)] for i, b in enumerate(data))


def _decrypt_data(data: bytes, password: str) -> bytes:
    """Decrypt data with password-derived key."""
    if CRYPTO_AVAILABLE:
        key = _derive_key(password)
        f = Fernet(key)
        return f.decrypt(data)
    else:
        key = _derive_key(password)
        return bytes(b ^ key[i % len(key)] for i, b in enumerate(data))


class FlightLogger:
    """Records telemetry to encrypted log files."""

    def __init__(self, password: str = None):
        self._password = password
        self._running = False
        self._file = None
        self._filepath = None
        self._lock = threading.Lock()
        self._record_count = 0
        self._session_start = None
        self._last_record_time = 0
        self._record_interval = 0.5  # seconds between records
        self._pointcloud_interval = 1.0  # seconds between point cloud samples
        self._last_pointcloud_time = 0
        os.makedirs(LOG_DIR, exist_ok=True)

    def start_session(self):
        """Start a new flight log session."""
        if self._running:
            return
        now = datetime.now(timezone.utc)
        filename = f"flight_{now.strftime('%Y%m%d_%H%M%S')}.jtzlog"
        self._filepath = os.path.join(LOG_DIR, filename)
        self._file = open(self._filepath, 'ab')
        self._running = True
        self._record_count = 0
        self._session_start = time.time()

        # Write session header
        header = {
            "type": "session_start",
            "ts": now.isoformat(),
            "version": "1.0",
            "crypto": "fernet" if CRYPTO_AVAILABLE else "xor",
        }
        self._write_record(header)
        sys.stderr.write(f"[FlightLog] Session started: {filename}\n")
        sys.stderr.flush()

    def stop_session(self):
        """Stop and finalize current session."""
        if not self._running:
            return
        footer = {
            "type": "session_end",
            "ts": datetime.now(timezone.utc).isoformat(),
            "records": self._record_count,
            "duration_s": round(time.time() - self._session_start, 1),
        }
        self._write_record(footer)
        self._running = False
        if self._file:
            self._file.close()
            self._file = None
        sys.stderr.write(f"[FlightLog] Session ended: {self._record_count} records\n")
        sys.stderr.flush()

    def record_telemetry(self, runtime):
        """Record a telemetry snapshot (called from main loop ~10Hz, writes at 0.5s interval)."""
        if not self._running:
            return
        now = time.time()
        if now - self._last_record_time < self._record_interval:
            return
        self._last_record_time = now

        try:
            # Camera / VO data
            cam = {}
            try:
                cam = dict(runtime._rt.get_camera()) if hasattr(runtime, '_rt') else {}
            except Exception:
                pass

            # System metrics (lightweight — no psutil call, use cached)
            proc_cpu = 0
            proc_mem = 0
            try:
                import psutil
                proc = psutil.Process()
                proc_cpu = proc.cpu_percent()
                proc_mem = round(proc.memory_info().rss / (1024 * 1024), 1)
            except Exception:
                pass

            record = {
                "type": "telemetry",
                "t": round(now - self._session_start, 2),
                "vo": {
                    "x": round(runtime._vo_pos_x, 4) if hasattr(runtime, '_vo_pos_x') else 0,
                    "y": round(runtime._vo_pos_y, 4) if hasattr(runtime, '_vo_pos_y') else 0,
                    "z": round(runtime._vo_pos_z, 4) if hasattr(runtime, '_vo_pos_z') else 0,
                    "conf": round(cam.get('vo_confidence', 0), 3),
                    "dist": round(cam.get('vo_total_distance', 0), 3),
                    "bright": round(cam.get('frame_brightness', 0), 1),
                },
                "sys": {
                    "cpu": round(proc_cpu, 1),
                    "ram_mb": proc_mem,
                },
                "fb": 1 if getattr(runtime, '_vo_fallback_active', False) else 0,
            }
            self._write_record(record)

        except Exception as e:
            if not getattr(self, '_rec_err_logged', False):
                sys.stderr.write(f"[FlightLog] Record error: {e}\n")
                sys.stderr.flush()
                self._rec_err_logged = True

    def record_pointcloud(self, runtime):
        """Record feature points for 3D point cloud reconstruction."""
        if not self._running:
            return
        now = time.time()
        if now - self._last_pointcloud_time < self._pointcloud_interval:
            return
        self._last_pointcloud_time = now

        try:
            features = []
            if hasattr(runtime, 'get_features'):
                features = runtime.get_features()

            if not features:
                return

            # Get current orientation for 3D projection
            state = {}
            try:
                state = dict(runtime._rt.get_state()) if hasattr(runtime, '_rt') else {}
            except Exception:
                pass

            record = {
                "type": "pointcloud",
                "t": round(now - self._session_start, 2),
                "pose": {
                    "x": round(runtime._vo_pos_x, 4) if hasattr(runtime, '_vo_pos_x') else 0,
                    "y": round(runtime._vo_pos_y, 4) if hasattr(runtime, '_vo_pos_y') else 0,
                    "z": round(runtime._vo_pos_z, 4) if hasattr(runtime, '_vo_pos_z') else 0,
                    "roll": round(state.get('roll', 0), 3),
                    "pitch": round(state.get('pitch', 0), 3),
                    "yaw": round(state.get('yaw', 0), 3),
                },
                "pts": [
                    {"x": round(f.get("x", 0), 1), "y": round(f.get("y", 0), 1),
                     "r": f.get("response", 0), "t": 1 if f.get("tracked") else 0}
                    for f in features[:80]  # limit to 80 points per sample
                ],
            }
            self._write_record(record)

        except Exception:
            pass

    def record_event(self, event_type: str, message: str):
        """Record a discrete event (fallback, recovery, homepoint, etc.)."""
        if not self._running:
            return
        record = {
            "type": "event",
            "t": round(time.time() - self._session_start, 2) if self._session_start else 0,
            "event": event_type,
            "msg": message,
        }
        self._write_record(record)

    def _write_record(self, record: dict):
        """Encrypt and write a single JSON record."""
        with self._lock:
            if not self._file:
                return
            try:
                line = json.dumps(record, separators=(',', ':')).encode()
                if self._password:
                    encrypted = _encrypt_data(line, self._password)
                    # Write: 4-byte length prefix + encrypted data
                    self._file.write(struct.pack('<I', len(encrypted)))
                    self._file.write(encrypted)
                else:
                    # Unencrypted fallback (no password set)
                    self._file.write(line + b'\n')
                self._file.flush()
                self._record_count += 1
            except Exception as e:
                if not getattr(self, '_write_err_logged', False):
                    sys.stderr.write(f"[FlightLog] Write error: {e}\n")
                    sys.stderr.flush()
                    self._write_err_logged = True

    @property
    def is_recording(self):
        return self._running

    @property
    def session_file(self):
        return self._filepath

    @property
    def record_count(self):
        return self._record_count

    @staticmethod
    def list_sessions():
        """List all flight log files."""
        if not os.path.isdir(LOG_DIR):
            return []
        logs = []
        for f in sorted(os.listdir(LOG_DIR), reverse=True):
            if f.endswith('.jtzlog'):
                path = os.path.join(LOG_DIR, f)
                logs.append({
                    "filename": f,
                    "size_kb": round(os.path.getsize(path) / 1024, 1),
                    "created": datetime.fromtimestamp(
                        os.path.getctime(path), tz=timezone.utc
                    ).isoformat(),
                })
        return logs

    @staticmethod
    def read_session(filename: str, password: str) -> list:
        """Read and decrypt a flight log file. Returns list of records."""
        filepath = os.path.join(LOG_DIR, filename)
        if not os.path.isfile(filepath):
            return []

        records = []
        with open(filepath, 'rb') as f:
            data = f.read()

        if not data:
            return []

        # Detect format: encrypted (4-byte length prefix) or plaintext (newline-delimited)
        try:
            # Try encrypted format
            pos = 0
            while pos + 4 <= len(data):
                chunk_len = struct.unpack('<I', data[pos:pos + 4])[0]
                pos += 4
                if pos + chunk_len > len(data):
                    break
                chunk = data[pos:pos + chunk_len]
                pos += chunk_len
                try:
                    decrypted = _decrypt_data(chunk, password)
                    record = json.loads(decrypted)
                    records.append(record)
                except Exception:
                    # Wrong password or corrupted
                    return []
        except Exception:
            # Try plaintext format
            for line in data.decode(errors='ignore').strip().split('\n'):
                if line:
                    try:
                        records.append(json.loads(line))
                    except Exception:
                        pass

        return records
