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
    """USB camera capture using v4l2-ctl subprocess."""

    def __init__(self, device: str, width: int = 256, height: int = 192):
        self.device = device
        self.req_width = width
        self.req_height = height
        self.actual_w = width
        self.actual_h = height
        self.streaming = False
        self._card = ""

    def open(self) -> bool:
        """Verify device is accessible and query resolution."""
        # Verify device exists and is readable
        if not os.path.exists(self.device):
            print(f"[USBCam] Device {self.device} not found")
            return False

        # Query available formats
        resolutions = _query_formats(self.device)
        if resolutions:
            # Prefer closest to requested size
            best = min(resolutions, key=lambda r: abs(r[0] - self.req_width) + abs(r[1] - self.req_height))
            self.actual_w, self.actual_h = best
            print(f"[USBCam] Selected resolution: {self.actual_w}x{self.actual_h}")
        else:
            print(f"[USBCam] Cannot query formats, using {self.req_width}x{self.req_height}")
            self.actual_w = self.req_width
            self.actual_h = self.req_height

        # Test capture one frame
        try:
            result = subprocess.run(
                [
                    "v4l2-ctl", "--device", self.device,
                    "--set-fmt-video", f"width={self.actual_w},height={self.actual_h},pixelformat=YUYV",
                    "--stream-mmap", "--stream-count=1", "--stream-to=-"
                ],
                capture_output=True, timeout=10
            )
            expected = self.actual_w * self.actual_h * 2  # YUYV = 2 bytes/pixel
            if len(result.stdout) >= expected:
                self.streaming = True
                print(f"[USBCam] Test capture OK: {len(result.stdout)} bytes ({self.actual_w}x{self.actual_h} YUYV)")
                return True
            else:
                print(f"[USBCam] Test capture too small: {len(result.stdout)} bytes (expected {expected})")
                # Try without setting format (use camera default)
                result2 = subprocess.run(
                    [
                        "v4l2-ctl", "--device", self.device,
                        "--stream-mmap", "--stream-count=1", "--stream-to=-"
                    ],
                    capture_output=True, timeout=10
                )
                if len(result2.stdout) > 0:
                    # Guess dimensions from data size (YUYV)
                    total_bytes = len(result2.stdout)
                    # Common thermal resolutions
                    for w, h in [(256, 192), (384, 288), (320, 240), (640, 480), (160, 120)]:
                        if w * h * 2 == total_bytes:
                            self.actual_w, self.actual_h = w, h
                            break
                    self.streaming = True
                    print(f"[USBCam] Default capture OK: {total_bytes} bytes, guessed {self.actual_w}x{self.actual_h}")
                    return True
                print(f"[USBCam] Capture failed")
                return False
        except subprocess.TimeoutExpired:
            print(f"[USBCam] Test capture timeout")
            return False
        except FileNotFoundError:
            print(f"[USBCam] v4l2-ctl not found")
            return False
        except Exception as e:
            print(f"[USBCam] Test capture error: {e}")
            return False

    def capture_frame(self, timeout_sec: float = 5.0) -> bytes:
        """Capture one frame. Returns grayscale bytes (W*H) or empty bytes."""
        if not self.streaming:
            return b''
        try:
            result = subprocess.run(
                [
                    "v4l2-ctl", "--device", self.device,
                    "--stream-mmap", "--stream-count=1", "--stream-to=-"
                ],
                capture_output=True, timeout=timeout_sec
            )
            yuyv_data = result.stdout
            if not yuyv_data:
                return b''

            # YUYV → grayscale (Y channel = every 2nd byte starting at 0)
            n_pixels = self.actual_w * self.actual_h
            gray = bytearray(n_pixels)
            limit = min(n_pixels, len(yuyv_data) // 2)
            for i in range(limit):
                gray[i] = yuyv_data[i * 2]
            return bytes(gray)
        except subprocess.TimeoutExpired:
            return b''
        except Exception:
            return b''

    def close(self):
        """Nothing to close — subprocess-based capture."""
        self.streaming = False
