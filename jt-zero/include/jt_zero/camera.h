#pragma once
/**
 * JT-Zero Camera Pipeline
 * 
 * Abstract camera sources with simulated implementations.
 * Supports: Raspberry Pi CSI camera, USB cameras, IP cameras
 * 
 * Hardware profiles for different Pi models:
 *   Pi Zero 2W: 320x240 @ 15fps (default)
 *   Pi 4:       640x480 @ 30fps
 *   Pi 5:       800x600 @ 30fps
 * 
 * Adaptive VO parameters based on altitude + hover yaw correction.
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

// Default dimensions (Pi Zero 2W profile)
static constexpr uint16_t FRAME_WIDTH  = 320;
static constexpr uint16_t FRAME_HEIGHT = 240;

// Maximum frame buffer (supports up to Pi 5 profile: 800x600)
static constexpr uint16_t MAX_FRAME_WIDTH  = 800;
static constexpr uint16_t MAX_FRAME_HEIGHT = 600;
static constexpr size_t   MAX_FRAME_SIZE   = MAX_FRAME_WIDTH * MAX_FRAME_HEIGHT;
static constexpr size_t   FRAME_SIZE       = MAX_FRAME_SIZE;

struct FrameBuffer {
    alignas(64) uint8_t data[FRAME_SIZE]{};
    FrameInfo info;
};

// ─── Hardware Profile ────────────────────────────────────
// Defines camera resolution & VO algorithm defaults per hardware

enum class HWProfileType : uint8_t {
    PI_ZERO_2W = 0,
    PI_4       = 1,
    PI_5       = 2,
    CUSTOM     = 3
};

inline const char* hw_profile_str(HWProfileType t) {
    switch(t) {
        case HWProfileType::PI_ZERO_2W: return "PI_ZERO_2W";
        case HWProfileType::PI_4:       return "PI_4";
        case HWProfileType::PI_5:       return "PI_5";
        case HWProfileType::CUSTOM:     return "CUSTOM";
        default: return "UNKNOWN";
    }
}

struct HardwareProfile {
    const char*   name;
    HWProfileType type;
    uint16_t frame_width;
    uint16_t frame_height;
    uint8_t  fast_threshold;       // FAST corner threshold
    int      lk_window_size;       // Lucas-Kanade window
    int      lk_iterations;        // LK max iterations
    size_t   max_features;         // max tracked features
    float    focal_length_px;      // camera focal length in pixels
    float    target_fps;           // target frame rate
};

static constexpr HardwareProfile HW_PROFILES[] = {
    {"Pi Zero 2W", HWProfileType::PI_ZERO_2W, 320, 240, 30, 5, 4, 100, 277.0f, 15.0f},
    {"Pi 4",       HWProfileType::PI_4,       640, 480, 25, 7, 5, 200, 554.0f, 30.0f},
    {"Pi 5",       HWProfileType::PI_5,       800, 600, 20, 9, 6, 300, 693.0f, 30.0f},
};
static constexpr size_t NUM_HW_PROFILES = sizeof(HW_PROFILES) / sizeof(HW_PROFILES[0]);

// ─── Altitude-Adaptive VO Parameters ─────────────────────
// Automatically adjusts VO algorithm settings based on barometric altitude.
// Smooth interpolation between zone boundaries.

enum class AltitudeZone : uint8_t {
    LOW     = 0,   // 0-10m:   aggressive tracking, small features
    MEDIUM  = 1,   // 10-50m:  balanced
    HIGH    = 2,   // 50-200m: conservative, large features
    CRUISE  = 3    // 200m+:   maximum stability, biggest window
};

inline const char* altitude_zone_str(AltitudeZone z) {
    switch(z) {
        case AltitudeZone::LOW:    return "LOW";
        case AltitudeZone::MEDIUM: return "MEDIUM";
        case AltitudeZone::HIGH:   return "HIGH";
        case AltitudeZone::CRUISE: return "CRUISE";
        default: return "UNKNOWN";
    }
}

struct AdaptiveVOParams {
    AltitudeZone zone{AltitudeZone::LOW};
    uint8_t  fast_threshold{30};
    int      lk_window_size{5};
    int      lk_iterations{4};
    int      min_inliers{5};
    float    kalman_q{0.5f};       // process noise (m/s^2)
    float    kalman_r_base{0.3f};  // measurement noise base
    float    redetect_ratio{0.15f}; // re-detect if tracked < ratio * max
};

// Zone boundary altitudes (meters AGL)
static constexpr float ALT_ZONE_LOW_MAX     = 10.0f;
static constexpr float ALT_ZONE_MEDIUM_MAX  = 50.0f;
static constexpr float ALT_ZONE_HIGH_MAX    = 200.0f;

// ─── Hover Yaw Correction ────────────────────────────────
// Detects hovering state and corrects gyroscopic yaw drift
// by analyzing micro-movements of tracked features.

struct HoverState {
    bool  is_hovering{false};
    float hover_duration_sec{0};
    float yaw_drift_rate{0};         // rad/s, estimated gyro drift
    float corrected_yaw{0};          // rad, corrected yaw
    float micro_motion_avg{0};       // px, average feature displacement
    int   stable_frame_count{0};     // consecutive frames with low motion
    float accumulated_yaw_drift{0};  // rad, total drift correction applied
    
    // Thresholds
    static constexpr float HOVER_MOTION_THRESH = 0.5f;  // px, below = hovering
    static constexpr int   HOVER_MIN_FRAMES    = 30;     // frames before hover confirmed
    static constexpr float DRIFT_ALPHA         = 0.02f;  // EMA smoothing for drift rate
};

// ─── Visual Odometry Result ──────────────────────────────

struct VOResult {
    uint64_t timestamp_us{0};
    // Position estimate (body-frame delta)
    float dx{0}, dy{0}, dz{0};         // m
    // Velocity estimate (Kalman-filtered)
    float vx{0}, vy{0}, vz{0};         // m/s
    // Rotation delta
    float droll{0}, dpitch{0}, dyaw{0}; // rad
    // Quality metrics
    uint16_t features_detected{0};
    uint16_t features_tracked{0};
    uint16_t inlier_count{0};           // features after outlier rejection
    float    tracking_quality{0};        // 0-1
    float    confidence{0};              // 0-1, combined quality metric for EKF
    float    position_uncertainty{0};    // meters, grows with drift
    bool     valid{false};
    
    // Hardware profile (active)
    uint8_t  active_profile{0};          // HWProfileType
    
    // Adaptive altitude zone
    uint8_t  altitude_zone{0};           // AltitudeZone
    float    adaptive_fast_thresh{30};
    float    adaptive_lk_window{5};
    
    // Hover yaw correction
    bool     hover_detected{false};
    float    hover_duration{0};          // seconds
    float    yaw_drift_rate{0};          // rad/s estimated drift
    float    corrected_yaw{0};           // rad, corrected yaw
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
    const char* name() const override { return "PiCSI_rpicam"; }
    
    // Auto-detect: check if rpicam-hello can see a camera
    static bool detect();

private:
    bool open_{false};
    FILE* pipe_{nullptr};  // rpicam-vid subprocess pipe
    uint16_t cap_w_{0};
    uint16_t cap_h_{0};
    uint32_t frame_counter_{0};
    uint64_t last_capture_us_{0};
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
    
    // Set IMU data for cross-validation (call before process())
    void set_imu_hint(float ax, float ay, float gyro_z);
    
    // Set current altitude for adaptive parameter adjustment
    void set_altitude(float altitude_agl);
    
    // Set current yaw from IMU/EKF for hover correction reference
    void set_yaw_hint(float yaw_rad);
    
    // Set hardware profile
    void set_profile(const HardwareProfile& profile);
    
    // Reset state
    void reset();
    
    // Get current feature state
    size_t active_features() const { return active_count_; }
    
    // Get feature positions (read-only access)
    const std::array<FeaturePoint, MAX_FEATURES>& features() const { return features_; }
    size_t feature_count() const { return active_count_; }
    
    // Get accumulated pose
    float pose_x() const { return pose_x_; }
    float pose_y() const { return pose_y_; }
    float total_distance() const { return total_distance_; }
    
    // Get adaptive state
    const AdaptiveVOParams& adaptive_params() const { return adaptive_; }
    const HoverState& hover_state() const { return hover_; }
    const HardwareProfile& active_profile() const { return profile_; }

private:
    FASTDetector detector_;
    LKTracker    tracker_;
    
    // Double-buffer for frame storage (max size)
    alignas(64) uint8_t prev_frame_[FRAME_SIZE]{};
    bool has_prev_frame_{false};
    
    // Feature buffers (current + previous for displacement)
    std::array<FeaturePoint, MAX_FEATURES> features_;
    std::array<FeaturePoint, MAX_FEATURES> prev_features_;
    size_t active_count_{0};
    
    // Accumulated local pose (NED frame)
    float pose_x_{0}, pose_y_{0}, pose_z_{0};
    float total_distance_{0};
    
    uint64_t prev_timestamp_us_{0};
    
    // ── Long-range drift reduction ──
    
    // Kalman filter state per axis (simple 1D: [position_rate])
    float kf_vx_{0}, kf_vy_{0};           // filtered velocity
    float kf_vx_var_{1.0f}, kf_vy_var_{1.0f}; // velocity variance
    
    // IMU hint for cross-validation
    float imu_ax_{0}, imu_ay_{0}, imu_gz_{0};
    bool  imu_hint_valid_{false};
    
    // Running confidence metric
    float running_confidence_{0.5f};
    
    // ── Hardware Profile ──
    HardwareProfile profile_;
    
    // ── Altitude-Adaptive Parameters ──
    AdaptiveVOParams adaptive_;
    float current_altitude_{0};
    void update_adaptive_params();
    
    // ── Hover Yaw Correction ──
    HoverState hover_;
    float yaw_hint_{0};
    bool  yaw_hint_valid_{false};
    void update_hover_state(float median_dx, float median_dy, float dt);
    
    // Median + MAD computation helpers
    static float compute_median(float* arr, int n);
    static float compute_mad(float* arr, int n, float median);
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
    uint16_t   vo_inlier_count{0};
    float      vo_tracking_quality{0};
    float      vo_confidence{0};          // 0-1 combined confidence
    float      vo_position_uncertainty{0}; // meters
    float      vo_total_distance{0};       // meters total path
    float      vo_dx{0}, vo_dy{0}, vo_dz{0};
    float      vo_vx{0}, vo_vy{0};
    bool       vo_valid{false};
    // Hardware profile
    uint8_t    active_profile{0};          // HWProfileType
    char       profile_name[32]{};
    // Adaptive parameters
    uint8_t    altitude_zone{0};           // AltitudeZone
    float      adaptive_fast_thresh{30};
    float      adaptive_lk_window{5};
    // Hover yaw correction
    bool       hover_detected{false};
    float      hover_duration{0};
    float      yaw_drift_rate{0};
    float      corrected_yaw{0};
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
    const FrameBuffer& current_frame() const { return current_frame_; }
    CameraPipelineStats get_stats() const;
    
    bool is_running() const { return running_; }
    
    // Get current VO feature positions
    const VisualOdometry& vo() const { return vo_; }
    
    // Hardware profile management
    void set_profile(HWProfileType type);
    HWProfileType active_profile() const;
    
    // Set altitude for adaptive parameters (call from runtime)
    void set_altitude(float altitude_agl);
    
    // Set yaw hint for hover correction (call from runtime)
    void set_yaw_hint(float yaw_rad);

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
