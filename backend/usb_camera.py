"""
USB Camera capture for secondary (thermal) camera.
Uses v4l2-ctl subprocess — works on any architecture (arm32/arm64/x86).
"""
import os
import subprocess
import struct
import fcntl


# Only QUERYCAP is architecture-independent (fixed 104-byte struct)
VIDIOC_QUERYCAP = 0x80685600
V4L2_CAP_VIDEO_CAPTURE = 0x01


def find_usb_camera():
    """Scan /dev/video0..9 for USB UVC cameras. Returns (device_path, card_name, driver) or (None, None, None)."""
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
            driver = buf[0:16].split(b'\x00')[0].decode('ascii', errors='ignore')
            card = buf[16:48].split(b'\x00')[0].decode('ascii', errors='ignore')
            bus = buf[48:80].split(b'\x00')[0].decode('ascii', errors='ignore')
            caps = struct.unpack_from('<I', buf, 84)[0]
            if ('uvc' in driver.lower() or 'usb' in bus.lower()) and (caps & V4L2_CAP_VIDEO_CAPTURE):
                print(f"[USBCam] Found: {card} @ {path} (driver={driver})")
                return path, card, driver
        except OSError:
            pass
        finally:
            os.close(fd)
    return None, None, None


def _query_formats(device: str):
    """Query supported formats and pick best resolution for thermal."""
    try:
        result = subprocess.run(
            ["v4l2-ctl", "--device", device, "--list-formats-ext"],
            capture_output=True, text=True, timeout=5
        )
        # Parse output for resolutions
        lines = result.stdout.splitlines()
        resolutions = []
        for line in lines:
            line = line.strip()
            # Look for "Size: Discrete WxH"
            if 'Size:' in line and 'x' in line:
                parts = line.split()
                for p in parts:
                    if 'x' in p and p[0].isdigit():
                        try:
                            w, h = p.split('x')
                            resolutions.append((int(w), int(h)))
                        except ValueError:
                            pass
        return resolutions
    except Exception:
        return []


class USBCameraCapture:
    """USB camera capture using v4l2-ctl subprocess with continuous streaming."""

    def __init__(self, device: str, width: int = 256, height: int = 192):
        self.device = device
        self.req_width = width
        self.req_height = height
        self.actual_w = width
        self.actual_h = height
        self.streaming = False
        self._card = ""
        self._stream_proc = None
        self._latest_frame = b''
        self._frame_count = 0
        self._lock = None
        self._thread = None

    def open(self) -> bool:
        """Verify device, query resolution, start continuous streaming thread."""
        import threading
        if not os.path.exists(self.device):
            print(f"[USBCam] Device {self.device} not found")
            return False

        # Query available formats
        resolutions = _query_formats(self.device)
        if resolutions:
            best = min(resolutions, key=lambda r: abs(r[0] - self.req_width) + abs(r[1] - self.req_height))
            self.actual_w, self.actual_h = best
            print(f"[USBCam] Selected resolution: {self.actual_w}x{self.actual_h}")
        else:
            print(f"[USBCam] Cannot query formats, using {self.req_width}x{self.req_height}")

        # Test capture one frame to verify device works
        test_frame = self._capture_one()
        if not test_frame:
            print(f"[USBCam] Test capture failed")
            return False
        
        print(f"[USBCam] Test OK: {len(test_frame)} bytes")
        self._latest_frame = test_frame
        self._frame_count = 1
        self._lock = threading.Lock()
        self.streaming = True

        # Start continuous capture thread
        self._thread = threading.Thread(target=self._stream_loop, daemon=True)
        self._thread.start()
        print(f"[USBCam] Streaming thread started")
        return True

    def _capture_one(self) -> bytes:
        """Capture single frame via v4l2-ctl. Returns grayscale bytes or empty."""
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
                # Try without format setting
                result = subprocess.run(
                    ["v4l2-ctl", "--device", self.device,
                     "--stream-mmap", "--stream-count=1", "--stream-to=-"],
                    capture_output=True, timeout=5
                )
                yuyv = result.stdout
            if not yuyv:
                return b''
            # Auto-detect dimensions from data size if needed
            expected = self.actual_w * self.actual_h * 2
            if len(yuyv) != expected:
                for w, h in [(256, 192), (384, 288), (320, 240), (640, 480), (160, 120)]:
                    if w * h * 2 == len(yuyv):
                        self.actual_w, self.actual_h = w, h
                        break
            return self._yuyv_to_gray(yuyv)
        except Exception:
            return b''

    def _yuyv_to_gray(self, yuyv: bytes) -> bytes:
        """Convert YUYV to grayscale (Y channel only)."""
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
                # Capture batch of frames, keep last
                result = subprocess.run(
                    [
                        "v4l2-ctl", "--device", self.device,
                        "--stream-mmap", "--stream-count=1", "--stream-to=-"
                    ],
                    capture_output=True, timeout=5
                )
                if result.stdout:
                    frame = self._yuyv_to_gray(result.stdout)
                    if frame:
                        with self._lock:
                            self._latest_frame = frame
                            self._frame_count += 1
            except Exception:
                time.sleep(0.5)
            # ~5-10 fps depending on camera and USB bandwidth
            time.sleep(0.05)

    def capture_frame(self, timeout_sec: float = 5.0) -> bytes:
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
        if self._stream_proc:
            try:
                self._stream_proc.terminate()
            except Exception:
                pass
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)
