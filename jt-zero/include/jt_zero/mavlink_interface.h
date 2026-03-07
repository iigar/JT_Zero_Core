#pragma once
/**
 * JT-Zero MAVLink Interface
 * 
 * Handles communication with flight controllers via MAVLink protocol.
 * Sends: VISION_POSITION_ESTIMATE, ODOMETRY, OPTICAL_FLOW_RAD
 * Receives: HEARTBEAT, ATTITUDE, GPS, etc.
 * 
 * In simulator mode, generates realistic MAVLink-like telemetry.
 */

#include "jt_zero/common.h"
#include "jt_zero/camera.h"
#include <atomic>
#include <array>

namespace jtzero {

// ─── MAVLink Message Types (subset) ─────────────────────

enum class MAVMsgType : uint16_t {
    HEARTBEAT                  = 0,
    ATTITUDE                   = 30,
    GLOBAL_POSITION_INT        = 33,
    GPS_RAW_INT                = 24,
    SCALED_IMU                 = 26,
    RC_CHANNELS                = 65,
    VFR_HUD                    = 74,
    COMMAND_LONG               = 76,
    VISION_POSITION_ESTIMATE   = 102,
    ODOMETRY                   = 331,
    OPTICAL_FLOW_RAD           = 106,
    STATUSTEXT                 = 253,
};

inline const char* mavmsg_str(MAVMsgType t) {
    switch(t) {
        case MAVMsgType::HEARTBEAT: return "HEARTBEAT";
        case MAVMsgType::ATTITUDE: return "ATTITUDE";
        case MAVMsgType::GLOBAL_POSITION_INT: return "GLOBAL_POS";
        case MAVMsgType::GPS_RAW_INT: return "GPS_RAW";
        case MAVMsgType::SCALED_IMU: return "SCALED_IMU";
        case MAVMsgType::RC_CHANNELS: return "RC_CHANNELS";
        case MAVMsgType::VFR_HUD: return "VFR_HUD";
        case MAVMsgType::COMMAND_LONG: return "CMD_LONG";
        case MAVMsgType::VISION_POSITION_ESTIMATE: return "VISION_POS";
        case MAVMsgType::ODOMETRY: return "ODOMETRY";
        case MAVMsgType::OPTICAL_FLOW_RAD: return "OPT_FLOW_RAD";
        case MAVMsgType::STATUSTEXT: return "STATUSTEXT";
        default: return "UNKNOWN";
    }
}

// ─── MAVLink Connection State ────────────────────────────

enum class MAVLinkState : uint8_t {
    DISCONNECTED = 0,
    CONNECTING,
    CONNECTED,
    LOST
};

inline const char* mavstate_str(MAVLinkState s) {
    switch(s) {
        case MAVLinkState::DISCONNECTED: return "DISCONNECTED";
        case MAVLinkState::CONNECTING: return "CONNECTING";
        case MAVLinkState::CONNECTED: return "CONNECTED";
        case MAVLinkState::LOST: return "LOST";
        default: return "UNKNOWN";
    }
}

// ─── MAVLink Messages ────────────────────────────────────

struct MAVVisionPositionEstimate {
    uint64_t usec{0};
    float x{0}, y{0}, z{0};             // m, NED
    float roll{0}, pitch{0}, yaw{0};     // rad
    float covariance[21]{};              // row-major upper triangle
};

struct MAVOdometry {
    uint64_t time_usec{0};
    float x{0}, y{0}, z{0};             // m
    float vx{0}, vy{0}, vz{0};          // m/s
    float rollspeed{0}, pitchspeed{0}, yawspeed{0}; // rad/s
    float q[4]{1, 0, 0, 0};             // quaternion (w,x,y,z)
    uint8_t frame_id{0};                // MAV_FRAME
    uint8_t child_frame_id{0};
    float quality{0};                    // 0-1
};

struct MAVOpticalFlowRad {
    uint64_t time_usec{0};
    float integrated_x{0};               // rad
    float integrated_y{0};               // rad
    float integrated_xgyro{0};           // rad
    float integrated_ygyro{0};           // rad
    float integrated_zgyro{0};           // rad
    uint32_t integration_time_us{0};
    float distance{0};                    // m
    int16_t temperature{0};               // cdeg
    uint8_t quality{0};                   // 0-255
    uint32_t time_delta_distance_us{0};
};

// ─── MAVLink Interface Stats ─────────────────────────────

struct MAVLinkStats {
    MAVLinkState state{MAVLinkState::DISCONNECTED};
    uint32_t messages_sent{0};
    uint32_t messages_received{0};
    uint32_t errors{0};
    float    link_quality{0};            // 0-1
    uint64_t last_heartbeat_us{0};
    uint8_t  system_id{1};
    uint8_t  component_id{191};          // MAV_COMP_ID_ONBOARD_COMPUTER
    // FC info
    uint8_t  fc_system_id{1};
    uint8_t  fc_autopilot{0};            // MAV_AUTOPILOT type
    uint8_t  fc_type{0};                 // MAV_TYPE
    bool     fc_armed{false};
    char     fc_firmware[32]{};
};

// ─── MAVLink Interface ──────────────────────────────────

class MAVLinkInterface {
public:
    MAVLinkInterface();
    
    // Lifecycle
    bool initialize(bool simulated = true);
    void shutdown();
    
    // Send messages to FC
    bool send_vision_position(const MAVVisionPositionEstimate& msg);
    bool send_odometry(const MAVOdometry& msg);
    bool send_optical_flow_rad(const MAVOpticalFlowRad& msg);
    bool send_heartbeat();
    
    // Build messages from runtime state
    MAVVisionPositionEstimate build_vision_position(const SystemState& state, const VOResult& vo);
    MAVOdometry build_odometry(const SystemState& state, const VOResult& vo);
    MAVOpticalFlowRad build_optical_flow_rad(const OpticalFlowData& flow, const VOResult& vo);
    
    // Process tick (send periodic messages, check connection)
    void tick(const SystemState& state, const VOResult& vo);
    
    // State
    MAVLinkState connection_state() const { return state_; }
    MAVLinkStats get_stats() const;
    bool is_connected() const { return state_ == MAVLinkState::CONNECTED; }

private:
    MAVLinkState state_{MAVLinkState::DISCONNECTED};
    bool simulated_{true};
    
    // Stats
    std::atomic<uint32_t> msgs_sent_{0};
    std::atomic<uint32_t> msgs_received_{0};
    std::atomic<uint32_t> errors_{0};
    uint64_t last_heartbeat_us_{0};
    uint64_t last_vision_us_{0};
    uint32_t heartbeat_count_{0};
    
    // Simulated FC state
    uint8_t fc_system_id_{1};
    bool    fc_armed_{false};
    
    // Connection monitoring
    static constexpr uint64_t HEARTBEAT_TIMEOUT_US = 3'000'000; // 3 seconds
    void check_connection();
};

} // namespace jtzero
