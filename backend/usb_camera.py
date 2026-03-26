"""
USB Camera capture via v4l2-ctl subprocess.
Batch capture: each grab reopens device (forces MS210x to produce fresh frame).
MJPEG format. Architecture-safe (arm32/aarch64/x86).
Detection via v4l2-ctl --list-devices (no ioctl).
"""

import os
import sys
import subprocess
import re
import time
import threading
import hashlib


def _log(msg: str):
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
        return None, None, None
    except Exception as e:
        _log(f"find error: {e}")
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


def _extract_last_jpeg(data: bytes) -> bytes:
    """Extract the LAST complete JPEG from concatenated MJPEG stream."""
    last = b''
    pos = 0
    while pos < len(data):
        soi = data.find(b'\xff\xd8', pos)
        if soi < 0:
            break
        eoi = data.find(b'\xff\xd9', soi + 2)
        if eoi < 0:
            break
        frame = data[soi:eoi + 2]
        if len(frame) > 500:
            last = frame
        pos = eoi + 2
    return last


class USBCameraCapture:
    """Batch capture: reopen device each time to force fresh analog frame."""

    def __init__(self, device: str, width: int = 640, height: int = 480):
        self.device = device
        self.actual_w = width
        self.actual_h = height
        self.frame_format = "jpeg"
        self.streaming = False
        self._latest_frame = b''
        self._frame_count = 0
        self._lock = threading.Lock()
        self._thread = None
        self._prev_hash = ''
        # Pre-build the v4l2-ctl command (reused every capture)
        self._cmd = None

    def open(self) -> bool:
        """Detect format, test capture, start streaming thread."""
        if not os.path.exists(self.device):
            _log(f"Device {self.device} not found")
            return False

        formats = _query_formats(self.device)
        _log(f"Formats: {formats}")

        if 'MJPG' not in formats or not formats['MJPG']:
            _log("No MJPEG support")
            return False

        res = formats['MJPG']
        if (640, 480) in res:
            self.actual_w, self.actual_h = 640, 480
        else:
            self.actual_w, self.actual_h = max(res, key=lambda r: r[0] * r[1])

        # Build reusable command (--stream-count=2: 1 warm-up + 1 real)
        self._cmd = [
            "v4l2-ctl", "--device", self.device,
            "--set-fmt-video", f"width={self.actual_w},height={self.actual_h},pixelformat=MJPG",
            "--stream-mmap", "--stream-count=2",
            "--stream-to=-"
        ]
        _log(f"Using MJPG {self.actual_w}x{self.actual_h}")

        # Test capture with more warm-up frames
        frame = self._grab(count=4)
        if not frame:
            _log("Test capture FAILED, retrying with 8 frames...")
            time.sleep(0.5)
            frame = self._grab(count=8)
        if not frame:
            _log("Test capture FAILED")
            return False

        _log(f"Test OK: {len(frame)}B")
        with self._lock:
            self._latest_frame = frame
            self._frame_count = 1
        self.streaming = True

        self._thread = threading.Thread(target=self._stream_loop, daemon=True)
        self._thread.start()
        _log("Streaming started")
        return True

    def _grab(self, count=2) -> bytes:
        """Single batch grab: open device, capture N frames, close, return last JPEG."""
        try:
            cmd = [
                "v4l2-ctl", "--device", self.device,
                "--set-fmt-video", f"width={self.actual_w},height={self.actual_h},pixelformat=MJPG",
                "--stream-mmap", f"--stream-count={count}",
                "--stream-to=-"
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=10)
            if not result.stdout:
                return b''
            return _extract_last_jpeg(result.stdout)
        except subprocess.TimeoutExpired:
            return b''
        except Exception:
            return b''

    def _stream_loop(self):
        """Background: rapid batch captures, no gap (device reopen forces fresh frame)."""
        _log("Stream loop started")
        fails = 0
        while self.streaming:
            t0 = time.time()
            frame = self._grab(count=2)
            dt = time.time() - t0

            if frame:
                h = hashlib.md5(frame).hexdigest()[:8]
                changed = h != self._prev_hash
                self._prev_hash = h

                with self._lock:
                    self._latest_frame = frame
                    self._frame_count += 1
                cnt = self._frame_count
                fails = 0

                # Log every 10th frame (or every changed frame for first 30)
                if cnt <= 30 or cnt % 10 == 0:
                    _log(f"#{cnt}: {len(frame)}B {dt:.2f}s hash={h} {'NEW' if changed else 'same'}")
            else:
                fails += 1
                if fails <= 3:
                    _log(f"Grab empty (fail #{fails}, {dt:.2f}s)")
                    time.sleep(0.3)
                else:
                    _log(f"Pausing 2s after {fails} failures")
                    time.sleep(2)
                    fails = 0

    def capture_frame(self) -> bytes:
        with self._lock:
            return self._latest_frame

    @property
    def frame_count(self) -> int:
        with self._lock:
            return self._frame_count

    def close(self):
        _log("Closing")
        self.streaming = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
