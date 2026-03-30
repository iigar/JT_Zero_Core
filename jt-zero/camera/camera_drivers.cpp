/**
 * JT-Zero Real Camera Driver Implementations
 * 
 * PiCSICamera: Raspberry Pi Camera Module via rpicam-vid (libcamera)
 * USBCamera:   Generic USB webcam via V4L2
 * 
 * PiCSI captures via rpicam-vid subprocess (YUV420 → grayscale 320x240).
 * USB captures via V4L2 (YUYV → grayscale 320x240).
 * 
 * Auto-detection flow:
 *   1. rpicam-hello --list-cameras for CSI camera
 *   2. Check /dev/video* for USB cameras  
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
#include <sys/select.h>
#endif

namespace jtzero {

// ═══════════════════════════════════════════════════════════
// Pi CSI Camera (via rpicam-vid subprocess)
// On modern Pi OS (Bookworm/Trixie), libcamera owns the camera.
// Direct V4L2 access fails. We use rpicam-vid for frame capture.
// ═══════════════════════════════════════════════════════════

bool PiCSICamera::detect() {
#ifdef __linux__
    // Run rpicam-hello --list-cameras to check for CSI cameras
    FILE* pipe = popen("rpicam-hello --list-cameras 2>&1", "r");
    if (!pipe) return false;
    
    char line[512];
    bool found = false;
    while (fgets(line, sizeof(line), pipe)) {
        // Look for sensor names in the output
        if (strstr(line, "ov5647") || strstr(line, "imx219") || 
            strstr(line, "imx477") || strstr(line, "imx708") ||
            strstr(line, "ov9281") || strstr(line, "ov7251")) {
            found = true;
            // Trim newline
            size_t len = strlen(line);
            if (len > 0 && line[len-1] == '\n') line[len-1] = '\0';
            std::printf("[Camera] CSI detected: %s\n", line);
        }
    }
    int status = pclose(pipe);
    
    if (!found && status == 0) {
        // rpicam-hello ran but no camera found
        std::printf("[Camera] rpicam-hello ran but no CSI camera detected\n");
    }
    
    return found;
#else
    return false;
#endif
}

bool PiCSICamera::open() {
#ifdef __linux__
    // Use rpicam-vid to output raw YUV420 frames to stdout
    // 640x480 at 15fps, no preview window, indefinite duration
    const char* cmd = "rpicam-vid --width 640 --height 480 "
                      "--codec yuv420 --framerate 15 "
                      "-t 0 --nopreview -o - 2>/dev/null";
    
    pipe_ = popen(cmd, "r");
    if (!pipe_) {
        std::printf("[PiCSI] Failed to start rpicam-vid\n");
        return false;
    }
    
    cap_w_ = 640;
    cap_h_ = 480;
    open_ = true;
    frame_counter_ = 0;
    last_capture_us_ = now_us();
    std::printf("[PiCSI] Camera opened via rpicam-vid: %ux%u YUV420 → %ux%u gray\n",
                cap_w_, cap_h_, FRAME_WIDTH, FRAME_HEIGHT);
    return true;
#else
    return false;
#endif
}

bool PiCSICamera::capture(FrameBuffer& frame) {
#ifdef __linux__
    if (!open_ || !pipe_) return false;
    
    // YUV420 frame layout:
    //   Y plane:  cap_w * cap_h bytes (luminance - this is our grayscale)
    //   U plane:  (cap_w/2) * (cap_h/2) bytes
    //   V plane:  (cap_w/2) * (cap_h/2) bytes
    const size_t y_size = static_cast<size_t>(cap_w_) * cap_h_;
    const size_t uv_size = y_size / 2;  // U + V combined
    
    // Read Y plane into temporary buffer
    // Stack allocation for 640x480 = 307200 bytes — acceptable
    uint8_t y_buf[640 * 480];
    size_t read_y = fread(y_buf, 1, y_size, pipe_);
    if (read_y != y_size) {
        std::printf("[PiCSI] Short read: got %zu of %zu Y bytes\n", read_y, y_size);
        return false;
    }
    
    // Skip U+V planes (we only need grayscale)
    uint8_t skip_buf[1024];
    size_t remaining = uv_size;
    while (remaining > 0) {
        size_t chunk = (remaining < sizeof(skip_buf)) ? remaining : sizeof(skip_buf);
        size_t got = fread(skip_buf, 1, chunk, pipe_);
        if (got == 0) return false;
        remaining -= got;
    }
    
    // Downscale 640x480 → 320x240 (2x2 nearest neighbor)
    for (uint16_t dy = 0; dy < FRAME_HEIGHT; ++dy) {
        const uint16_t sy = dy * 2;
        for (uint16_t dx = 0; dx < FRAME_WIDTH; ++dx) {
            const uint16_t sx = dx * 2;
            frame.data[dy * FRAME_WIDTH + dx] = y_buf[sy * cap_w_ + sx];
        }
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

void PiCSICamera::close() {
#ifdef __linux__
    if (pipe_) {
        pclose(pipe_);
        pipe_ = nullptr;
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
    // Open in blocking mode (no O_NONBLOCK — we use select() for timeout)
    fd_ = ::open(device_, O_RDWR);
    if (fd_ < 0) {
        std::printf("[USB] Failed to open %s\n", device_);
        return false;
    }
    
    // Check capabilities
    struct v4l2_capability cap{};
    if (ioctl(fd_, VIDIOC_QUERYCAP, &cap) < 0) {
        std::printf("[USB] QUERYCAP failed\n");
        close();
        return false;
    }
    if (!(cap.capabilities & V4L2_CAP_VIDEO_CAPTURE) ||
        !(cap.capabilities & V4L2_CAP_STREAMING)) {
        std::printf("[USB] Device lacks CAPTURE or STREAMING capability\n");
        close();
        return false;
    }
    std::printf("[USB] Device: %s (%s)\n", cap.card, cap.driver);
    
    // Query current format to log camera default
    struct v4l2_format fmt{};
    fmt.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    if (ioctl(fd_, VIDIOC_G_FMT, &fmt) == 0) {
        std::printf("[USB] Camera default: %ux%u fmt=0x%X\n",
                    fmt.fmt.pix.width, fmt.fmt.pix.height, fmt.fmt.pix.pixelformat);
    }
    
    // Try YUYV at common resolutions (driver may silently adjust)
    struct { uint32_t w, h; } try_res[] = {
        {640, 480}, {480, 320}, {720, 480},
        {fmt.fmt.pix.width, fmt.fmt.pix.height}
    };
    
    bool format_set = false;
    for (auto& r : try_res) {
        struct v4l2_format try_fmt{};
        try_fmt.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        try_fmt.fmt.pix.width = r.w;
        try_fmt.fmt.pix.height = r.h;
        try_fmt.fmt.pix.pixelformat = V4L2_PIX_FMT_YUYV;
        try_fmt.fmt.pix.field = V4L2_FIELD_NONE;
        
        if (ioctl(fd_, VIDIOC_S_FMT, &try_fmt) >= 0) {
            // Read back actual (driver may adjust to nearest supported)
            cap_w_ = try_fmt.fmt.pix.width;
            cap_h_ = try_fmt.fmt.pix.height;
            // Verify it's actually YUYV
            if (try_fmt.fmt.pix.pixelformat == V4L2_PIX_FMT_YUYV) {
                format_set = true;
                std::printf("[USB] Format set: %ux%u YUYV\n", cap_w_, cap_h_);
                break;
            }
        }
    }
    
    if (!format_set) {
        std::printf("[USB] Failed to set YUYV format at any resolution\n");
        close();
        return false;
    }
    
    // Verify resolution fits in our frame buffer
    if (static_cast<size_t>(cap_w_) * cap_h_ > FRAME_SIZE) {
        std::printf("[USB] Resolution %ux%u exceeds max frame buffer (%zu)\n",
                    cap_w_, cap_h_, FRAME_SIZE);
        close();
        return false;
    }
    
    // ── V4L2 MMAP buffer setup ──
    struct v4l2_requestbuffers req{};
    req.count = MAX_V4L2_BUFS;
    req.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    req.memory = V4L2_MEMORY_MMAP;
    
    if (ioctl(fd_, VIDIOC_REQBUFS, &req) < 0 || req.count < 2) {
        std::printf("[USB] REQBUFS failed (got %u buffers)\n", req.count);
        close();
        return false;
    }
    n_buffers_ = static_cast<int>(req.count);
    std::printf("[USB] Allocated %d MMAP buffers\n", n_buffers_);
    
    // Query and mmap each buffer
    for (int i = 0; i < n_buffers_; ++i) {
        struct v4l2_buffer buf{};
        buf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        buf.memory = V4L2_MEMORY_MMAP;
        buf.index = static_cast<uint32_t>(i);
        
        if (ioctl(fd_, VIDIOC_QUERYBUF, &buf) < 0) {
            std::printf("[USB] QUERYBUF %d failed\n", i);
            close();
            return false;
        }
        
        buffers_[i].length = buf.length;
        buffers_[i].start = mmap(nullptr, buf.length,
                                 PROT_READ | PROT_WRITE, MAP_SHARED,
                                 fd_, buf.m.offset);
        if (buffers_[i].start == MAP_FAILED) {
            buffers_[i].start = nullptr;
            std::printf("[USB] mmap %d failed\n", i);
            close();
            return false;
        }
    }
    
    // Queue all buffers
    for (int i = 0; i < n_buffers_; ++i) {
        struct v4l2_buffer buf{};
        buf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        buf.memory = V4L2_MEMORY_MMAP;
        buf.index = static_cast<uint32_t>(i);
        if (ioctl(fd_, VIDIOC_QBUF, &buf) < 0) {
            std::printf("[USB] QBUF %d failed\n", i);
            close();
            return false;
        }
    }
    
    // Start streaming
    int buf_type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    if (ioctl(fd_, VIDIOC_STREAMON, &buf_type) < 0) {
        std::printf("[USB] STREAMON failed\n");
        close();
        return false;
    }
    streaming_ = true;
    
    open_ = true;
    frame_counter_ = 0;
    last_capture_us_ = now_us();
    std::printf("[USB] Camera opened: %s %ux%u YUYV (MMAP streaming)\n",
                device_, cap_w_, cap_h_);
    return true;
#else
    return false;
#endif
}

bool USBCamera::capture(FrameBuffer& frame) {
#ifdef __linux__
    if (!open_ || !streaming_ || fd_ < 0 || cap_w_ == 0 || cap_h_ == 0) return false;
    
    // Wait for a frame with select() (2s timeout)
    fd_set fds;
    FD_ZERO(&fds);
    FD_SET(fd_, &fds);
    struct timeval tv;
    tv.tv_sec = 2;
    tv.tv_usec = 0;
    int r = select(fd_ + 1, &fds, nullptr, nullptr, &tv);
    if (r <= 0) {
        if (r == 0) std::printf("[USB] select() timeout\n");
        return false;
    }
    
    // Dequeue a filled buffer
    struct v4l2_buffer buf{};
    buf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    buf.memory = V4L2_MEMORY_MMAP;
    if (ioctl(fd_, VIDIOC_DQBUF, &buf) < 0) return false;
    
    // Convert YUYV to grayscale (extract Y channel)
    const uint8_t* src = static_cast<const uint8_t*>(buffers_[buf.index].start);
    const size_t pixels = static_cast<size_t>(cap_w_) * cap_h_;
    const size_t src_bytes = buf.bytesused;
    for (size_t i = 0; i < pixels && i * 2 < src_bytes; ++i) {
        frame.data[i] = src[i * 2];  // Y from YUYV
    }
    
    // Re-queue the buffer
    if (ioctl(fd_, VIDIOC_QBUF, &buf) < 0) {
        std::printf("[USB] QBUF re-queue failed\n");
    }
    
    uint64_t current_us = now_us();
    float dt = static_cast<float>(current_us - last_capture_us_) / 1'000'000.0f;
    
    frame.info.timestamp_us = current_us;
    frame.info.frame_id = frame_counter_++;
    frame.info.width = cap_w_;
    frame.info.height = cap_h_;
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
    if (streaming_ && fd_ >= 0) {
        int buf_type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        ioctl(fd_, VIDIOC_STREAMOFF, &buf_type);
        streaming_ = false;
    }
    for (int i = 0; i < n_buffers_; ++i) {
        if (buffers_[i].start && buffers_[i].start != MAP_FAILED) {
            munmap(buffers_[i].start, buffers_[i].length);
        }
        buffers_[i].start = nullptr;
        buffers_[i].length = 0;
    }
    n_buffers_ = 0;
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
