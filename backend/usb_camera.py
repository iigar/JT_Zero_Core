"""
USB Camera V4L2 capture for secondary (thermal) camera.
Pure Python implementation using fcntl + mmap — no external dependencies.
"""
import os
import struct
import fcntl
import mmap
import ctypes
import select
import time

# V4L2 ioctl constants
VIDIOC_QUERYCAP = 0x80685600
VIDIOC_S_FMT = 0xC0D05605
VIDIOC_G_FMT = 0xC0D05604
VIDIOC_REQBUFS = 0xC0145608
VIDIOC_QUERYBUF = 0xC0445609
VIDIOC_QBUF = 0xC044560F
VIDIOC_DQBUF = 0xC0445611
VIDIOC_STREAMON = 0x40045612
VIDIOC_STREAMOFF = 0x40045613

V4L2_BUF_TYPE_VIDEO_CAPTURE = 1
V4L2_MEMORY_MMAP = 1
V4L2_PIX_FMT_YUYV = 0x56595559  # 'YUYV'

# Struct sizes (aarch64)
V4L2_CAPABILITY_SIZE = 104
V4L2_FORMAT_SIZE = 208
V4L2_REQUESTBUFFERS_SIZE = 20
V4L2_BUFFER_SIZE = 68


def find_usb_camera():
    """Scan /dev/video0..9 for USB UVC cameras. Returns device path or None."""
    for i in range(10):
        path = f"/dev/video{i}"
        if not os.path.exists(path):
            continue
        try:
            fd = os.open(path, os.O_RDWR)
        except OSError:
            continue
        try:
            # VIDIOC_QUERYCAP
            buf = bytearray(V4L2_CAPABILITY_SIZE)
            try:
                fcntl.ioctl(fd, VIDIOC_QUERYCAP, buf)
            except OSError:
                continue
            driver = buf[0:16].split(b'\x00')[0].decode('ascii', errors='ignore')
            card = buf[16:48].split(b'\x00')[0].decode('ascii', errors='ignore')
            bus = buf[48:80].split(b'\x00')[0].decode('ascii', errors='ignore')
            caps = struct.unpack_from('<I', buf, 84)[0]
            # Check for USB camera with video capture capability
            if ('uvc' in driver.lower() or 'usb' in bus.lower()) and (caps & 0x01):
                print(f"[USBCam-Py] Found: {card} @ {path} (driver={driver})")
                return path, card, driver
        finally:
            os.close(fd)
    return None, None, None


class USBCameraCapture:
    """Simple V4L2 MMAP capture for USB cameras."""
    
    def __init__(self, device: str, width: int = 256, height: int = 192):
        self.device = device
        self.req_width = width
        self.req_height = height
        self.fd = -1
        self.buffers = []
        self.actual_w = 0
        self.actual_h = 0
        self.streaming = False
        self._card = ""
    
    def open(self) -> bool:
        """Open device, set format, allocate MMAP buffers, start streaming."""
        try:
            self.fd = os.open(self.device, os.O_RDWR)
        except OSError as e:
            print(f"[USBCam-Py] Cannot open {self.device}: {e}")
            return False
        
        # Query capabilities
        cap_buf = bytearray(V4L2_CAPABILITY_SIZE)
        try:
            fcntl.ioctl(self.fd, VIDIOC_QUERYCAP, cap_buf)
            self._card = cap_buf[16:48].split(b'\x00')[0].decode('ascii', errors='ignore')
        except OSError:
            pass
        
        # Set format: YUYV at requested resolution
        fmt = bytearray(V4L2_FORMAT_SIZE)
        struct.pack_into('<I', fmt, 0, V4L2_BUF_TYPE_VIDEO_CAPTURE)
        struct.pack_into('<I', fmt, 4, self.req_width)
        struct.pack_into('<I', fmt, 8, self.req_height)
        struct.pack_into('<I', fmt, 12, V4L2_PIX_FMT_YUYV)
        
        try:
            fcntl.ioctl(self.fd, VIDIOC_S_FMT, fmt)
        except OSError as e:
            print(f"[USBCam-Py] S_FMT failed: {e}")
        
        # Read back actual format
        try:
            fcntl.ioctl(self.fd, VIDIOC_G_FMT, fmt)
            self.actual_w = struct.unpack_from('<I', fmt, 4)[0]
            self.actual_h = struct.unpack_from('<I', fmt, 8)[0]
            print(f"[USBCam-Py] Format: {self.actual_w}x{self.actual_h} YUYV")
        except OSError:
            self.actual_w = self.req_width
            self.actual_h = self.req_height
        
        # Request MMAP buffers
        reqbuf = bytearray(V4L2_REQUESTBUFFERS_SIZE)
        struct.pack_into('<I', reqbuf, 0, 4)  # count=4
        struct.pack_into('<I', reqbuf, 4, V4L2_BUF_TYPE_VIDEO_CAPTURE)
        struct.pack_into('<I', reqbuf, 8, V4L2_MEMORY_MMAP)
        
        try:
            fcntl.ioctl(self.fd, VIDIOC_REQBUFS, reqbuf)
        except OSError as e:
            print(f"[USBCam-Py] REQBUFS failed: {e}")
            self.close()
            return False
        
        n_buffers = struct.unpack_from('<I', reqbuf, 0)[0]
        
        # Query and MMAP each buffer
        self.buffers = []
        for i in range(n_buffers):
            qbuf = bytearray(V4L2_BUFFER_SIZE)
            struct.pack_into('<I', qbuf, 0, i)  # index
            struct.pack_into('<I', qbuf, 4, V4L2_BUF_TYPE_VIDEO_CAPTURE)
            struct.pack_into('<I', qbuf, 8, V4L2_MEMORY_MMAP)
            
            try:
                fcntl.ioctl(self.fd, VIDIOC_QUERYBUF, qbuf)
            except OSError as e:
                print(f"[USBCam-Py] QUERYBUF {i} failed: {e}")
                continue
            
            length = struct.unpack_from('<I', qbuf, 12)[0]  # bytesused or length
            offset = struct.unpack_from('<I', qbuf, 56)[0]  # m.offset
            
            # Use length field at offset 16 if bytesused=0
            if length == 0:
                length = struct.unpack_from('<I', qbuf, 16)[0]
            
            try:
                mm = mmap.mmap(self.fd, length, offset=offset)
                self.buffers.append((mm, length))
            except OSError as e:
                print(f"[USBCam-Py] mmap {i} failed: {e}")
                continue
            
            # Queue buffer
            try:
                fcntl.ioctl(self.fd, VIDIOC_QBUF, qbuf)
            except OSError as e:
                print(f"[USBCam-Py] QBUF {i} failed: {e}")
        
        if not self.buffers:
            print("[USBCam-Py] No buffers allocated")
            self.close()
            return False
        
        # Start streaming
        buf_type = struct.pack('<I', V4L2_BUF_TYPE_VIDEO_CAPTURE)
        try:
            fcntl.ioctl(self.fd, VIDIOC_STREAMON, buf_type)
            self.streaming = True
            print(f"[USBCam-Py] Streaming started ({len(self.buffers)} buffers)")
        except OSError as e:
            print(f"[USBCam-Py] STREAMON failed: {e}")
            self.close()
            return False
        
        return True
    
    def capture_frame(self, timeout_sec: float = 2.0) -> bytes:
        """Capture one frame. Returns grayscale bytes (W*H) or empty bytes."""
        if self.fd < 0 or not self.streaming:
            return b''
        
        # Wait for frame
        r, _, _ = select.select([self.fd], [], [], timeout_sec)
        if not r:
            print("[USBCam-Py] select() timeout")
            return b''
        
        # Dequeue buffer
        dqbuf = bytearray(V4L2_BUFFER_SIZE)
        struct.pack_into('<I', dqbuf, 4, V4L2_BUF_TYPE_VIDEO_CAPTURE)
        struct.pack_into('<I', dqbuf, 8, V4L2_MEMORY_MMAP)
        
        try:
            fcntl.ioctl(self.fd, VIDIOC_DQBUF, dqbuf)
        except OSError as e:
            print(f"[USBCam-Py] DQBUF failed: {e}")
            return b''
        
        idx = struct.unpack_from('<I', dqbuf, 0)[0]
        bytesused = struct.unpack_from('<I', dqbuf, 12)[0]
        
        if idx >= len(self.buffers):
            return b''
        
        # Read YUYV data
        mm, length = self.buffers[idx]
        mm.seek(0)
        yuyv_data = mm.read(bytesused if bytesused > 0 else length)
        
        # Re-queue buffer
        try:
            fcntl.ioctl(self.fd, VIDIOC_QBUF, dqbuf)
        except OSError:
            pass
        
        # YUYV → grayscale (Y channel only, every 2 bytes)
        gray = bytearray(self.actual_w * self.actual_h)
        n_pixels = min(len(gray), len(yuyv_data) // 2)
        for i in range(n_pixels):
            gray[i] = yuyv_data[i * 2]
        
        return bytes(gray)
    
    def close(self):
        """Stop streaming and release resources."""
        if self.streaming:
            buf_type = struct.pack('<I', V4L2_BUF_TYPE_VIDEO_CAPTURE)
            try:
                fcntl.ioctl(self.fd, VIDIOC_STREAMOFF, buf_type)
            except OSError:
                pass
            self.streaming = False
        
        for mm, _ in self.buffers:
            try:
                mm.close()
            except Exception:
                pass
        self.buffers = []
        
        if self.fd >= 0:
            os.close(self.fd)
            self.fd = -1
    
    def __del__(self):
        self.close()
