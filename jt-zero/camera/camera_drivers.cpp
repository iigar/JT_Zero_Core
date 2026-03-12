/**
 * JT-Zero Real Camera Driver Implementations
 * 
 * PiCSICamera: Raspberry Pi Camera Module via libcamera/V4L2
 * USBCamera:   Generic USB webcam via V4L2
 * 
 * Both drivers capture frames in YUYV or grayscale format,
 * convert to 320x240 grayscale for the VO pipeline.
 * 
 * Auto-detection flow:
 *   1. Check /dev/video0 for CSI camera
 *   2. Check /dev/video1+ for USB cameras
 *   3. Fall back to simulated camera
 */

#include "jt_zero/camera.h"
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/stat.h>

// V4L2 headers (Linux only)
#ifdef __linux__
#include <linux/videodev2.h>
#endif

namespace jtzero {

// ═══════════════════════════════════════════════════════════
// Pi CSI Camera (libcamera/V4L2)
// ═══════════════════════════════════════════════════════════

bool PiCSICamera::detect() {
#ifdef __linux__
    // Check if /dev/video0 exists (CSI camera creates this via libcamera)
    struct stat st;
    if (stat("/dev/video0", &st) == 0 && S_ISCHR(st.st_mode)) {
        // Verify it's a CSI camera by checking driver name
        int fd = ::open("/dev/video0", O_RDWR);
        if (fd < 0) return false;
        
        struct v4l2_capability cap;
        if (ioctl(fd, VIDIOC_QUERYCAP, &cap) == 0) {
            ::close(fd);
            // libcamera bridge driver or bcm2835-v4l2
            if (strstr(reinterpret_cast<const char*>(cap.driver), "bcm") ||
                strstr(reinterpret_cast<const char*>(cap.driver), "unicam") ||
                strstr(reinterpret_cast<const char*>(cap.driver), "libcamera")) {
                std::printf("[Camera] CSI camera detected: %s (%s)\n", cap.card, cap.driver);
                return true;
            }
        }
        ::close(fd);
    }
#endif
    return false;
}

bool PiCSICamera::open() {
#ifdef __linux__
    fd_ = ::open("/dev/video0", O_RDWR);
    if (fd_ < 0) {
        std::printf("[PiCSI] Failed to open /dev/video0\n");
        return false;
    }
    
    // Set format: 320x240 grayscale (or YUYV which we'll convert)
    struct v4l2_format fmt{};
    fmt.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    fmt.fmt.pix.width = FRAME_WIDTH;
    fmt.fmt.pix.height = FRAME_HEIGHT;
    fmt.fmt.pix.pixelformat = V4L2_PIX_FMT_GREY;
    fmt.fmt.pix.field = V4L2_FIELD_NONE;
    
    if (ioctl(fd_, VIDIOC_S_FMT, &fmt) < 0) {
        // Try YUYV fallback (more widely supported)
        fmt.fmt.pix.pixelformat = V4L2_PIX_FMT_YUYV;
        if (ioctl(fd_, VIDIOC_S_FMT, &fmt) < 0) {
            std::printf("[PiCSI] Failed to set capture format\n");
            close();
            return false;
        }
    }
    
    // Request buffer (single buffer, mmap)
    struct v4l2_requestbuffers req{};
    req.count = 1;
    req.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    req.memory = V4L2_MEMORY_MMAP;
    
    if (ioctl(fd_, VIDIOC_REQBUFS, &req) < 0) {
        std::printf("[PiCSI] Failed to request buffers\n");
        close();
        return false;
    }
    
    // Map buffer
    struct v4l2_buffer buf{};
    buf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    buf.memory = V4L2_MEMORY_MMAP;
    buf.index = 0;
    
    if (ioctl(fd_, VIDIOC_QUERYBUF, &buf) < 0) {
        close();
        return false;
    }
    
    mmap_len_ = buf.length;
    mmap_buf_ = static_cast<uint8_t*>(mmap(nullptr, mmap_len_, 
                                            PROT_READ | PROT_WRITE,
                                            MAP_SHARED, fd_, buf.m.offset));
    if (mmap_buf_ == MAP_FAILED) {
        mmap_buf_ = nullptr;
        close();
        return false;
    }
    
    // Queue buffer and start streaming
    if (ioctl(fd_, VIDIOC_QBUF, &buf) < 0) {
        close();
        return false;
    }
    
    enum v4l2_buf_type stream_type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    if (ioctl(fd_, VIDIOC_STREAMON, &stream_type) < 0) {
        close();
        return false;
    }
    
    open_ = true;
    frame_counter_ = 0;
    last_capture_us_ = now_us();
    std::printf("[PiCSI] Camera opened: %ux%u\n", FRAME_WIDTH, FRAME_HEIGHT);
    return true;
#else
    return false;
#endif
}

bool PiCSICamera::capture(FrameBuffer& frame) {
#ifdef __linux__
    if (!open_ || fd_ < 0) return false;
    
    struct v4l2_buffer buf{};
    buf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    buf.memory = V4L2_MEMORY_MMAP;
    
    // Dequeue (get filled buffer)
    if (ioctl(fd_, VIDIOC_DQBUF, &buf) < 0) return false;
    
    // Copy data to our fixed-size frame buffer (convert YUYV→gray if needed)
    size_t copy_len = (buf.bytesused < FRAME_SIZE) ? buf.bytesused : FRAME_SIZE;
    std::memcpy(frame.data, mmap_buf_, copy_len);
    
    uint64_t current_us = now_us();
    float dt = static_cast<float>(current_us - last_capture_us_) / 1'000'000.0f;
    
    frame.info.timestamp_us = current_us;
    frame.info.frame_id = frame_counter_++;
    frame.info.width = FRAME_WIDTH;
    frame.info.height = FRAME_HEIGHT;
    frame.info.channels = 1;
    frame.info.fps_actual = (dt > 0) ? (1.0f / dt) : 0;
    frame.info.valid = true;
    
    last_capture_us_ = current_us;
    
    // Re-queue buffer
    ioctl(fd_, VIDIOC_QBUF, &buf);
    
    return true;
#else
    return false;
#endif
}

void PiCSICamera::close() {
#ifdef __linux__
    if (fd_ >= 0) {
        enum v4l2_buf_type type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        ioctl(fd_, VIDIOC_STREAMOFF, &type);
        
        if (mmap_buf_ && mmap_buf_ != MAP_FAILED) {
            munmap(mmap_buf_, mmap_len_);
            mmap_buf_ = nullptr;
        }
        
        ::close(fd_);
        fd_ = -1;
    }
#endif
    open_ = false;
}

// ═══════════════════════════════════════════════════════════
// USB Camera (V4L2)
// ═══════════════════════════════════════════════════════════

bool USBCamera::detect(const char* device) {
#ifdef __linux__
    struct stat st;
    if (stat(device, &st) != 0 || !S_ISCHR(st.st_mode)) return false;
    
    int fd = ::open(device, O_RDWR);
    if (fd < 0) return false;
    
    struct v4l2_capability cap;
    bool is_usb = false;
    if (ioctl(fd, VIDIOC_QUERYCAP, &cap) == 0) {
        // USB cameras typically use uvcvideo driver
        if (strstr(reinterpret_cast<const char*>(cap.driver), "uvc") ||
            strstr(reinterpret_cast<const char*>(cap.bus_info), "usb")) {
            is_usb = true;
            std::printf("[Camera] USB camera detected: %s (%s)\n", cap.card, cap.driver);
        }
    }
    ::close(fd);
    return is_usb;
#else
    return false;
#endif
}

bool USBCamera::open() {
#ifdef __linux__
    fd_ = ::open(device_, O_RDWR | O_NONBLOCK);
    if (fd_ < 0) {
        std::printf("[USB] Failed to open %s\n", device_);
        return false;
    }
    
    // Set format
    struct v4l2_format fmt{};
    fmt.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    fmt.fmt.pix.width = FRAME_WIDTH;
    fmt.fmt.pix.height = FRAME_HEIGHT;
    fmt.fmt.pix.pixelformat = V4L2_PIX_FMT_YUYV;
    fmt.fmt.pix.field = V4L2_FIELD_NONE;
    
    if (ioctl(fd_, VIDIOC_S_FMT, &fmt) < 0) {
        std::printf("[USB] Failed to set format\n");
        close();
        return false;
    }
    
    open_ = true;
    frame_counter_ = 0;
    last_capture_us_ = now_us();
    std::printf("[USB] Camera opened: %s %ux%u\n", device_, FRAME_WIDTH, FRAME_HEIGHT);
    return true;
#else
    return false;
#endif
}

bool USBCamera::capture(FrameBuffer& frame) {
#ifdef __linux__
    if (!open_ || fd_ < 0) return false;
    
    // Simple read-based capture (non-mmap for simplicity)
    uint8_t yuyv_buf[FRAME_WIDTH * FRAME_HEIGHT * 2];
    ssize_t n = ::read(fd_, yuyv_buf, sizeof(yuyv_buf));
    if (n <= 0) return false;
    
    // Convert YUYV to grayscale (take Y channel only)
    for (size_t i = 0; i < FRAME_SIZE && i * 2 < static_cast<size_t>(n); ++i) {
        frame.data[i] = yuyv_buf[i * 2];
    }
    
    uint64_t current_us = now_us();
    float dt = static_cast<float>(current_us - last_capture_us_) / 1'000'000.0f;
    
    frame.info.timestamp_us = current_us;
    frame.info.frame_id = frame_counter_++;
    frame.info.width = FRAME_WIDTH;
    frame.info.height = FRAME_HEIGHT;
    frame.info.channels = 1;
    frame.info.fps_actual = (dt > 0) ? (1.0f / dt) : 0;
    frame.info.valid = true;
    
    last_capture_us_ = current_us;
    return true;
#else
    return false;
#endif
}

void USBCamera::close() {
#ifdef __linux__
    if (fd_ >= 0) {
        ::close(fd_);
        fd_ = -1;
    }
#endif
    open_ = false;
}

// ═══════════════════════════════════════════════════════════
// Camera Auto-Detection in Pipeline
// ═══════════════════════════════════════════════════════════

CameraType CameraPipeline::auto_detect_camera() {
    // Try CSI first (highest quality on Pi)
    if (PiCSICamera::detect()) {
        std::printf("[CameraPipeline] Auto-detected: Pi CSI camera\n");
        return CameraType::PI_CSI;
    }
    
    // Try USB camera
    if (USBCamera::detect()) {
        std::printf("[CameraPipeline] Auto-detected: USB camera\n");
        return CameraType::USB;
    }
    
    std::printf("[CameraPipeline] No camera hardware — using simulation\n");
    return CameraType::SIMULATED;
}

} // namespace jtzero
