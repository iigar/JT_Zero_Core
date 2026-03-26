"""
USB Camera capture via v4l2-ctl subprocess.
Uses a SINGLE persistent v4l2-ctl process for continuous streaming.
MJPEG preferred (preserves colors), YUYV fallback.
Architecture-safe: no ioctl/struct for capture, works on arm32/aarch64/x86.
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
        for line in output.splitlines():
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
    """USB camera with persistent v4l2-ctl process for continuous MJPEG streaming."""

    def __init__(self, device: str, width: int = 256, height: int = 192):
        self.device = device
        self.req_width = width
        self.req_height = height
        self.actual_w = width
        self.actual_h = height
        self.frame_format = "jpeg"
        self.streaming = False
        self._card = ""
        self._latest_frame = b''
        self._frame_count = 0
        self._lock = threading.Lock()
        self._thread = None
        self._process = None

    def open(self) -> bool:
        """Detect format, start persistent v4l2-ctl process."""
        if not os.path.exists(self.device):
            print(f"[USBCam] Device {self.device} not found")
            return False

        formats = _query_formats(self.device)
        print(f"[USBCam] Available formats: {list(formats.keys())}")

        # Pick best format and resolution
        use_mjpeg = 'MJPG' in formats and formats['MJPG']
        if use_mjpeg:
            res_list = formats['MJPG']
            best = min(res_list, key=lambda r: abs(r[0] - self.req_width) + abs(r[1] - self.req_height))
            self.actual_w, self.actual_h = best
            self.frame_format = "jpeg"
        elif 'YUYV' in formats and formats['YUYV']:
            res_list = formats['YUYV']
            best = min(res_list, key=lambda r: abs(r[0] - self.req_width) + abs(r[1] - self.req_height))
            self.actual_w, self.actual_h = best
            self.frame_format = "gray"
        else:
            print("[USBCam] No supported formats found")
            return False

        fmt_name = "MJPG" if use_mjpeg else "YUYV"
        print(f"[USBCam] Selected: {fmt_name} {self.actual_w}x{self.actual_h}")

        # Start persistent v4l2-ctl process (stream-count=0 = unlimited)
        try:
            cmd = [
                "v4l2-ctl", "--device", self.device,
                "--set-fmt-video", f"width={self.actual_w},height={self.actual_h},pixelformat={fmt_name}",
                "--stream-mmap", "--stream-count=0", "--stream-to=-"
            ]
            self._process = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0
            )
            # Wait for warm-up: read and discard first few frames
            if use_mjpeg:
                ok = self._warmup_mjpeg()
            else:
                ok = self._warmup_yuyv()

            if not ok:
                self._kill_process()
                print("[USBCam] Warm-up failed")
                return False

            print(f"[USBCam] Stream ready: {len(self._latest_frame)} bytes ({self.frame_format})")
            self._frame_count = 1
            self.streaming = True

            # Background thread to continuously read frames
            self._thread = threading.Thread(target=self._read_loop, daemon=True)
            self._thread.start()
            print("[USBCam] Streaming thread started")
            return True

        except Exception as e:
            print(f"[USBCam] Failed to start stream: {e}")
            self._kill_process()
            return False

    def _warmup_mjpeg(self, warmup_frames=10, timeout=8.0) -> bool:
        """Read and discard initial black frames, keep first non-trivial frame."""
        deadline = time.time() + timeout
        buf = b''
        frames_read = 0
        while time.time() < deadline and frames_read < warmup_frames:
            chunk = self._process.stdout.read(4096)
            if not chunk:
                time.sleep(0.01)
                continue
            buf += chunk
            # Find complete JPEG frames (SOI=FFD8 ... EOI=FFD9)
            while True:
                soi = buf.find(b'\xff\xd8')
                if soi < 0:
                    buf = b''
                    break
                eoi = buf.find(b'\xff\xd9', soi + 2)
                if eoi < 0:
                    buf = buf[soi:]  # Keep partial frame
                    break
                frame = buf[soi:eoi + 2]
                buf = buf[eoi + 2:]
                frames_read += 1
                if len(frame) > 200:  # Non-trivial frame
                    self._latest_frame = frame
        return len(self._latest_frame) > 200

    def _warmup_yuyv(self, warmup_frames=5, timeout=5.0) -> bool:
        """Read initial YUYV frames for warm-up."""
        deadline = time.time() + timeout
        frame_size = self.actual_w * self.actual_h * 2
        frames_read = 0
        buf = b''
        while time.time() < deadline and frames_read < warmup_frames:
            need = frame_size - len(buf)
            chunk = self._process.stdout.read(need)
            if not chunk:
                time.sleep(0.01)
                continue
            buf += chunk
            if len(buf) >= frame_size:
                gray = self._yuyv_to_gray(buf[:frame_size])
                self._latest_frame = gray
                buf = buf[frame_size:]
                frames_read += 1
        return len(self._latest_frame) > 0

    def _read_loop(self):
        """Background thread: continuously read frames from persistent v4l2-ctl."""
        if self.frame_format == "jpeg":
            self._read_loop_mjpeg()
        else:
            self._read_loop_yuyv()

    def _read_loop_mjpeg(self):
        """Read MJPEG frames from stdout, split on JPEG markers."""
        buf = b''
        while self.streaming and self._process and self._process.poll() is None:
            try:
                chunk = self._process.stdout.read(8192)
                if not chunk:
                    time.sleep(0.01)
                    continue
                buf += chunk
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
            except Exception:
                time.sleep(0.1)
        # Process died — try restart
        if self.streaming:
            print("[USBCam] Stream process died, restarting...")
            self._restart_stream()

    def _read_loop_yuyv(self):
        """Read YUYV frames from stdout by fixed size."""
        frame_size = self.actual_w * self.actual_h * 2
        buf = b''
        while self.streaming and self._process and self._process.poll() is None:
            try:
                need = frame_size - len(buf)
                chunk = self._process.stdout.read(need)
                if not chunk:
                    time.sleep(0.01)
                    continue
                buf += chunk
                if len(buf) >= frame_size:
                    gray = self._yuyv_to_gray(buf[:frame_size])
                    buf = buf[frame_size:]
                    with self._lock:
                        self._latest_frame = gray
                        self._frame_count += 1
            except Exception:
                time.sleep(0.1)
        if self.streaming:
            print("[USBCam] Stream process died, restarting...")
            self._restart_stream()

    def _restart_stream(self):
        """Restart the v4l2-ctl process if it dies."""
        self._kill_process()
        time.sleep(1)
        try:
            fmt = "MJPG" if self.frame_format == "jpeg" else "YUYV"
            cmd = [
                "v4l2-ctl", "--device", self.device,
                "--set-fmt-video", f"width={self.actual_w},height={self.actual_h},pixelformat={fmt}",
                "--stream-mmap", "--stream-count=0", "--stream-to=-"
            ]
            self._process = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0
            )
            print("[USBCam] Stream restarted")
        except Exception as e:
            print(f"[USBCam] Restart failed: {e}")

    def _yuyv_to_gray(self, yuyv: bytes) -> bytes:
        """Extract Y channel from YUYV data."""
        n = self.actual_w * self.actual_h
        gray = bytearray(n)
        limit = min(n, len(yuyv) // 2)
        for i in range(limit):
            gray[i] = yuyv[i * 2]
        return bytes(gray)

    def capture_frame(self) -> bytes:
        """Return latest frame."""
        with self._lock:
            return self._latest_frame

    @property
    def frame_count(self) -> int:
        with self._lock:
            return self._frame_count

    def _kill_process(self):
        """Kill the v4l2-ctl process."""
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

    def close(self):
        """Stop streaming and kill process."""
        self.streaming = False
        self._kill_process()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)
