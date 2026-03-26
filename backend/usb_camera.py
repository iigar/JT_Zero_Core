"""
USB Camera capture via persistent v4l2-ctl process.
MJPEG stream parsed in real-time from stdout pipe.
Architecture-safe: works on arm32/aarch64/x86.
Detection via v4l2-ctl --list-devices (no ioctl).
"""

import os
import sys
import subprocess
import re
import time
import threading


def _log(msg: str):
    """Log to stderr so messages appear in systemd journal."""
    sys.stderr.write(f"[USBCam] {msg}\n")
    sys.stderr.flush()


def find_usb_camera():
    """Find USB camera by parsing v4l2-ctl --list-devices output."""
    try:
        result = subprocess.run(
            ["v4l2-ctl", "--list-devices"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            _log(f"v4l2-ctl --list-devices failed: {result.stderr.strip()}")
            return None, None, None

        lines = result.stdout.splitlines()
        i = 0
        while i < len(lines):
            header = lines[i]
            if 'usb-' in header and 'platform:' not in header:
                name = header.split('(')[0].strip()
                i += 1
                while i < len(lines) and (lines[i].startswith('\t') or lines[i].startswith('  ')):
                    dev = lines[i].strip()
                    if dev.startswith('/dev/video'):
                        _log(f"Detected: {name} @ {dev}")
                        return dev, name, "usb"
                    i += 1
            else:
                i += 1

        _log("No USB camera in v4l2-ctl output")
        return None, None, None
    except subprocess.TimeoutExpired:
        _log("v4l2-ctl --list-devices timed out")
        return None, None, None
    except FileNotFoundError:
        _log("v4l2-ctl not installed")
        return None, None, None
    except Exception as e:
        _log(f"find_usb_camera error: {e}")
        return None, None, None


def _query_formats(device: str):
    """Query supported formats and resolutions."""
    try:
        result = subprocess.run(
            ["v4l2-ctl", "--device", device, "--list-formats-ext"],
            capture_output=True, text=True, timeout=5
        )
        formats = {}
        current_fmt = None
        for line in result.stdout.splitlines():
            fmt_match = re.search(r"'(\w+)'", line)
            if fmt_match and ('MJPG' in line or 'YUYV' in line or 'Pixel Format' in line):
                current_fmt = fmt_match.group(1)
            size_match = re.search(r'(\d+)x(\d+)', line)
            if size_match and current_fmt:
                w, h = int(size_match.group(1)), int(size_match.group(2))
                if current_fmt not in formats:
                    formats[current_fmt] = []
                if (w, h) not in formats[current_fmt]:
                    formats[current_fmt].append((w, h))
        return formats
    except Exception:
        return {}


class USBCameraCapture:
    """USB camera: persistent v4l2-ctl process with MJPEG stream parsing."""

    def __init__(self, device: str, width: int = 640, height: int = 480):
        self.device = device
        self.req_width = width
        self.req_height = height
        self.actual_w = width
        self.actual_h = height
        self.frame_format = "jpeg"
        self.streaming = False
        self._latest_frame = b''
        self._frame_count = 0
        self._lock = threading.Lock()
        self._proc = None
        self._reader_thread = None
        self._watchdog_thread = None
        self._last_frame_time = 0

    def open(self) -> bool:
        """Detect format, start persistent capture process."""
        if not os.path.exists(self.device):
            _log(f"Device {self.device} not found")
            return False

        formats = _query_formats(self.device)
        _log(f"Formats: {formats}")

        if 'MJPG' not in formats or not formats['MJPG']:
            _log("No MJPEG support — cannot stream")
            return False

        res = formats['MJPG']
        if (640, 480) in res:
            self.actual_w, self.actual_h = 640, 480
        else:
            best = max(res, key=lambda r: r[0] * r[1])
            self.actual_w, self.actual_h = best

        _log(f"Using MJPG {self.actual_w}x{self.actual_h}")

        # Start persistent process
        if not self._start_process():
            return False

        # Wait for first valid frame (warm-up)
        _log("Waiting for first frame (warm-up)...")
        deadline = time.time() + 8
        while time.time() < deadline:
            with self._lock:
                if self._frame_count >= 1 and len(self._latest_frame) > 500:
                    _log(f"First frame OK: {len(self._latest_frame)}B, count={self._frame_count}")
                    self.streaming = True
                    # Start watchdog
                    self._watchdog_thread = threading.Thread(target=self._watchdog_loop, daemon=True)
                    self._watchdog_thread.start()
                    return True
            time.sleep(0.1)

        _log("Timeout waiting for first frame")
        self._kill_process()
        return False

    def _start_process(self) -> bool:
        """Start v4l2-ctl persistent streaming process."""
        self._kill_process()
        try:
            cmd = [
                "v4l2-ctl", "--device", self.device,
                "--set-fmt-video", f"width={self.actual_w},height={self.actual_h},pixelformat=MJPG",
                "--stream-mmap", "--stream-count=0",
                "--stream-to=-"
            ]
            _log(f"Starting: {' '.join(cmd)}")
            self._proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0
            )
            self._last_frame_time = time.time()
            # Start reader thread
            self._reader_thread = threading.Thread(target=self._reader_loop, daemon=True)
            self._reader_thread.start()
            _log(f"Process started (PID {self._proc.pid})")
            return True
        except Exception as e:
            _log(f"Failed to start process: {e}")
            return False

    def _kill_process(self):
        """Kill the v4l2-ctl process if running."""
        if self._proc:
            try:
                self._proc.kill()
                self._proc.wait(timeout=3)
            except Exception:
                pass
            self._proc = None

    def _reader_loop(self):
        """Read MJPEG stream from v4l2-ctl stdout, parse frame boundaries."""
        _log("Reader thread started")
        buf = bytearray()
        proc = self._proc
        MAX_BUF = 2 * 1024 * 1024  # 2MB max buffer

        try:
            while proc and proc.poll() is None:
                # Read chunk from pipe (blocks until data available)
                chunk = proc.stdout.read(32768)
                if not chunk:
                    break
                buf.extend(chunk)

                # Prevent buffer overflow
                if len(buf) > MAX_BUF:
                    # Keep only last 500KB (should contain at least 1 frame)
                    buf = buf[-500000:]

                # Extract all complete JPEG frames from buffer
                while True:
                    soi = buf.find(b'\xff\xd8')
                    if soi < 0:
                        buf.clear()
                        break
                    # Discard data before SOI
                    if soi > 0:
                        buf = buf[soi:]
                        soi = 0

                    eoi = buf.find(b'\xff\xd9', 2)
                    if eoi < 0:
                        break  # Incomplete frame, wait for more data

                    # Complete JPEG frame: SOI to EOI+2
                    frame = bytes(buf[:eoi + 2])
                    buf = buf[eoi + 2:]

                    # Skip tiny frames (likely corrupt or warm-up)
                    if len(frame) > 500:
                        with self._lock:
                            self._latest_frame = frame
                            self._frame_count += 1
                            self._last_frame_time = time.time()
        except Exception as e:
            _log(f"Reader error: {e}")

        _log(f"Reader thread ended (proc alive: {proc.poll() is None if proc else 'N/A'})")

    def _watchdog_loop(self):
        """Restart process if no frames received for 5 seconds."""
        _log("Watchdog started")
        while self.streaming:
            time.sleep(2)
            with self._lock:
                elapsed = time.time() - self._last_frame_time
                count = self._frame_count

            if elapsed > 5:
                _log(f"Watchdog: no frame for {elapsed:.0f}s (count={count}), restarting process")
                self._start_process()

    def capture_frame(self) -> bytes:
        """Return latest frame."""
        with self._lock:
            return self._latest_frame

    @property
    def frame_count(self) -> int:
        with self._lock:
            return self._frame_count

    def close(self):
        """Stop streaming and kill process."""
        _log("Closing")
        self.streaming = False
        self._kill_process()
        if self._reader_thread and self._reader_thread.is_alive():
            self._reader_thread.join(timeout=3)
