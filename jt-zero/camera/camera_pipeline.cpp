/**
 * JT-Zero Camera Pipeline Implementation
 * 
 * Includes:
 * - Simulated camera with moving test patterns
 * - FAST-9 corner detector (simplified)
 * - Lucas-Kanade sparse optical flow tracker
 * - Visual Odometry estimator
 * - Pipeline orchestrator
 */

#include "jt_zero/camera.h"
#include <cmath>
#include <cstring>
#include <cstdlib>
#include <algorithm>

namespace jtzero {

// Thread-local xorshift32 PRNG for camera thread
static thread_local uint32_t cam_prng_state_ = 67890;

static inline uint8_t fast_noise(uint8_t range) {
    cam_prng_state_ ^= cam_prng_state_ << 13;
    cam_prng_state_ ^= cam_prng_state_ >> 17;
    cam_prng_state_ ^= cam_prng_state_ << 5;
    return static_cast<uint8_t>(cam_prng_state_ % range);
}

// ═══════════════════════════════════════════════════════════
// Simulated Camera
// ═══════════════════════════════════════════════════════════

bool SimulatedCamera::open() {
    open_ = true;
    frame_counter_ = 0;
    last_capture_us_ = now_us();
    return true;
}

void SimulatedCamera::close() {
    open_ = false;
}

bool SimulatedCamera::capture(FrameBuffer& frame) {
    if (!open_) return false;
    
    uint64_t current_us = now_us();
    float dt = static_cast<float>(current_us - last_capture_us_) / 1'000'000.0f;
    
    generate_pattern(frame.data, FRAME_WIDTH, FRAME_HEIGHT, frame_counter_);
    
    frame.info.timestamp_us = current_us;
    frame.info.frame_id = frame_counter_;
    frame.info.width = FRAME_WIDTH;
    frame.info.height = FRAME_HEIGHT;
    frame.info.channels = 1;
    frame.info.fps_actual = (dt > 0) ? (1.0f / dt) : 0;
    frame.info.valid = true;
    
    frame_counter_++;
    last_capture_us_ = current_us;
    return true;
}

void SimulatedCamera::generate_pattern(uint8_t* data, uint16_t w, uint16_t h, uint32_t frame) {
    // Generate a scene with:
    // 1. Gradient background (simulates ground texture)
    // 2. Moving bright spots (simulates trackable features)
    // 3. Noise (simulates sensor noise)
    
    const float time = static_cast<float>(frame) * 0.08f;
    const float drift_x = 5.0f * std::sin(time * 0.3f);
    const float drift_y = 3.0f * std::cos(time * 0.2f);
    
    for (uint16_t y = 0; y < h; ++y) {
        for (uint16_t x = 0; x < w; ++x) {
            // Base: checkerboard pattern with drift (simulates ground)
            float fx = static_cast<float>(x) + drift_x;
            float fy = static_cast<float>(y) + drift_y;
            
            int checker = (static_cast<int>(fx / 20) + static_cast<int>(fy / 20)) & 1;
            uint8_t base = checker ? 120 : 80;
            
            // Add some texture variation
            float texture = 10.0f * std::sin(fx * 0.1f) * std::cos(fy * 0.1f);
            
            // Bright feature points (corners for FAST to detect)
            float val = base + texture;
            
            // Create several bright spots that move with drift
            for (int i = 0; i < 8; ++i) {
                float cx = 40.0f + i * 35.0f + drift_x * 0.5f;
                float cy = 30.0f + (i % 3) * 70.0f + drift_y * 0.5f;
                float dx = fx - cx;
                float dy = fy - cy;
                float dist_sq = dx * dx + dy * dy;
                constexpr float radius_sq = 16.0f; // 4.0^2
                if (dist_sq < radius_sq) {
                    val += 100.0f * (1.0f - dist_sq / radius_sq);
                }
            }
            
            // Add noise (thread-safe xorshift)
            val += static_cast<float>(fast_noise(10)) - 5.0f;
            
            // Clamp
            if (val < 0) val = 0;
            if (val > 255) val = 255;
            
            data[y * w + x] = static_cast<uint8_t>(val);
        }
    }
}

// ═══════════════════════════════════════════════════════════
// FAST Corner Detector
// ═══════════════════════════════════════════════════════════

bool FASTDetector::is_corner(const uint8_t* frame, uint16_t width,
                              int x, int y, uint8_t threshold) const {
    // Simplified FAST-9: check 16 pixels in Bresenham circle of radius 3
    // A corner exists if N contiguous pixels are all brighter or darker
    
    static const int offsets[16][2] = {
        {0,-3}, {1,-3}, {2,-2}, {3,-1},
        {3,0},  {3,1},  {2,2},  {1,3},
        {0,3},  {-1,3}, {-2,2}, {-3,1},
        {-3,0}, {-3,-1},{-2,-2},{-1,-3}
    };
    
    const uint8_t center = frame[y * width + x];
    // Use int to prevent uint8_t overflow (center + threshold > 255)
    const int center_i = static_cast<int>(center);
    const int hi = std::min(255, center_i + threshold);
    const int lo = std::max(0, center_i - threshold);
    
    // Quick test: at least 3 of positions 0,4,8,12 must be brighter or darker
    int bright_count = 0, dark_count = 0;
    for (int i = 0; i < 16; i += 4) {
        int px = static_cast<int>(frame[(y + offsets[i][1]) * width + (x + offsets[i][0])]);
        if (px > hi) bright_count++;
        if (px < lo) dark_count++;
    }
    
    if (bright_count < 3 && dark_count < 3) return false;
    
    // Full test: 9 contiguous pixels
    int max_bright = 0, max_dark = 0;
    int cur_bright = 0, cur_dark = 0;
    
    // Check twice around to handle wrap-around
    for (int pass = 0; pass < 2; ++pass) {
        for (int i = 0; i < 16; ++i) {
            int px = static_cast<int>(frame[(y + offsets[i][1]) * width + (x + offsets[i][0])]);
            
            if (px > hi) {
                cur_bright++;
                cur_dark = 0;
            } else if (px < lo) {
                cur_dark++;
                cur_bright = 0;
            } else {
                cur_bright = 0;
                cur_dark = 0;
            }
            
            if (cur_bright > max_bright) max_bright = cur_bright;
            if (cur_dark > max_dark) max_dark = cur_dark;
        }
    }
    
    return max_bright >= 9 || max_dark >= 9;
}

int FASTDetector::detect(const uint8_t* frame, uint16_t width, uint16_t height,
                          FeaturePoint* features, size_t max_features,
                          uint8_t threshold) {
    int count = 0;
    const int border = 4; // Skip border pixels
    
    for (int y = border; y < height - border && static_cast<size_t>(count) < max_features; y += 3) {
        for (int x = border; x < width - border && static_cast<size_t>(count) < max_features; x += 3) {
            if (is_corner(frame, width, x, y, threshold)) {
                features[count].x = static_cast<float>(x);
                features[count].y = static_cast<float>(y);
                // Corner response = intensity contrast
                uint8_t center = frame[y * width + x];
                features[count].response = static_cast<float>(
                    std::abs(static_cast<int>(frame[(y-1)*width+x]) - center) +
                    std::abs(static_cast<int>(frame[(y+1)*width+x]) - center) +
                    std::abs(static_cast<int>(frame[y*width+x-1]) - center) +
                    std::abs(static_cast<int>(frame[y*width+x+1]) - center)
                );
                features[count].tracked = false;
                count++;
            }
        }
    }
    
    return count;
}

// ═══════════════════════════════════════════════════════════
// Lucas-Kanade Optical Flow Tracker
// ═══════════════════════════════════════════════════════════

void LKTracker::compute_gradient(const uint8_t* frame, uint16_t width,
                                  int x, int y, float& gx, float& gy) const {
    // Sobel-like gradient
    gx = static_cast<float>(frame[y * width + x + 1]) -
         static_cast<float>(frame[y * width + x - 1]);
    gy = static_cast<float>(frame[(y + 1) * width + x]) -
         static_cast<float>(frame[(y - 1) * width + x]);
}

int LKTracker::track(const uint8_t* prev_frame, const uint8_t* curr_frame,
                      uint16_t width, uint16_t height,
                      FeaturePoint* features, size_t feature_count,
                      int window_size, int iterations) {
    const int half_win = window_size / 2;
    int tracked = 0;
    
    for (size_t f = 0; f < feature_count; ++f) {
        float px = features[f].x;
        float py = features[f].y;
        
        // Skip if too close to border
        if (px < half_win + 2 || px >= width - half_win - 2 ||
            py < half_win + 2 || py >= height - half_win - 2) {
            features[f].tracked = false;
            continue;
        }
        
        float flow_x = 0, flow_y = 0;
        bool converged = false;
        
        for (int iter = 0; iter < iterations; ++iter) {
            float sum_ixx = 0, sum_iyy = 0, sum_ixy = 0;
            float sum_itx = 0, sum_ity = 0;
            
            for (int wy = -half_win; wy <= half_win; ++wy) {
                for (int wx = -half_win; wx <= half_win; ++wx) {
                    int ox = static_cast<int>(px) + wx;
                    int oy = static_cast<int>(py) + wy;
                    int nx = static_cast<int>(px + flow_x) + wx;
                    int ny = static_cast<int>(py + flow_y) + wy;
                    
                    // Bounds check
                    if (ox < 1 || ox >= width - 1 || oy < 1 || oy >= height - 1) continue;
                    if (nx < 1 || nx >= width - 1 || ny < 1 || ny >= height - 1) continue;
                    
                    float gx, gy;
                    compute_gradient(prev_frame, width, ox, oy, gx, gy);
                    
                    float it = static_cast<float>(curr_frame[ny * width + nx]) -
                               static_cast<float>(prev_frame[oy * width + ox]);
                    
                    sum_ixx += gx * gx;
                    sum_iyy += gy * gy;
                    sum_ixy += gx * gy;
                    sum_itx += gx * it;
                    sum_ity += gy * it;
                }
            }
            
            // Solve 2x2 system: [Ixx Ixy; Ixy Iyy] * [vx;vy] = -[Itx;Ity]
            float det = sum_ixx * sum_iyy - sum_ixy * sum_ixy;
            if (std::abs(det) < 1e-6f) break;
            
            float dvx = -(sum_iyy * sum_itx - sum_ixy * sum_ity) / det;
            float dvy = -(sum_ixx * sum_ity - sum_ixy * sum_itx) / det;
            
            flow_x += dvx;
            flow_y += dvy;
            
            if (std::abs(dvx) < 0.01f && std::abs(dvy) < 0.01f) {
                converged = true;
                break;
            }
        }
        
        // Validate flow
        float new_x = px + flow_x;
        float new_y = py + flow_y;
        
        if (converged && 
            new_x >= half_win && new_x < width - half_win &&
            new_y >= half_win && new_y < height - half_win &&
            std::abs(flow_x) < 50.0f && std::abs(flow_y) < 50.0f) {
            features[f].x = new_x;
            features[f].y = new_y;
            features[f].tracked = true;
            tracked++;
        } else {
            features[f].tracked = false;
        }
    }
    
    return tracked;
}

// ═══════════════════════════════════════════════════════════
// Visual Odometry
// ═══════════════════════════════════════════════════════════

VisualOdometry::VisualOdometry() {
    std::memset(prev_frame_, 0, FRAME_SIZE);
    features_.fill({});
    prev_features_.fill({});
}

VOResult VisualOdometry::process(const FrameBuffer& frame, float ground_distance) {
    VOResult result;
    result.timestamp_us = frame.info.timestamp_us;
    
    if (!has_prev_frame_) {
        // First frame: detect features only
        active_count_ = static_cast<size_t>(
            detector_.detect(frame.data, frame.info.width, frame.info.height,
                           features_.data(), MAX_FEATURES, 25));
        
        std::memcpy(prev_frame_, frame.data, FRAME_SIZE);
        prev_timestamp_us_ = frame.info.timestamp_us;
        has_prev_frame_ = true;
        
        result.features_detected = static_cast<uint16_t>(active_count_);
        result.valid = false;
        return result;
    }
    
    // Save previous feature positions BEFORE tracking updates them in-place
    for (size_t i = 0; i < active_count_; ++i) {
        prev_features_[i] = features_[i];
    }
    
    // Track existing features (updates features_ positions in-place)
    int tracked_count = tracker_.track(
        prev_frame_, frame.data,
        frame.info.width, frame.info.height,
        features_.data(), active_count_);
    
    // Compute mean displacement from tracked features
    float sum_flow_x = 0, sum_flow_y = 0;
    int valid_flow = 0;
    
    for (size_t i = 0; i < active_count_; ++i) {
        if (features_[i].tracked) {
            float dx_px = features_[i].x - prev_features_[i].x;
            float dy_px = features_[i].y - prev_features_[i].y;
            sum_flow_x += dx_px;
            sum_flow_y += dy_px;
            valid_flow++;
        }
    }
    
    float avg_flow_x = (valid_flow > 0) ? sum_flow_x / static_cast<float>(valid_flow) : 0;
    float avg_flow_y = (valid_flow > 0) ? sum_flow_y / static_cast<float>(valid_flow) : 0;
    
    result.features_tracked = static_cast<uint16_t>(tracked_count);
    result.tracking_quality = (active_count_ > 0) ? 
        static_cast<float>(tracked_count) / static_cast<float>(active_count_) : 0;
    
    // Re-detect features if too few tracked
    if (tracked_count < 20 || active_count_ < 30) {
        active_count_ = static_cast<size_t>(
            detector_.detect(frame.data, frame.info.width, frame.info.height,
                           features_.data(), MAX_FEATURES, 25));
    }
    
    result.features_detected = static_cast<uint16_t>(active_count_);
    
    // Compute dt
    float dt = static_cast<float>(frame.info.timestamp_us - prev_timestamp_us_) / 1'000'000.0f;
    if (dt <= 0 || dt > 1.0f) dt = 0.066f; // Default ~15 FPS
    
    // Convert pixel displacement to meters using ground distance and FOV
    // Approximate: pixel_to_meter = ground_distance / (focal_length_px)
    // For 320x240 with ~60deg HFOV: focal_length ~= 160 / tan(30deg) ~= 277 px
    constexpr float focal_length_px = 277.0f;
    float pixel_to_meter = (ground_distance > 0.1f) ? ground_distance / focal_length_px : 0;
    
    result.dx = avg_flow_x * pixel_to_meter;
    result.dy = avg_flow_y * pixel_to_meter;
    result.dz = 0;
    
    result.vx = (dt > 0) ? result.dx / dt : 0;
    result.vy = (dt > 0) ? result.dy / dt : 0;
    result.vz = 0;
    
    // Accumulate local pose
    pose_x_ += result.dx;
    pose_y_ += result.dy;
    
    result.valid = valid_flow >= 5;
    
    // Update state
    std::memcpy(prev_frame_, frame.data, FRAME_SIZE);
    prev_timestamp_us_ = frame.info.timestamp_us;
    
    return result;
}

void VisualOdometry::reset() {
    has_prev_frame_ = false;
    active_count_ = 0;
    prev_timestamp_us_ = 0;
}

// ═══════════════════════════════════════════════════════════
// Camera Pipeline
// ═══════════════════════════════════════════════════════════

CameraPipeline::CameraPipeline() = default;

bool CameraPipeline::initialize(CameraType type) {
    // Auto-detect if requested type is SIMULATED or NONE
    CameraType actual = type;
    if (type == CameraType::SIMULATED || type == CameraType::NONE) {
        actual = auto_detect_camera();
    }
    
    switch (actual) {
        case CameraType::PI_CSI:
            if (csi_camera_.open()) {
                active_camera_ = &csi_camera_;
                break;
            }
            // Fall through to USB if CSI fails
            std::printf("[CameraPipeline] CSI open failed, trying USB...\n");
            [[fallthrough]];
        case CameraType::USB:
            if (usb_camera_.open()) {
                active_camera_ = &usb_camera_;
                break;
            }
            // Fall through to simulation
            std::printf("[CameraPipeline] USB open failed, using simulation\n");
            [[fallthrough]];
        case CameraType::SIMULATED:
        default:
            if (!sim_camera_.open()) return false;
            active_camera_ = &sim_camera_;
            break;
    }
    
    running_ = true;
    frame_count_ = 0;
    start_time_us_ = now_us();
    vo_.reset();
    return true;
}

bool CameraPipeline::tick(float ground_distance) {
    if (!running_ || !active_camera_) return false;
    
    // Capture frame
    if (!active_camera_->capture(current_frame_)) {
        return false;
    }
    
    // Process visual odometry
    vo_result_ = vo_.process(current_frame_, ground_distance);
    
    frame_count_++;
    return true;
}

void CameraPipeline::shutdown() {
    running_ = false;
    if (active_camera_) {
        active_camera_->close();
        active_camera_ = nullptr;
    }
}

CameraPipelineStats CameraPipeline::get_stats() const {
    CameraPipelineStats stats;
    
    if (active_camera_) {
        stats.camera_type = active_camera_->type();
        stats.camera_open = active_camera_->is_open();
    }
    
    stats.frame_count = frame_count_;
    stats.width = current_frame_.info.width;
    stats.height = current_frame_.info.height;
    
    // Compute actual FPS
    uint64_t elapsed_us = now_us() - start_time_us_;
    if (elapsed_us > 0 && frame_count_ > 1) {
        stats.fps_actual = static_cast<float>(frame_count_) * 1'000'000.0f / 
                          static_cast<float>(elapsed_us);
    }
    
    stats.vo_features_detected = vo_result_.features_detected;
    stats.vo_features_tracked  = vo_result_.features_tracked;
    stats.vo_tracking_quality  = vo_result_.tracking_quality;
    stats.vo_dx = vo_result_.dx;
    stats.vo_dy = vo_result_.dy;
    stats.vo_dz = vo_result_.dz;
    stats.vo_vx = vo_result_.vx;
    stats.vo_vy = vo_result_.vy;
    stats.vo_valid = vo_result_.valid;
    
    return stats;
}

} // namespace jtzero
