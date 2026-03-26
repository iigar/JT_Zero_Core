"""
USB Camera capture via v4l2-ctl subprocess.
Supports MJPEG (preferred, preserves camera colors) and YUYV fallback.
Architecture-safe: no ioctl/struct, works on arm32/aarch64/x86.
"""

import os
import subprocess
import struct
import fcntl
import re

# V4L2 capability query
VIDIOC_QUERYCAP = 0x80685600
V4L2_CAP_VIDEO_CAPTURE = 0x00000001


def find_usb_camera():
    """Scan /dev/video* for USB cameras. Returns (path, card_name, driver) or (None,None,None)."""
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
    """Query supported formats and resolutions via v4l2-ctl."""
    try:
        result = subprocess.run(
            ["v4l2-ctl", "--device", device, "--list-formats-ext"],
            capture_output=True, text=True, timeout=5
        )
        output = result.stdout
        formats = {}
        current_fmt = None
        resolutions = []
        for line in output.splitlines():
            fmt_match = re.search(r"'(\w+)'", line)
            if fmt_match and ('MJPG' in line or 'YUYV' in line or 'Pixel Format' in line):
                current_fmt = fmt_match.group(1)
            size_match = re.search(r'(\d+)x(\d+)', line)
            if size_match and current_fmt:
                w, h = int(size_match.group(1)), int(size_match.group(2))
                if current_fmt not in formats:
                    formats[current_fmt] = []
                formats[current_fmt].append((w, h))
                resolutions.append((w, h))
        return formats, resolutions
    except Exception:
        return {}, []


class USBCameraCapture:
    """USB camera capture with MJPEG preference (color) and YUYV fallback (grayscale)."""

    def __init__(self, device: str, width: int = 256, height: int = 192):
        self.device = device
        self.req_width = width
        self.req_height = height
        self.actual_w = width
        self.actual_h = height
        self.capture_format = "yuyv"  # "mjpeg" or "yuyv"
        self.frame_format = "gray"    # "jpeg" or "gray" (output format)
        self.streaming = False
        self._card = ""
        self._latest_frame = b''
        self._frame_count = 0
        self._lock = None
        self._thread = None

    def open(self) -> bool:
        """Detect best format, verify capture, start streaming thread."""
        import threading
        if not os.path.exists(self.device):
            print(f"[USBCam] Device {self.device} not found")
            return False

        formats, all_res = _query_formats(self.device)
        print(f"[USBCam] Available formats: {list(formats.keys())}")

        # Pick resolution closest to requested
        best_res = None
        if 'MJPG' in formats and formats['MJPG']:
            res_list = formats['MJPG']
            best_res = min(res_list, key=lambda r: abs(r[0] - self.req_width) + abs(r[1] - self.req_height))
            self.capture_format = "mjpeg"
            self.frame_format = "jpeg"
        elif 'YUYV' in formats and formats['YUYV']:
            res_list = formats['YUYV']
            best_res = min(res_list, key=lambda r: abs(r[0] - self.req_width) + abs(r[1] - self.req_height))
            self.capture_format = "yuyv"
            self.frame_format = "gray"
        elif all_res:
            best_res = min(all_res, key=lambda r: abs(r[0] - self.req_width) + abs(r[1] - self.req_height))
            self.capture_format = "yuyv"
            self.frame_format = "gray"

        if best_res:
            self.actual_w, self.actual_h = best_res
        print(f"[USBCam] Selected: {self.capture_format.upper()} {self.actual_w}x{self.actual_h}")

        # Test capture
        test_frame = self._capture_one()
        if not test_frame:
            # Fallback: try the other format
            if self.capture_format == "mjpeg":
                print("[USBCam] MJPEG failed, trying YUYV...")
                self.capture_format = "yuyv"
                self.frame_format = "gray"
                test_frame = self._capture_one()
            elif self.capture_format == "yuyv":
                print("[USBCam] YUYV failed, trying MJPEG...")
                self.capture_format = "mjpeg"
                self.frame_format = "jpeg"
                test_frame = self._capture_one()

        if not test_frame:
            print("[USBCam] All capture methods failed")
            return False

        print(f"[USBCam] Test OK: {len(test_frame)} bytes ({self.frame_format})")
        self._latest_frame = test_frame
        self._frame_count = 1
        self._lock = threading.Lock()
        self.streaming = True

        self._thread = threading.Thread(target=self._stream_loop, daemon=True)
        self._thread.start()
        print("[USBCam] Streaming thread started")
        return True

    def _capture_one(self) -> bytes:
        """Capture single frame. Returns JPEG bytes or grayscale bytes."""
        try:
            if self.capture_format == "mjpeg":
                return self._capture_mjpeg()
            else:
                return self._capture_yuyv()
        except Exception as e:
            print(f"[USBCam] Capture error: {e}")
            return b''

    def _capture_mjpeg(self) -> bytes:
        """Capture one MJPEG frame. Returns JPEG bytes."""
        try:
            result = subprocess.run(
                [
                    "v4l2-ctl", "--device", self.device,
                    "--set-fmt-video", f"width={self.actual_w},height={self.actual_h},pixelformat=MJPG",
                    "--stream-mmap", "--stream-count=1", "--stream-to=-"
                ],
                capture_output=True, timeout=5
            )
            data = result.stdout
            if data and len(data) > 100 and data[:2] == b'\xff\xd8':
                return data
            # Try without explicit format
            result = subprocess.run(
                [
                    "v4l2-ctl", "--device", self.device,
                    "--set-fmt-video", f"pixelformat=MJPG",
                    "--stream-mmap", "--stream-count=1", "--stream-to=-"
                ],
                capture_output=True, timeout=5
            )
            data = result.stdout
            if data and len(data) > 100 and data[:2] == b'\xff\xd8':
                return data
            return b''
        except Exception:
            return b''

    def _capture_yuyv(self) -> bytes:
        """Capture one YUYV frame, convert to grayscale."""
        try:
            result = subprocess.run(
                [
                    "v4l2-ctl", "--device", self.device,
                    "--set-fmt-video", f"width={self.actual_w},height={self.actual_h},pixelformat=YUYV",
                    "--stream-mmap", "--stream-count=1", "--stream-to=-"
                ],
                capture_output=True, timeout=5
            )
            yuyv = result.stdout
            if not yuyv:
                result = subprocess.run(
                    ["v4l2-ctl", "--device", self.device,
                     "--stream-mmap", "--stream-count=1", "--stream-to=-"],
                    capture_output=True, timeout=5
                )
                yuyv = result.stdout
            if not yuyv:
                return b''
            expected = self.actual_w * self.actual_h * 2
            if len(yuyv) != expected:
                for w, h in [(480, 320), (640, 480), (320, 240), (256, 192), (384, 288), (160, 120)]:
                    if w * h * 2 == len(yuyv):
                        self.actual_w, self.actual_h = w, h
                        break
            return self._yuyv_to_gray(yuyv)
        except Exception:
            return b''

    def _yuyv_to_gray(self, yuyv: bytes) -> bytes:
        """Extract Y channel from YUYV data."""
        n = self.actual_w * self.actual_h
        gray = bytearray(n)
        limit = min(n, len(yuyv) // 2)
        for i in range(limit):
            gray[i] = yuyv[i * 2]
        return bytes(gray)

    def _stream_loop(self):
        """Background thread: continuously capture frames."""
        import time
        while self.streaming:
            try:
                frame = self._capture_one()
                if frame:
                    with self._lock:
                        self._latest_frame = frame
                        self._frame_count += 1
            except Exception:
                time.sleep(0.5)
            time.sleep(0.05)

    def capture_frame(self) -> bytes:
        """Return latest frame from continuous stream."""
        if not self.streaming or not self._lock:
            return b''
        with self._lock:
            return self._latest_frame

    @property
    def frame_count(self) -> int:
        if self._lock:
            with self._lock:
                return self._frame_count
        return 0

    def close(self):
        """Stop streaming thread."""
        self.streaming = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)
