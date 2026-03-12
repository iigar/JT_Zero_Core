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
