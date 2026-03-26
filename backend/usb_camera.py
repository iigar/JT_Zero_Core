"""
USB Camera capture via persistent v4l2-ctl process.
Uses non-blocking pipe reads (select+os.read) to prevent hanging.
MJPEG preferred (preserves camera colors), YUYV fallback.
Architecture-safe: works on arm32/aarch64/x86.
"""

import os
import subprocess
import struct
import fcntl
import re
import time
import threading
import select

# V4L2 capability query
VIDIOC_QUERYCAP = 0x80685600
V4L2_CAP_VIDEO_CAPTURE = 0x00000001

WARMUP_FRAMES = 10  # Discard first N frames (capture card warm-up)


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


class USBCameraCapture:
    """USB camera with persistent v4l2-ctl and non-blocking reads."""

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
        self._process = None

    def open(self) -> bool:
        """Detect format, start persistent v4l2-ctl, warm-up, start reader thread."""
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

        # Start persistent v4l2-ctl (stream-count=0 = unlimited)
        if not self._start_process():
            return False

        # Warm-up: read and discard first N frames
        ok = self._warmup()
        if not ok:
            self._kill_process()
            print("[USBCam] Warm-up failed")
            return False

        print(f"[USBCam] Ready: {len(self._latest_frame)} bytes ({self.frame_format})")
        self._frame_count = 1
        self.streaming = True

        # Start non-blocking reader thread
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()
        print("[USBCam] Streaming started")
        return True

    def _start_process(self) -> bool:
        """Start v4l2-ctl with unbuffered output."""
        fmt = "MJPG" if self._use_mjpeg else "YUYV"
        try:
            cmd = [
                "stdbuf", "-o0",
                "v4l2-ctl", "--device", self.device,
                "--set-fmt-video", f"width={self.actual_w},height={self.actual_h},pixelformat={fmt}",
                "--stream-mmap", "--stream-count=0", "--stream-to=-"
            ]
            self._process = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
            )
            # Set pipe to non-blocking
            fd = self._process.stdout.fileno()
            os.set_blocking(fd, False)
            return True
        except Exception as e:
            print(f"[USBCam] Process start failed: {e}")
            return False

    def _read_available(self, timeout: float = 2.0) -> bytes:
        """Read available data from pipe using select (non-blocking)."""
        if not self._process or self._process.poll() is not None:
            return b''
        fd = self._process.stdout.fileno()
        ready, _, _ = select.select([fd], [], [], timeout)
        if not ready:
            return b''
        try:
            return os.read(fd, 65536)
        except (BlockingIOError, OSError):
            return b''

    def _warmup(self) -> bool:
        """Read and discard warm-up frames, keep first real one."""
        if self._use_mjpeg:
            return self._warmup_mjpeg()
        else:
            return self._warmup_yuyv()

    def _warmup_mjpeg(self) -> bool:
        """MJPEG warm-up: find complete JPEG frames, keep after WARMUP_FRAMES."""
        deadline = time.time() + 10.0
        buf = b''
        frames_found = 0
        while time.time() < deadline:
            chunk = self._read_available(1.0)
            if not chunk:
                continue
            buf += chunk
            while True:
                soi = buf.find(b'\xff\xd8')
                if soi < 0:
                    buf = b''
                    break
                eoi = buf.find(b'\xff\xd9', soi + 2)
                if eoi < 0:
                    buf = buf[soi:]
                    break
                frame = buf[soi:eoi + 2]
                buf = buf[eoi + 2:]
                frames_found += 1
                if frames_found >= WARMUP_FRAMES and len(frame) > 200:
                    self._latest_frame = frame
                    return True
        return len(self._latest_frame) > 200

    def _warmup_yuyv(self) -> bool:
        """YUYV warm-up."""
        deadline = time.time() + 10.0
        frame_size = self.actual_w * self.actual_h * 2
        buf = b''
        frames_found = 0
        while time.time() < deadline:
            chunk = self._read_available(1.0)
            if not chunk:
                continue
            buf += chunk
            while len(buf) >= frame_size:
                frames_found += 1
                yuyv_frame = buf[:frame_size]
                buf = buf[frame_size:]
                if frames_found >= WARMUP_FRAMES:
                    self._latest_frame = self._yuyv_to_gray(yuyv_frame)
                    return True
        return len(self._latest_frame) > 0

    def _read_loop(self):
        """Background: continuously read frames via non-blocking pipe."""
        if self._use_mjpeg:
            self._read_loop_mjpeg()
        else:
            self._read_loop_yuyv()
        # If we exit the loop, try restart
        if self.streaming:
            print("[USBCam] Reader exited, restarting...")
            self._restart()

    def _read_loop_mjpeg(self):
        """Parse MJPEG stream into individual JPEG frames."""
        buf = b''
        while self.streaming:
            if not self._process or self._process.poll() is not None:
                break
            chunk = self._read_available(1.0)
            if not chunk:
                continue
            buf += chunk
            # Prevent unbounded buffer growth
            if len(buf) > 500000:
                last_soi = buf.rfind(b'\xff\xd8')
                buf = buf[last_soi:] if last_soi >= 0 else b''
            # Extract complete JPEG frames
            while True:
                soi = buf.find(b'\xff\xd8')
                if soi < 0:
                    buf = b''
                    break
                eoi = buf.find(b'\xff\xd9', soi + 2)
                if eoi < 0:
                    buf = buf[soi:]
                    break
                frame = buf[soi:eoi + 2]
                buf = buf[eoi + 2:]
                if len(frame) > 200:
                    with self._lock:
                        self._latest_frame = frame
                        self._frame_count += 1

    def _read_loop_yuyv(self):
        """Read fixed-size YUYV frames."""
        frame_size = self.actual_w * self.actual_h * 2
        buf = b''
        while self.streaming:
            if not self._process or self._process.poll() is not None:
                break
            chunk = self._read_available(1.0)
            if not chunk:
                continue
            buf += chunk
            while len(buf) >= frame_size:
                gray = self._yuyv_to_gray(buf[:frame_size])
                buf = buf[frame_size:]
                with self._lock:
                    self._latest_frame = gray
                    self._frame_count += 1

    def _yuyv_to_gray(self, yuyv: bytes) -> bytes:
        """Extract Y channel."""
        n = self.actual_w * self.actual_h
        gray = bytearray(n)
        limit = min(n, len(yuyv) // 2)
        for i in range(limit):
            gray[i] = yuyv[i * 2]
        return bytes(gray)

    def _restart(self):
        """Restart v4l2-ctl process and reader thread."""
        self._kill_process()
        time.sleep(1)
        if self._start_process():
            if self._warmup():
                # Re-enter read loop in same thread
                if self._use_mjpeg:
                    self._read_loop_mjpeg()
                else:
                    self._read_loop_yuyv()

    def _kill_process(self):
        """Kill v4l2-ctl process."""
        if self._process:
            try:
                self._process.terminate()
                self._process.wait(timeout=3)
            except Exception:
                try:
                    self._process.kill()
                except Exception:
                    pass
            self._process = None

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
        self.streaming = False
        self._kill_process()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
