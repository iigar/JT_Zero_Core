/**
 * JT-Zero Runtime Implementation
 * Main orchestrator - manages all engines, threads, and system lifecycle
 */

#include "jt_zero/runtime.h"
#include <cmath>
#include <cstdio>
#include <cstring>

namespace jtzero {

Runtime::Runtime() = default;

Runtime::~Runtime() {
    stop();
}

bool Runtime::initialize() {
    std::printf("[JT-Zero] Initializing runtime...\n");
    
    // Initialize sensors
    imu_.set_simulated(simulator_mode_);
    baro_.set_simulated(simulator_mode_);
    gps_sensor_.set_simulated(simulator_mode_);
    range_.set_simulated(simulator_mode_);
    flow_.set_simulated(simulator_mode_);
    
    if (!imu_.initialize()) {
        std::printf("[JT-Zero] IMU init failed\n");
        return false;
    }
    if (!baro_.initialize()) {
        std::printf("[JT-Zero] Barometer init failed\n");
        return false;
    }
    if (!gps_sensor_.initialize()) {
        std::printf("[JT-Zero] GPS init failed\n");
        return false;
    }
    if (!range_.initialize()) {
        std::printf("[JT-Zero] Rangefinder init failed\n");
        return false;
    }
    if (!flow_.initialize()) {
        std::printf("[JT-Zero] Optical Flow init failed\n");
        return false;
    }
    
    // Setup default rules
    setup_default_reflexes();
    setup_default_rules();
    
    // Initialize camera pipeline
    std::printf("[JT-Zero] Initializing camera pipeline...\n");
    if (!camera_.initialize(CameraType::SIMULATED)) {
        std::printf("[JT-Zero] Camera init failed (non-critical)\n");
    }
    
    // Initialize MAVLink
    std::printf("[JT-Zero] Initializing MAVLink interface...\n");
    mavlink_.initialize(simulator_mode_);
    
    // Set output handler
    output_engine_.set_handler([](const OutputCommand& cmd) {
        const char* prefix = "INFO";
        switch (cmd.type) {
            case OutputType::LOG_WARNING: prefix = "WARN"; break;
            case OutputType::LOG_ERROR:   prefix = "ERR "; break;
            case OutputType::GPIO_SET:    prefix = "GPIO"; break;
            case OutputType::MAVLINK_CMD: prefix = "MAV "; break;
            default: break;
        }
        std::printf("[OUT/%s] %s\n", prefix, cmd.message);
    });
    
    // Initial state
    state_.flight_mode = FlightMode::IDLE;
    state_.battery_voltage = 12.6f;
    state_.battery_percent = 100.0f;
    
    // Emit startup event
    event_engine_.emit(EventType::SYSTEM_STARTUP, 255, "JT-Zero runtime initialized");
    
    std::printf("[JT-Zero] Runtime initialized (simulator=%s)\n", 
                simulator_mode_ ? "true" : "false");
    return true;
}

void Runtime::start() {
    if (running_.load()) return;
    running_.store(true);
    
    std::printf("[JT-Zero] Starting runtime threads...\n");
    
    t0_supervisor_ = std::thread([this]() { supervisor_loop(); });
    t1_sensors_    = std::thread([this]() { sensor_loop(); });
    t2_events_     = std::thread([this]() { event_loop(); });
    t3_reflex_     = std::thread([this]() { reflex_loop(); });
    t4_rules_      = std::thread([this]() { rule_loop(); });
    t5_mavlink_    = std::thread([this]() { mavlink_loop(); });
    t6_camera_     = std::thread([this]() { camera_loop(); });
    t7_api_        = std::thread([this]() { api_bridge_loop(); });
    
    std::printf("[JT-Zero] All threads started (8 threads)\n");
}

void Runtime::stop() {
    if (!running_.load()) return;
    
    std::printf("[JT-Zero] Stopping runtime...\n");
    running_.store(false);
    
    if (t0_supervisor_.joinable()) t0_supervisor_.join();
    if (t1_sensors_.joinable())    t1_sensors_.join();
    if (t2_events_.joinable())     t2_events_.join();
    if (t3_reflex_.joinable())     t3_reflex_.join();
    if (t4_rules_.joinable())      t4_rules_.join();
    if (t5_mavlink_.joinable())    t5_mavlink_.join();
    if (t6_camera_.joinable())     t6_camera_.join();
    if (t7_api_.joinable())        t7_api_.join();
    
    // Shutdown camera & MAVLink
    camera_.shutdown();
    mavlink_.shutdown();
    
    event_engine_.emit(EventType::SYSTEM_SHUTDOWN, 255, "Runtime stopped");
    std::printf("[JT-Zero] Runtime stopped\n");
}

bool Runtime::is_running() const {
    return running_.load(std::memory_order_acquire);
}

bool Runtime::send_command(const char* cmd, float param1, float param2) {
    Event e;
    e.timestamp_us = now_us();
    e.type = EventType::CMD_USER;
    e.priority = 200;
    e.data[0] = param1;
    e.data[1] = param2;
    e.set_message(cmd);
    
    // Parse command
    if (std::strcmp(cmd, "arm") == 0) {
        e.type = EventType::FLIGHT_ARM;
        state_.armed = true;
        state_.flight_mode = FlightMode::ARMED;
    } else if (std::strcmp(cmd, "disarm") == 0) {
        e.type = EventType::FLIGHT_DISARM;
        state_.armed = false;
        state_.flight_mode = FlightMode::IDLE;
    } else if (std::strcmp(cmd, "takeoff") == 0) {
        e.type = EventType::FLIGHT_TAKEOFF;
        state_.flight_mode = FlightMode::TAKEOFF;
    } else if (std::strcmp(cmd, "land") == 0) {
        e.type = EventType::FLIGHT_LAND;
        state_.flight_mode = FlightMode::LAND;
    } else if (std::strcmp(cmd, "rtl") == 0) {
        e.type = EventType::FLIGHT_RTL;
        state_.flight_mode = FlightMode::RTL;
    } else if (std::strcmp(cmd, "hold") == 0) {
        e.type = EventType::FLIGHT_HOLD;
        state_.flight_mode = FlightMode::HOVER;
    }
    
    return event_engine_.emit(e);
}

Runtime::ThreadStats Runtime::get_thread_stats(int thread_id) const {
    if (thread_id < 0 || thread_id >= NUM_THREADS) {
        return {"unknown", 0, 0, 0, 0, false};
    }
    
    const auto& s = thread_stats_[thread_id];
    return {
        THREAD_CONFIGS[thread_id].name,
        s.actual_hz.load(std::memory_order_relaxed),
        s.cpu_percent.load(std::memory_order_relaxed),
        s.loop_count.load(std::memory_order_relaxed),
        s.max_latency_us.load(std::memory_order_relaxed),
        s.running.load(std::memory_order_relaxed)
    };
}

// ─── Thread Loops ────────────────────────────────────────

void Runtime::rate_sleep(TimePoint& next_wake, int hz) {
    next_wake += std::chrono::microseconds(1'000'000 / hz);
    std::this_thread::sleep_until(next_wake);
}

void Runtime::update_thread_stats(int id, TimePoint start, TimePoint end, int target_hz) {
    auto& s = thread_stats_[id];
    const auto elapsed_us = std::chrono::duration_cast<Duration>(end - start).count();
    const uint64_t loop = s.loop_count.fetch_add(1, std::memory_order_relaxed);
    
    // Update max latency
    uint64_t current_max = s.max_latency_us.load(std::memory_order_relaxed);
    while (static_cast<uint64_t>(elapsed_us) > current_max && 
           !s.max_latency_us.compare_exchange_weak(current_max, elapsed_us,
               std::memory_order_relaxed)) {}
    
    // Update actual Hz (every 100 loops)
    if (loop % 100 == 0 && loop > 0) {
        // Approximate
        s.actual_hz.store(static_cast<double>(target_hz), std::memory_order_relaxed);
    }
    
    // CPU usage estimate
    const double period_us = 1'000'000.0 / target_hz;
    s.cpu_percent.store(100.0 * elapsed_us / period_us, std::memory_order_relaxed);
}

void Runtime::supervisor_loop() {
    constexpr int HZ = 10;
    thread_stats_[0].running.store(true);
    auto next_wake = SteadyClock::now();
    
    while (running_.load(std::memory_order_acquire)) {
        auto start = SteadyClock::now();
        
        // Update system state
        state_.uptime_sec = static_cast<uint32_t>(now_sec());
        state_.event_count = static_cast<uint32_t>(event_engine_.total_events());
        
        // Battery simulation (slow drain)
        state_.battery_voltage -= 0.00001f * sim_config_.battery_drain;
        if (state_.battery_voltage < 10.0f) state_.battery_voltage = 10.0f;
        state_.battery_percent = (state_.battery_voltage - 10.0f) / 2.6f * 100.0f;
        
        // Simulated CPU temp
        state_.cpu_temp = 42.0f + static_cast<float>(rand() % 100) / 100.0f;
        
        // Flight physics (10 Hz)
        update_flight_physics(0.1f);
        
        // Emit heartbeat
        event_engine_.emit(EventType::SYSTEM_HEARTBEAT, 50, "heartbeat");
        
        // Record telemetry
        memory_engine_.record_telemetry(state_);
        
        // Process outputs
        output_engine_.process_pending();
        
        auto end = SteadyClock::now();
        update_thread_stats(0, start, end, HZ);
        rate_sleep(next_wake, HZ);
    }
    
    thread_stats_[0].running.store(false);
}

void Runtime::sensor_loop() {
    constexpr int HZ = 200;
    thread_stats_[1].running.store(true);
    auto next_wake = SteadyClock::now();
    int cycle = 0;
    
    while (running_.load(std::memory_order_acquire)) {
        auto start = SteadyClock::now();
        
        // IMU: every cycle (200 Hz)
        imu_.update();
        state_.imu = imu_.data();
        
        // Derive attitude from accelerometer (simplified)
        state_.roll  = std::atan2(state_.imu.acc_y, state_.imu.acc_z) * 57.2958f;
        state_.pitch = std::atan2(-state_.imu.acc_x, 
                       std::sqrt(state_.imu.acc_y * state_.imu.acc_y + 
                                 state_.imu.acc_z * state_.imu.acc_z)) * 57.2958f;
        state_.yaw  += state_.imu.gyro_z * (1.0f / HZ) * 57.2958f;
        if (state_.yaw > 360.0f) state_.yaw -= 360.0f;
        if (state_.yaw < 0.0f) state_.yaw += 360.0f;
        
        // Barometer: every 4th cycle (50 Hz)
        if (cycle % 4 == 0) {
            baro_.update();
            state_.baro = baro_.data();
            state_.altitude_agl = state_.baro.altitude;
        }
        
        // GPS: every 20th cycle (10 Hz)
        if (cycle % 20 == 0) {
            gps_sensor_.update();
            state_.gps = gps_sensor_.data();
        }
        
        // Rangefinder: every 4th cycle (50 Hz)
        if (cycle % 4 == 1) {
            range_.update();
            state_.range = range_.data();
        }
        
        // Optical Flow: every 4th cycle (50 Hz)
        if (cycle % 4 == 2) {
            flow_.update();
            state_.flow = flow_.data();
        }
        
        // Emit sensor events periodically
        if (cycle % 20 == 0) {
            event_engine_.emit(EventType::SENSOR_IMU_UPDATE, 10);
        }
        
        cycle++;
        auto end = SteadyClock::now();
        update_thread_stats(1, start, end, HZ);
        rate_sleep(next_wake, HZ);
    }
    
    thread_stats_[1].running.store(false);
}

void Runtime::event_loop() {
    constexpr int HZ = 200;
    thread_stats_[2].running.store(true);
    auto next_wake = SteadyClock::now();
    
    while (running_.load(std::memory_order_acquire)) {
        auto start = SteadyClock::now();
        
        // Process all pending events
        Event event;
        int count = 0;
        while (event_engine_.poll(event) && count < 10) {
            // Record in memory
            memory_engine_.record_event(event);
            
            // Forward to reflex engine
            reflex_engine_.process(event, state_, event_engine_);
            
            count++;
        }
        
        auto end = SteadyClock::now();
        update_thread_stats(2, start, end, HZ);
        rate_sleep(next_wake, HZ);
    }
    
    thread_stats_[2].running.store(false);
}

void Runtime::reflex_loop() {
    constexpr int HZ = 200;
    thread_stats_[3].running.store(true);
    auto next_wake = SteadyClock::now();
    
    while (running_.load(std::memory_order_acquire)) {
        auto start = SteadyClock::now();
        
        // Reflex engine processes events inline in event_loop
        // This thread handles time-based reflexes
        
        // Check for obstacle proximity
        if (state_.range.valid && state_.range.distance < 0.5f) {
            Event e;
            e.timestamp_us = now_us();
            e.type = EventType::FLIGHT_OBSTACLE_DETECTED;
            e.priority = 250;
            e.data[0] = state_.range.distance;
            e.set_message("Obstacle proximity alert!");
            event_engine_.emit(e);
        }
        
        auto end = SteadyClock::now();
        update_thread_stats(3, start, end, HZ);
        rate_sleep(next_wake, HZ);
    }
    
    thread_stats_[3].running.store(false);
}

void Runtime::rule_loop() {
    constexpr int HZ = 20;
    thread_stats_[4].running.store(true);
    auto next_wake = SteadyClock::now();
    
    while (running_.load(std::memory_order_acquire)) {
        auto start = SteadyClock::now();
        
        // Evaluate behavior rules
        auto result = rule_engine_.evaluate(state_);
        if (result.action != RuleAction::NONE) {
            rule_engine_.execute(result, state_, event_engine_);
        }
        
        auto end = SteadyClock::now();
        update_thread_stats(4, start, end, HZ);
        rate_sleep(next_wake, HZ);
    }
    
    thread_stats_[4].running.store(false);
}

// ─── Default Reflexes ────────────────────────────────────

void Runtime::setup_default_reflexes() {
    // Emergency stop on critical error
    ReflexRule emergency_stop;
    emergency_stop.name = "emergency_stop";
    emergency_stop.trigger = EventType::SYSTEM_ERROR;
    emergency_stop.min_priority = 200;
    emergency_stop.cooldown_us = 1'000'000;  // 1 second
    emergency_stop.condition = [](const Event&, const SystemState& state) {
        return state.armed;
    };
    emergency_stop.action = [](const Event&, SystemState& state, EventEngine& events) {
        state.flight_mode = FlightMode::EMERGENCY;
        state.armed = false;
        events.emit(EventType::FLIGHT_DISARM, 255, "EMERGENCY STOP");
    };
    reflex_engine_.add_rule(emergency_stop);
    
    // Low battery warning
    ReflexRule low_battery;
    low_battery.name = "low_battery_warning";
    low_battery.trigger = EventType::SYSTEM_HEARTBEAT;
    low_battery.min_priority = 0;
    low_battery.cooldown_us = 5'000'000;  // 5 seconds
    low_battery.condition = [](const Event&, const SystemState& state) {
        return state.battery_percent < 20.0f;
    };
    low_battery.action = [](const Event&, SystemState&, EventEngine& events) {
        events.emit(EventType::SYSTEM_WARNING, 150, "Low battery warning");
    };
    reflex_engine_.add_rule(low_battery);
    
    // Altitude limit
    ReflexRule altitude_limit;
    altitude_limit.name = "altitude_limit";
    altitude_limit.trigger = EventType::SENSOR_BARO_UPDATE;
    altitude_limit.min_priority = 0;
    altitude_limit.cooldown_us = 2'000'000;
    altitude_limit.condition = [](const Event&, const SystemState& state) {
        return state.altitude_agl > 120.0f && state.armed;
    };
    altitude_limit.action = [](const Event&, SystemState&, EventEngine& events) {
        events.emit(EventType::SYSTEM_WARNING, 180, "Altitude limit exceeded");
    };
    reflex_engine_.add_rule(altitude_limit);
}

// ─── Default Rules ───────────────────────────────────────

// ─── Flight Physics ──────────────────────────────────────

void Runtime::update_flight_physics(float dt) {
    if (!simulator_mode_) return;
    
    auto& s = state_;
    const auto& cfg = sim_config_;
    
    // Gravity + thrust model
    float thrust = 0.0f;
    float target_vz = 0.0f;
    
    switch (s.flight_mode) {
        case FlightMode::IDLE:
        case FlightMode::ARMED:
            // On ground
            s.altitude_agl = 0.0f;
            s.vx = s.vy = s.vz = 0.0f;
            s.pos_n = s.pos_e = s.pos_d = 0.0f;
            s.motor[0] = s.motor[1] = s.motor[2] = s.motor[3] = 0.0f;
            s.baro.altitude = 0.0f;
            s.baro.pressure = 1013.25f;
            s.range.distance = 0.0f;
            break;
            
        case FlightMode::TAKEOFF:
            // Climb to target altitude
            target_vz = 2.0f;  // m/s climb rate
            if (s.altitude_agl >= s.target_altitude) {
                s.flight_mode = FlightMode::HOVER;
                event_engine_.emit(EventType::FLIGHT_ALTITUDE_REACHED, 150, "Target altitude reached");
            }
            thrust = cfg.gravity * cfg.mass_kg + cfg.mass_kg * 1.5f;
            s.motor[0] = s.motor[1] = s.motor[2] = s.motor[3] = 0.7f;
            break;
            
        case FlightMode::HOVER:
            // Maintain altitude
            target_vz = (s.target_altitude - s.altitude_agl) * 0.8f;
            target_vz = std::max(-1.0f, std::min(1.0f, target_vz));
            thrust = cfg.gravity * cfg.mass_kg;
            s.motor[0] = s.motor[1] = s.motor[2] = s.motor[3] = 0.5f;
            break;
            
        case FlightMode::NAVIGATE:
            // Simple forward flight + altitude hold
            target_vz = (s.target_altitude - s.altitude_agl) * 0.8f;
            target_vz = std::max(-1.0f, std::min(1.0f, target_vz));
            s.vx = 2.0f;  // Forward 2 m/s
            thrust = cfg.gravity * cfg.mass_kg;
            s.motor[0] = s.motor[1] = 0.55f;
            s.motor[2] = s.motor[3] = 0.50f;
            break;
            
        case FlightMode::LAND:
            // Controlled descent
            target_vz = -0.5f;
            if (s.altitude_agl <= 0.1f) {
                s.altitude_agl = 0.0f;
                s.armed = false;
                s.flight_mode = FlightMode::IDLE;
                s.vx = s.vy = s.vz = 0.0f;
                s.motor[0] = s.motor[1] = s.motor[2] = s.motor[3] = 0.0f;
                event_engine_.emit(EventType::FLIGHT_DISARM, 200, "Landed and disarmed");
                return;
            }
            thrust = cfg.gravity * cfg.mass_kg * 0.85f;
            s.motor[0] = s.motor[1] = s.motor[2] = s.motor[3] = 0.35f;
            break;
            
        case FlightMode::RTL:
            // Return to launch + descend
            s.vx *= 0.95f;
            s.vy *= 0.95f;
            s.pos_n *= 0.98f;
            s.pos_e *= 0.98f;
            target_vz = -0.3f;
            if (s.altitude_agl <= 0.5f && 
                std::abs(s.pos_n) < 1.0f && std::abs(s.pos_e) < 1.0f) {
                s.flight_mode = FlightMode::LAND;
                event_engine_.emit(EventType::FLIGHT_LAND, 180, "RTL: landing at home");
            }
            thrust = cfg.gravity * cfg.mass_kg * 0.9f;
            s.motor[0] = s.motor[1] = s.motor[2] = s.motor[3] = 0.4f;
            break;
            
        case FlightMode::EMERGENCY:
            // Kill motors
            thrust = 0;
            s.motor[0] = s.motor[1] = s.motor[2] = s.motor[3] = 0.0f;
            target_vz = -cfg.gravity;
            if (s.altitude_agl <= 0.0f) {
                s.altitude_agl = 0.0f;
                s.vz = 0.0f;
            }
            break;
    }
    
    // Vertical dynamics
    float accel_z = (thrust / cfg.mass_kg) - cfg.gravity;
    s.vz += (target_vz - s.vz) * 3.0f * dt;  // Smooth towards target
    s.altitude_agl += s.vz * dt;
    if (s.altitude_agl < 0.0f) {
        s.altitude_agl = 0.0f;
        s.vz = 0.0f;
    }
    
    // Horizontal drag
    s.vx -= s.vx * cfg.drag_coeff * dt;
    s.vy -= s.vy * cfg.drag_coeff * dt;
    
    // Wind effect
    if (cfg.wind_speed > 0.0f) {
        float wind_rad = cfg.wind_direction * 0.0174533f;
        s.vx += cfg.wind_speed * std::cos(wind_rad) * 0.01f;
        s.vy += cfg.wind_speed * std::sin(wind_rad) * 0.01f;
    }
    
    // Position update
    s.pos_n += s.vx * dt;
    s.pos_e += s.vy * dt;
    s.pos_d = -s.altitude_agl;
    
    // Update barometer to reflect altitude
    s.baro.altitude = s.altitude_agl;
    s.baro.pressure = 1013.25f - (s.altitude_agl * 0.12f);
    
    // Update rangefinder
    s.range.distance = s.altitude_agl;
    s.range.valid = s.altitude_agl < 40.0f;
}

void Runtime::setup_default_rules() {
    // Auto-RTL on very low battery
    BehaviorRule auto_rtl;
    auto_rtl.name = "auto_rtl_low_battery";
    auto_rtl.priority = 100;
    auto_rtl.required_mode = FlightMode::IDLE;  // Any mode
    auto_rtl.evaluate = [](const SystemState& state, RuleResult& result) -> bool {
        if (state.battery_percent < 10.0f && state.armed) {
            result.action = RuleAction::RTL;
            std::strncpy(result.message, "Auto RTL: battery critical", sizeof(result.message));
            return true;
        }
        return false;
    };
    rule_engine_.add_rule(auto_rtl);
    
    // GPS lost → hold position
    BehaviorRule gps_lost_hold;
    gps_lost_hold.name = "gps_lost_hold";
    gps_lost_hold.priority = 90;
    gps_lost_hold.required_mode = FlightMode::IDLE;
    gps_lost_hold.evaluate = [](const SystemState& state, RuleResult& result) -> bool {
        if (!state.gps.valid && state.armed && 
            state.flight_mode == FlightMode::NAVIGATE) {
            result.action = RuleAction::HOLD;
            std::strncpy(result.message, "GPS lost: holding position", sizeof(result.message));
            return true;
        }
        return false;
    };
    rule_engine_.add_rule(gps_lost_hold);
    
    // Takeoff complete detection
    BehaviorRule takeoff_complete;
    takeoff_complete.name = "takeoff_complete";
    takeoff_complete.priority = 50;
    takeoff_complete.required_mode = FlightMode::TAKEOFF;
    takeoff_complete.evaluate = [](const SystemState& state, RuleResult& result) -> bool {
        if (state.altitude_agl > 2.0f) {
            result.action = RuleAction::HOLD;
            std::strncpy(result.message, "Takeoff complete, hovering", sizeof(result.message));
            return true;
        }
        return false;
    };
    rule_engine_.add_rule(takeoff_complete);
}

// ─── MAVLink Thread ──────────────────────────────────────

void Runtime::mavlink_loop() {
    constexpr int HZ = 50;
    thread_stats_[5].running.store(true);
    auto next_wake = SteadyClock::now();
    
    while (running_.load(std::memory_order_acquire)) {
        auto start = SteadyClock::now();
        
        // Build VO result from camera
        VOResult vo = camera_.last_vo_result();
        
        // MAVLink tick: sends heartbeat, vision position, odometry, optical flow
        mavlink_.tick(state_, vo);
        
        // Emit MAVLink heartbeat event periodically
        if (thread_stats_[5].loop_count.load(std::memory_order_relaxed) % 50 == 0) {
            event_engine_.emit(EventType::MAVLINK_HEARTBEAT, 30, "MAVLink heartbeat");
        }
        
        auto end = SteadyClock::now();
        update_thread_stats(5, start, end, HZ);
        rate_sleep(next_wake, HZ);
    }
    
    thread_stats_[5].running.store(false);
}

// ─── Camera Thread ───────────────────────────────────────

void Runtime::camera_loop() {
    constexpr int HZ = 15;
    thread_stats_[6].running.store(true);
    auto next_wake = SteadyClock::now();
    
    while (running_.load(std::memory_order_acquire)) {
        auto start = SteadyClock::now();
        
        float ground_dist = state_.range.valid ? state_.range.distance : 1.0f;
        
        if (camera_.is_running()) {
            camera_.tick(ground_dist);
            
            // Emit frame event periodically
            auto stats = camera_.get_stats();
            if (stats.frame_count % 15 == 0) {
                char msg[64];
                std::snprintf(msg, sizeof(msg), 
                    "frame=%u feat=%u/%u q=%.0f%%",
                    stats.frame_count, 
                    stats.vo_features_tracked,
                    stats.vo_features_detected,
                    stats.vo_tracking_quality * 100.0f);
                event_engine_.emit(EventType::CAMERA_VO_UPDATE, 20, msg);
            }
        }
        
        auto end = SteadyClock::now();
        update_thread_stats(6, start, end, HZ);
        rate_sleep(next_wake, HZ);
    }
    
    thread_stats_[6].running.store(false);
}

// ─── API Bridge Thread ───────────────────────────────────

void Runtime::api_bridge_loop() {
    constexpr int HZ = 30;
    thread_stats_[7].running.store(true);
    auto next_wake = SteadyClock::now();
    
    while (running_.load(std::memory_order_acquire)) {
        auto start = SteadyClock::now();
        
        // API bridge thread: maintains runtime state consistency
        // for external API consumers (pybind11/FastAPI).
        // Computes derived metrics and aggregates system health.
        
        // Update RAM usage estimate
        size_t mem = memory_engine_.memory_usage_bytes();
        mem += sizeof(Event) * EventEngine::QUEUE_SIZE;
        mem += sizeof(FrameBuffer) * 2;
        state_.ram_usage_mb = static_cast<float>(mem) / (1024.0f * 1024.0f);
        
        // Aggregate CPU usage from all threads
        double total_cpu = 0;
        for (int i = 0; i < NUM_THREADS; ++i) {
            total_cpu += thread_stats_[i].cpu_percent.load(std::memory_order_relaxed);
        }
        state_.cpu_usage = static_cast<float>(total_cpu);
        
        auto end = SteadyClock::now();
        update_thread_stats(7, start, end, HZ);
        rate_sleep(next_wake, HZ);
    }
    
    thread_stats_[7].running.store(false);
}

} // namespace jtzero
