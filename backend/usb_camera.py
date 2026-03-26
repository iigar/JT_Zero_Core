"""
USB Camera capture via v4l2-ctl subprocess.
Each capture grabs N frames (warm-up + real) and keeps the last one.
MJPEG format: preserves camera's native colors.
Architecture-safe: works on arm32/aarch64/x86.
"""

import os
import subprocess
import struct
import fcntl
import re
import time
import threading

# V4L2 capability query
VIDIOC_QUERYCAP = 0x80685600
V4L2_CAP_VIDEO_CAPTURE = 0x00000001

# How many frames per capture batch (first few are black "warm-up", last is real)
WARMUP_FRAMES = 8


def find_usb_camera():
    """Scan /dev/video* for USB cameras."""
    for i in range(10):
        path = f"/dev/video{i}"
        if not os.path.exists(path):
            continue
        try:
            fd = os.open(path, os.O_RDWR | os.O_NONBLOCK)
        except OSError:
            continue
        try:
            buf = bytearray(104)
            fcntl.ioctl(fd, VIDIOC_QUERYCAP, buf)
            driver = buf[0:16].split(b'\x00')[0].decode('utf-8', errors='ignore')
            card = buf[16:48].split(b'\x00')[0].decode('utf-8', errors='ignore')
            bus = buf[48:80].split(b'\x00')[0].decode('utf-8', errors='ignore')
            caps = struct.unpack_from('<I', buf, 84)[0]
            if ('uvc' in driver.lower() or 'usb' in bus.lower()) and (caps & V4L2_CAP_VIDEO_CAPTURE):
                os.close(fd)
                return path, card, driver
        except OSError:
            pass
        finally:
            try:
                os.close(fd)
            except:
                pass
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
    """Extract the LAST complete JPEG from a concatenated MJPEG stream."""
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
    """USB camera: batch capture with warm-up frames, keep last (real) frame."""

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
        """Detect format, do test capture with warm-up."""
        if not os.path.exists(self.device):
            print(f"[USBCam] Device {self.device} not found")
            return False

        formats = _query_formats(self.device)
        print(f"[USBCam] Formats: {list(formats.keys())}")

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
            print("[USBCam] No supported formats")
            return False

        fmt_name = "MJPG" if self._use_mjpeg else "YUYV"
        print(f"[USBCam] Using {fmt_name} {self.actual_w}x{self.actual_h}")

        # Test capture with warm-up
        frame = self._capture_batch()
        if not frame:
            print("[USBCam] Test capture failed")
            return False

        print(f"[USBCam] Test OK: {len(frame)} bytes ({self.frame_format})")
        with self._lock:
            self._latest_frame = frame
            self._frame_count = 1
        self.streaming = True

        self._thread = threading.Thread(target=self._stream_loop, daemon=True)
        self._thread.start()
        print("[USBCam] Streaming started")
        return True

    def _capture_batch(self) -> bytes:
        """Capture WARMUP_FRAMES frames, return the last one (real, not black)."""
        fmt = "MJPG" if self._use_mjpeg else "YUYV"
        try:
            result = subprocess.run(
                [
                    "v4l2-ctl", "--device", self.device,
                    "--set-fmt-video", f"width={self.actual_w},height={self.actual_h},pixelformat={fmt}",
                    "--stream-mmap", f"--stream-count={WARMUP_FRAMES}",
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
        except Exception as e:
            print(f"[USBCam] Capture error: {e}")
            return b''

    def _extract_last_yuyv(self, data: bytes) -> bytes:
        """Extract last YUYV frame and convert to grayscale."""
        frame_size = self.actual_w * self.actual_h * 2
        if len(data) < frame_size:
            return b''
        # Take the LAST complete frame
        num_frames = len(data) // frame_size
        offset = (num_frames - 1) * frame_size
        yuyv = data[offset:offset + frame_size]
        return self._yuyv_to_gray(yuyv)

    def _yuyv_to_gray(self, yuyv: bytes) -> bytes:
        """Extract Y channel from YUYV."""
        n = self.actual_w * self.actual_h
        gray = bytearray(n)
        limit = min(n, len(yuyv) // 2)
        for i in range(limit):
            gray[i] = yuyv[i * 2]
        return bytes(gray)

    def _stream_loop(self):
        """Continuously capture batches in background."""
        while self.streaming:
            try:
                frame = self._capture_batch()
                if frame:
                    with self._lock:
                        self._latest_frame = frame
                        self._frame_count += 1
            except Exception:
                pass
            # Small pause between batches
            time.sleep(0.05)

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
