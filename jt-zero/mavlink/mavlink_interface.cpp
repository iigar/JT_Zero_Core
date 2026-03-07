/**
 * JT-Zero MAVLink Interface Implementation
 * 
 * Simulated MAVLink communication for development/testing.
 * On real hardware, replace with actual serial/UDP MAVLink connection.
 */

#include "jt_zero/mavlink_interface.h"
#include <cstdio>
#include <cstring>
#include <cmath>

namespace jtzero {

MAVLinkInterface::MAVLinkInterface() = default;

bool MAVLinkInterface::initialize(bool simulated) {
    simulated_ = simulated;
    
    if (simulated) {
        // In simulator mode, immediately "connect"
        state_ = MAVLinkState::CONNECTED;
        last_heartbeat_us_ = now_us();
        std::printf("[MAVLink] Simulated connection established\n");
    } else {
        state_ = MAVLinkState::CONNECTING;
        std::printf("[MAVLink] Attempting real connection...\n");
        // Real implementation: open serial port or UDP socket
    }
    
    return true;
}

void MAVLinkInterface::shutdown() {
    state_ = MAVLinkState::DISCONNECTED;
    std::printf("[MAVLink] Disconnected\n");
}

bool MAVLinkInterface::send_vision_position(const MAVVisionPositionEstimate& msg) {
    if (state_ != MAVLinkState::CONNECTED) return false;
    
    if (simulated_) {
        // In sim mode, just count
        msgs_sent_.fetch_add(1, std::memory_order_relaxed);
        return true;
    }
    
    // Real: serialize MAVLink v2 message and send
    msgs_sent_.fetch_add(1, std::memory_order_relaxed);
    return true;
}

bool MAVLinkInterface::send_odometry(const MAVOdometry& msg) {
    if (state_ != MAVLinkState::CONNECTED) return false;
    
    msgs_sent_.fetch_add(1, std::memory_order_relaxed);
    return true;
}

bool MAVLinkInterface::send_optical_flow_rad(const MAVOpticalFlowRad& msg) {
    if (state_ != MAVLinkState::CONNECTED) return false;
    
    msgs_sent_.fetch_add(1, std::memory_order_relaxed);
    return true;
}

bool MAVLinkInterface::send_heartbeat() {
    if (state_ != MAVLinkState::CONNECTED && state_ != MAVLinkState::CONNECTING) return false;
    
    last_heartbeat_us_ = now_us();
    heartbeat_count_++;
    msgs_sent_.fetch_add(1, std::memory_order_relaxed);
    
    if (simulated_) {
        // Simulate receiving heartbeat from FC
        msgs_received_.fetch_add(1, std::memory_order_relaxed);
        fc_armed_ = false; // Updated by command interface
    }
    
    return true;
}

MAVVisionPositionEstimate MAVLinkInterface::build_vision_position(
    const SystemState& state, const VOResult& vo) {
    
    MAVVisionPositionEstimate msg;
    msg.usec = now_us();
    msg.x = state.gps.lat * 111320.0f;  // Approximate conversion
    msg.y = state.gps.lon * 111320.0f * std::cos(state.gps.lat * 0.0174533f);
    msg.z = -state.altitude_agl;         // NED: down is positive
    msg.roll  = state.roll * 0.0174533f;  // deg to rad
    msg.pitch = state.pitch * 0.0174533f;
    msg.yaw   = state.yaw * 0.0174533f;
    
    // Add VO deltas
    msg.x += vo.dx;
    msg.y += vo.dy;
    msg.z += vo.dz;
    
    return msg;
}

MAVOdometry MAVLinkInterface::build_odometry(
    const SystemState& state, const VOResult& vo) {
    
    MAVOdometry msg;
    msg.time_usec = now_us();
    msg.x = vo.dx;
    msg.y = vo.dy;
    msg.z = vo.dz;
    msg.vx = state.vx + vo.vx;
    msg.vy = state.vy + vo.vy;
    msg.vz = state.vz + vo.vz;
    msg.rollspeed  = state.imu.gyro_x;
    msg.pitchspeed = state.imu.gyro_y;
    msg.yawspeed   = state.imu.gyro_z;
    msg.quality = vo.tracking_quality;
    msg.frame_id = 0;       // MAV_FRAME_LOCAL_NED
    msg.child_frame_id = 1; // MAV_FRAME_BODY_FRD
    
    // Quaternion from Euler (simplified)
    float cr = std::cos(state.roll * 0.0087266f);
    float sr = std::sin(state.roll * 0.0087266f);
    float cp = std::cos(state.pitch * 0.0087266f);
    float sp = std::sin(state.pitch * 0.0087266f);
    float cy = std::cos(state.yaw * 0.0087266f);
    float sy = std::sin(state.yaw * 0.0087266f);
    
    msg.q[0] = cr * cp * cy + sr * sp * sy;
    msg.q[1] = sr * cp * cy - cr * sp * sy;
    msg.q[2] = cr * sp * cy + sr * cp * sy;
    msg.q[3] = cr * cp * sy - sr * sp * cy;
    
    return msg;
}

MAVOpticalFlowRad MAVLinkInterface::build_optical_flow_rad(
    const OpticalFlowData& flow, const VOResult& vo) {
    
    MAVOpticalFlowRad msg;
    msg.time_usec = now_us();
    msg.integrated_x = flow.flow_x;
    msg.integrated_y = flow.flow_y;
    msg.integrated_xgyro = 0;
    msg.integrated_ygyro = 0;
    msg.integrated_zgyro = 0;
    msg.integration_time_us = 20000; // 50Hz
    msg.distance = flow.ground_distance;
    msg.temperature = 2200; // 22.00 C
    msg.quality = flow.quality;
    msg.time_delta_distance_us = 20000;
    
    return msg;
}

void MAVLinkInterface::tick(const SystemState& state, const VOResult& vo) {
    if (state_ == MAVLinkState::DISCONNECTED) return;
    
    check_connection();
    
    // Send heartbeat every ~1 second (called at 50Hz)
    if (heartbeat_count_ % 50 == 0) {
        send_heartbeat();
    }
    heartbeat_count_++;
    
    // Send vision position at ~30Hz
    uint64_t current = now_us();
    if (current - last_vision_us_ >= 33333) { // ~30Hz
        if (vo.valid) {
            auto vis_msg = build_vision_position(state, vo);
            send_vision_position(vis_msg);
            
            auto odom_msg = build_odometry(state, vo);
            send_odometry(odom_msg);
        }
        
        if (state.flow.valid) {
            auto flow_msg = build_optical_flow_rad(state.flow, vo);
            send_optical_flow_rad(flow_msg);
        }
        
        last_vision_us_ = current;
    }
}

MAVLinkStats MAVLinkInterface::get_stats() const {
    MAVLinkStats stats;
    stats.state = state_;
    stats.messages_sent = msgs_sent_.load(std::memory_order_relaxed);
    stats.messages_received = msgs_received_.load(std::memory_order_relaxed);
    stats.errors = errors_.load(std::memory_order_relaxed);
    stats.last_heartbeat_us = last_heartbeat_us_;
    stats.system_id = 1;
    stats.component_id = 191;
    stats.fc_system_id = fc_system_id_;
    stats.fc_armed = fc_armed_;
    
    // Link quality (simulated)
    if (state_ == MAVLinkState::CONNECTED) {
        stats.link_quality = 0.95f;
    } else {
        stats.link_quality = 0;
    }
    
    std::strncpy(stats.fc_firmware, "ArduPilot 4.5.0", sizeof(stats.fc_firmware) - 1);
    
    return stats;
}

void MAVLinkInterface::check_connection() {
    if (simulated_) {
        // Always connected in sim mode
        state_ = MAVLinkState::CONNECTED;
        return;
    }
    
    uint64_t current = now_us();
    if (state_ == MAVLinkState::CONNECTED) {
        if (current - last_heartbeat_us_ > HEARTBEAT_TIMEOUT_US) {
            state_ = MAVLinkState::LOST;
            std::printf("[MAVLink] Connection lost (heartbeat timeout)\n");
        }
    }
}

} // namespace jtzero
