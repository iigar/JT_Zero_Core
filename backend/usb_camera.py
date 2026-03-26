"""
USB Camera capture via v4l2-ctl subprocess.
Each capture: batch of N frames (warm-up + real), keep last frame.
MJPEG preferred (preserves camera's native colors).
Architecture-safe: works on arm32/aarch64/x86.
Detection via v4l2-ctl --list-devices (no ioctl, reliable on aarch64).
"""

import os
import subprocess
import re
import time
import threading

# Warm-up frames per batch (capture card needs ~2-3 frames to sync)
BATCH_SIZE = 4
# Smaller batch for fast test capture during init
TEST_BATCH = 2


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
            # USB devices contain "usb-" in bus info; skip platform devices
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

    def __init__(self, device: str, width: int = 256, height: int = 192):
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

    def open(self) -> bool:
        """Detect format, test capture, start streaming thread."""
        if not os.path.exists(self.device):
            _log(f"Device {self.device} not found")
            return False

        formats = _query_formats(self.device)
        _log(f"Formats: {list(formats.keys())}")

        self._use_mjpeg = 'MJPG' in formats and formats['MJPG']
        if self._use_mjpeg:
            res = formats['MJPG']
            best = min(res, key=lambda r: abs(r[0] - self.req_width) + abs(r[1] - self.req_height))
            self.actual_w, self.actual_h = best
            self.frame_format = "jpeg"
        elif 'YUYV' in formats and formats['YUYV']:
            res = formats['YUYV']
            best = min(res, key=lambda r: abs(r[0] - self.req_width) + abs(r[1] - self.req_height))
            self.actual_w, self.actual_h = best
            self.frame_format = "gray"
        else:
            _log("No supported formats")
            return False

        fmt_name = "MJPG" if self._use_mjpeg else "YUYV"
        _log(f"Using {fmt_name} {self.actual_w}x{self.actual_h}, batch={BATCH_SIZE}")

        # Quick test capture (small batch for fast init)
        frame = self._capture_batch(count=TEST_BATCH)
        if not frame:
            _log("Test capture FAILED")
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
                capture_output=True, timeout=10
            )
            raw = result.stdout
            if not raw:
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
        """Background: continuously capture batches."""
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
                    if consecutive_fails > 5:
                        _log(f"Too many failures ({consecutive_fails}), pausing 2s")
                        time.sleep(2)
                        consecutive_fails = 0
            except Exception as e:
                _log(f"Stream error: {e}")
                time.sleep(1)

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


def _log(msg: str):
    """Print with flush for systemd journal visibility."""
    print(f"[USBCam] {msg}", flush=True)
