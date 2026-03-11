#pragma once
/**
 * JT-Zero Camera Pipeline
 * 
 * Abstract camera sources with simulated implementations.
 * Supports: Raspberry Pi CSI camera, USB cameras, IP cameras
 * 
 * Default for Pi Zero 2 W:
 *   Resolution: 320x240
 *   FPS: 10-15
 *   Format: Grayscale (for VO) + optional RGB
 */

#include "jt_zero/common.h"
#include <cstdint>
#include <array>
#include <atomic>

namespace jtzero {

// ─── Frame Data ──────────────────────────────────────────

struct FrameInfo {
    uint64_t timestamp_us{0};
    uint32_t frame_id{0};
    uint16_t width{0};
    uint16_t height{0};
    uint8_t  channels{1};       // 1=grayscale, 3=RGB
    float    fps_actual{0};
    bool     valid{false};
};

// Fixed-size frame buffer for embedded (320x240 grayscale = 76800 bytes)
static constexpr uint16_t FRAME_WIDTH  = 320;
static constexpr uint16_t FRAME_HEIGHT = 240;
static constexpr size_t   FRAME_SIZE   = FRAME_WIDTH * FRAME_HEIGHT;

struct FrameBuffer {
    alignas(64) uint8_t data[FRAME_SIZE]{};
    FrameInfo info;
};

// ─── Visual Odometry Result ──────────────────────────────

struct VOResult {
    uint64_t timestamp_us{0};
    // Position estimate (body-frame delta)
    float dx{0}, dy{0}, dz{0};         // m
    // Velocity estimate
    float vx{0}, vy{0}, vz{0};         // m/s
    // Rotation delta
    float droll{0}, dpitch{0}, dyaw{0}; // rad
    // Quality metrics
    uint16_t features_detected{0};
    uint16_t features_tracked{0};
    float    tracking_quality{0};        // 0-1
    bool     valid{false};
};

// ─── Feature Point ───────────────────────────────────────

struct FeaturePoint {
    float x{0}, y{0};          // pixel coordinates
    float response{0};         // corner strength
    bool  tracked{false};
};

static constexpr size_t MAX_FEATURES = 200;

// ─── Camera Source Interface ─────────────────────────────

enum class CameraType : uint8_t {
    NONE = 0,
    PI_CSI,      // Raspberry Pi CSI camera
    USB,         // USB webcam (V4L2)
    IP_STREAM,   // RTSP/HTTP IP camera
    SIMULATED    // Test pattern generator
};

inline const char* camera_type_str(CameraType t) {
    switch(t) {
        case CameraType::NONE: return "NONE";
        case CameraType::PI_CSI: return "PI_CSI";
        case CameraType::USB: return "USB";
        case CameraType::IP_STREAM: return "IP";
        case CameraType::SIMULATED: return "SIM";
        default: return "UNKNOWN";
    }
}

class CameraSource {
public:
    virtual ~CameraSource() = default;
    virtual bool open() = 0;
    virtual bool capture(FrameBuffer& frame) = 0;
    virtual void close() = 0;
    virtual bool is_open() const = 0;
    virtual CameraType type() const = 0;
    virtual const char* name() const = 0;
};

// ─── Simulated Camera ────────────────────────────────────
// Generates test patterns with moving features for VO testing

class SimulatedCamera : public CameraSource {
public:
    bool open() override;
    bool capture(FrameBuffer& frame) override;
    void close() override;
    bool is_open() const override { return open_; }
    CameraType type() const override { return CameraType::SIMULATED; }
    const char* name() const override { return "SimulatedCamera"; }

private:
    bool open_{false};
    uint32_t frame_counter_{0};
    uint64_t last_capture_us_{0};
    
    void generate_pattern(uint8_t* data, uint16_t w, uint16_t h, uint32_t frame);
};

// ─── Pi CSI Camera (via libcamera / V4L2) ────────────────
// Raspberry Pi Camera Module v2/v3 (CSI interface)
// Uses V4L2 /dev/video0 with libcamera-bridge

class PiCSICamera : public CameraSource {
public:
    bool open() override;
    bool capture(FrameBuffer& frame) override;
    void close() override;
    bool is_open() const override { return open_; }
    CameraType type() const override { return CameraType::PI_CSI; }
    const char* name() const override { return "PiCSI_libcamera"; }
    
    // Auto-detect: check if /dev/video0 exists and is a CSI camera
    static bool detect();

private:
    bool open_{false};
    int fd_{-1};
    uint32_t frame_counter_{0};
    uint64_t last_capture_us_{0};
    uint8_t* mmap_buf_{nullptr};
    size_t mmap_len_{0};
};

// ─── USB Camera (via V4L2) ───────────────────────────────
// Generic USB webcam using Video4Linux2

class USBCamera : public CameraSource {
public:
    explicit USBCamera(const char* device = "/dev/video0") : device_(device) {}
    
    bool open() override;
    bool capture(FrameBuffer& frame) override;
    void close() override;
    bool is_open() const override { return open_; }
    CameraType type() const override { return CameraType::USB; }
    const char* name() const override { return "USB_V4L2"; }
    
    static bool detect(const char* device = "/dev/video0");

private:
    const char* device_;
    bool open_{false};
    int fd_{-1};
    uint32_t frame_counter_{0};
    uint64_t last_capture_us_{0};
};

// ─── FAST Corner Detector ────────────────────────────────
// Simplified FAST-9 corner detection for embedded use

class FASTDetector {
public:
    // Detect corners in grayscale frame
    // Returns number of features found
    int detect(const uint8_t* frame, uint16_t width, uint16_t height,
               FeaturePoint* features, size_t max_features,
               uint8_t threshold = 30);

private:
    // FAST-9 circle test (simplified)
    bool is_corner(const uint8_t* frame, uint16_t width,
                   int x, int y, uint8_t threshold) const;
};

// ─── Lucas-Kanade Optical Flow Tracker ───────────────────
// Sparse optical flow for feature tracking

class LKTracker {
public:
    // Track features from prev frame to curr frame
    // Updates feature positions in-place, sets tracked flag
    int track(const uint8_t* prev_frame, const uint8_t* curr_frame,
              uint16_t width, uint16_t height,
              FeaturePoint* features, size_t feature_count,
              int window_size = 7, int iterations = 5);

private:
    // Compute image gradients at a point
    void compute_gradient(const uint8_t* frame, uint16_t width,
                         int x, int y, float& gx, float& gy) const;
};

// ─── Visual Odometry Estimator ───────────────────────────

class VisualOdometry {
public:
    VisualOdometry();
    
    // Process a new frame and compute VO estimate
    VOResult process(const FrameBuffer& frame, float ground_distance = 1.0f);
    
    // Reset state
    void reset();
    
    // Get current feature state
    size_t active_features() const { return active_count_; }

private:
    FASTDetector detector_;
    LKTracker    tracker_;
    
    // Double-buffer for frame storage (avoid allocation)
    alignas(64) uint8_t prev_frame_[FRAME_SIZE]{};
    bool has_prev_frame_{false};
    
    // Feature buffers (current + previous for displacement)
    std::array<FeaturePoint, MAX_FEATURES> features_;
    std::array<FeaturePoint, MAX_FEATURES> prev_features_;
    size_t active_count_{0};
    
    // Accumulated local pose (NED frame)
    float pose_x_{0}, pose_y_{0}, pose_z_{0};
    
    uint64_t prev_timestamp_us_{0};
};

// ─── Camera Pipeline (combines Camera + VO) ──────────────

struct CameraPipelineStats {
    CameraType camera_type{CameraType::NONE};
    bool       camera_open{false};
    uint32_t   frame_count{0};
    float      fps_actual{0};
    uint16_t   width{0};
    uint16_t   height{0};
    // VO stats
    uint16_t   vo_features_detected{0};
    uint16_t   vo_features_tracked{0};
    float      vo_tracking_quality{0};
    float      vo_dx{0}, vo_dy{0}, vo_dz{0};
    float      vo_vx{0}, vo_vy{0};
    bool       vo_valid{false};
};

class CameraPipeline {
public:
    CameraPipeline();
    
    // Initialize with camera source (auto-detects if SIMULATED)
    bool initialize(CameraType type = CameraType::SIMULATED);
    
    // Auto-detect: try PI_CSI, then USB, fallback to SIMULATED
    CameraType auto_detect_camera();
    
    // Process one frame (capture + VO)
    bool tick(float ground_distance = 1.0f);
    
    // Shutdown
    void shutdown();
    
    // Access results
    const FrameInfo& last_frame_info() const { return current_frame_.info; }
    const VOResult&  last_vo_result() const  { return vo_result_; }
    CameraPipelineStats get_stats() const;
    
    bool is_running() const { return running_; }

private:
    SimulatedCamera sim_camera_;
    PiCSICamera     csi_camera_;
    USBCamera       usb_camera_;
    CameraSource*   active_camera_{nullptr};
    
    FrameBuffer current_frame_;
    
    VisualOdometry vo_;
    VOResult       vo_result_;
    
    bool running_{false};
    uint32_t frame_count_{0};
    uint64_t start_time_us_{0};
};

} // namespace jtzero
