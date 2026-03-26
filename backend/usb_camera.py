"""
USB Camera capture via v4l2-ctl subprocess.
Each capture: batch of N frames (warm-up + real), keep last frame.
MJPEG preferred (preserves camera's native colors).
Architecture-safe: works on arm32/aarch64/x86.
Detection via v4l2-ctl --list-devices (no ioctl, reliable on aarch64).
"""

import os
import sys
import subprocess
import re
import time
import threading

# Warm-up frames per batch (capture card needs ~3 frames to produce real output)
BATCH_SIZE = 4
# Test capture batch (must be enough for warm-up; 4 is safe)
TEST_BATCH = 4
# Pause between batch captures (seconds) — gives USB device time to reset
CAPTURE_GAP = 0.5


def _log(msg: str):
    """Log to stderr so messages appear in systemd journal."""
    sys.stderr.write(f"[USBCam] {msg}\n")
    sys.stderr.flush()


def find_usb_camera():
    """Find USB camera by parsing v4l2-ctl --list-devices output.
    Works reliably on aarch64 (no Python ioctl needed)."""
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
        _log("v4l2-ctl --list-devices timed out (10s)")
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


def _extract_last_jpeg(data: bytes) -> bytes:
    """Extract the LAST complete JPEG from concatenated MJPEG stream."""
    last_frame = b''
    pos = 0
    while pos < len(data):
        soi = data.find(b'\xff\xd8', pos)
        if soi < 0:
            break
        eoi = data.find(b'\xff\xd9', soi + 2)
        if eoi < 0:
            break
        frame = data[soi:eoi + 2]
        if len(frame) > 200:
            last_frame = frame
        pos = eoi + 2
    return last_frame


class USBCameraCapture:
    """USB camera: batch capture with warm-up, keep last (real) frame."""

    def __init__(self, device: str, width: int = 640, height: int = 480):
        self.device = device
        self.req_width = width
        self.req_height = height
        self.actual_w = width
        self.actual_h = height
        self.frame_format = "jpeg"
        self._use_mjpeg = True
        self.streaming = False
        self._latest_frame = b''
        self._frame_count = 0
        self._lock = threading.Lock()
        self._thread = None
        self._formats = {}

    def open(self) -> bool:
        """Detect format, test capture, start streaming thread."""
        if not os.path.exists(self.device):
            _log(f"Device {self.device} not found")
            return False

        self._formats = _query_formats(self.device)
        _log(f"Formats: {self._formats}")

        self._use_mjpeg = 'MJPG' in self._formats and self._formats['MJPG']
        if self._use_mjpeg:
            res = self._formats['MJPG']
            # Prefer 640x480 if available (known reliable), else pick largest
            if (640, 480) in res:
                self.actual_w, self.actual_h = 640, 480
            else:
                best = max(res, key=lambda r: r[0] * r[1])
                self.actual_w, self.actual_h = best
            self.frame_format = "jpeg"
        elif 'YUYV' in self._formats and self._formats['YUYV']:
            res = self._formats['YUYV']
            best = max(res, key=lambda r: r[0] * r[1])
            self.actual_w, self.actual_h = best
            self.frame_format = "gray"
        else:
            _log("No supported formats")
            return False

        fmt_name = "MJPG" if self._use_mjpeg else "YUYV"
        _log(f"Using {fmt_name} {self.actual_w}x{self.actual_h}")

        # Test capture
        frame = self._capture_batch(count=TEST_BATCH)
        if not frame:
            _log("Test capture FAILED — trying larger batch")
            time.sleep(1)
            frame = self._capture_batch(count=8)
        if not frame:
            _log("Test capture FAILED after retry")
            return False

        _log(f"Test OK: {len(frame)} bytes ({self.frame_format})")
        with self._lock:
            self._latest_frame = frame
            self._frame_count = 1
        self.streaming = True

        self._thread = threading.Thread(target=self._stream_loop, daemon=True)
        self._thread.start()
        _log("Streaming started")
        return True

    def _capture_batch(self, count=None) -> bytes:
        """Capture N frames via v4l2-ctl, return the last one."""
        n = count or BATCH_SIZE
        fmt = "MJPG" if self._use_mjpeg else "YUYV"
        try:
            result = subprocess.run(
                [
                    "v4l2-ctl", "--device", self.device,
                    "--set-fmt-video", f"width={self.actual_w},height={self.actual_h},pixelformat={fmt}",
                    "--stream-mmap", f"--stream-count={n}",
                    "--stream-to=-"
                ],
                capture_output=True, timeout=15
            )
            raw = result.stdout
            if not raw:
                if result.returncode != 0:
                    _log(f"v4l2-ctl rc={result.returncode}: {result.stderr.decode(errors='ignore').strip()[:100]}")
                return b''
            if self._use_mjpeg:
                return _extract_last_jpeg(raw)
            else:
                return self._extract_last_yuyv(raw)
        except subprocess.TimeoutExpired:
            _log("Capture timeout")
            return b''
        except Exception as e:
            _log(f"Capture error: {e}")
            return b''

    def _extract_last_yuyv(self, data: bytes) -> bytes:
        """Extract last YUYV frame, convert to grayscale."""
        frame_size = self.actual_w * self.actual_h * 2
        if len(data) < frame_size:
            return b''
        num_frames = len(data) // frame_size
        offset = (num_frames - 1) * frame_size
        return self._yuyv_to_gray(data[offset:offset + frame_size])

    def _yuyv_to_gray(self, yuyv: bytes) -> bytes:
        """Extract Y channel from YUYV."""
        n = self.actual_w * self.actual_h
        gray = bytearray(n)
        limit = min(n, len(yuyv) // 2)
        for i in range(limit):
            gray[i] = yuyv[i * 2]
        return bytes(gray)

    def _stream_loop(self):
        """Background: continuously capture batches with gaps for device recovery."""
        _log("Stream loop started")
        consecutive_fails = 0
        while self.streaming:
            try:
                frame = self._capture_batch()
                if frame:
                    with self._lock:
                        self._latest_frame = frame
                        self._frame_count += 1
                    consecutive_fails = 0
                else:
                    consecutive_fails += 1
                    _log(f"Batch empty (fail #{consecutive_fails})")
                    if consecutive_fails > 3:
                        _log(f"Pausing 3s after {consecutive_fails} failures")
                        time.sleep(3)
                        consecutive_fails = 0
                    else:
                        time.sleep(1)
            except Exception as e:
                _log(f"Stream error: {e}")
                time.sleep(2)

            # Always pause between captures — USB capture cards need recovery time
            time.sleep(CAPTURE_GAP)

    def capture_frame(self) -> bytes:
        """Return latest frame."""
        with self._lock:
            return self._latest_frame

    @property
    def frame_count(self) -> int:
        with self._lock:
            return self._frame_count

    def close(self):
        """Stop streaming."""
        self.streaming = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
