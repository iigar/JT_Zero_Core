/**
 * JT-Zero Sensor Implementations
 * 
 * Auto-detect hardware: on initialize(), probes I2C/UART for real sensors.
 * If hardware found, uses real driver. Otherwise falls back to simulation.
 * 
 * Auto-detect flow:
 *   1. Try to open /dev/i2c-1
 *   2. Probe 0x68 (MPU6050) and 0x76 (BMP280)
 *   3. Try to open /dev/ttyS0 (GPS UART)
 *   4. If device responds, initialize driver and set simulated_=false
 *   5. If not, stay in simulation mode (no errors, just a log message)
 */

#include "jt_zero/sensors.h"
#include "../drivers/sensor_drivers.h"
#include <cmath>
#include <cstdlib>
#include <cstdio>

namespace jtzero {

// ─── Thread-local xorshift32 PRNG (fast, deterministic per-thread) ───
static thread_local uint32_t prng_state_ = 12345;

static float noise(float amplitude) {
    prng_state_ ^= prng_state_ << 13;
    prng_state_ ^= prng_state_ >> 17;
    prng_state_ ^= prng_state_ << 5;
    float normalized = static_cast<float>(prng_state_) / 4294967295.0f;
    return amplitude * (normalized - 0.5f) * 2.0f;
}

template<typename T>
static T clamp_val(T val, T lo, T hi) {
    return (val < lo) ? lo : (val > hi) ? hi : val;
}

// ═══════════════════════════════════════════════════════════
// Hardware Auto-Detection
// ═══════════════════════════════════════════════════════════

HardwareInfo detect_hardware() {
    HardwareInfo hw;
    
    I2CBus i2c;
    if (i2c.open("/dev/i2c-1")) {
        hw.i2c_available = true;
        
        if (i2c.probe(MPU6050Driver::DEFAULT_ADDR)) {
            hw.imu_detected = true;
            hw.imu_model = "MPU6050";
            std::printf("[HW] MPU6050 detected at 0x68\n");
        } else if (i2c.probe(MPU6050Driver::ALT_ADDR)) {
            hw.imu_detected = true;
            hw.imu_model = "MPU6050";
            std::printf("[HW] MPU6050 detected at 0x69\n");
        }
        
        if (i2c.probe(BMP280Driver::DEFAULT_ADDR)) {
            hw.baro_detected = true;
            hw.baro_model = "BMP280";
            std::printf("[HW] BMP280 detected at 0x76\n");
        } else if (i2c.probe(BMP280Driver::ALT_ADDR)) {
            hw.baro_detected = true;
            hw.baro_model = "BMP280";
            std::printf("[HW] BMP280 detected at 0x77\n");
        }
        
        i2c.close();
    } else {
        std::printf("[HW] I2C bus not available — using simulation\n");
    }
    
    UARTBus uart;
    if (uart.open("/dev/ttyS0", 9600)) {
        hw.uart_available = true;
        hw.gps_detected = true;
        hw.gps_model = "NMEA";
        std::printf("[HW] UART GPS available on /dev/ttyS0\n");
        uart.close();
    } else {
        std::printf("[HW] UART not available — GPS in simulation\n");
    }
    
    return hw;
}

// ═══════════════════════════════════════════════════════════
// IMU Sensor
// ═══════════════════════════════════════════════════════════

bool IMUSensor::try_hardware(I2CBus& bus) {
    static MPU6050Driver driver;
    
    // Try default address first, then alternate
    if (driver.initialize(bus, MPU6050Driver::DEFAULT_ADDR) ||
        driver.initialize(bus, MPU6050Driver::ALT_ADDR)) {
        hw_driver_ = &driver;
        simulated_ = false;
        std::printf("[IMU] Using real MPU6050 hardware\n");
        return true;
    }
    
    std::printf("[IMU] No hardware found — using simulation\n");
    return false;
}

bool IMUSensor::initialize() {
    data_ = {};
    data_.acc_z = -9.81f;
    initialized_ = true;
    return true;
}

bool IMUSensor::update() {
    if (!initialized_) return false;
    
    if (!simulated_ && hw_driver_) {
        // Real hardware read
        return hw_driver_->read(data_);
    }
    
    // Simulation fallback
    update_count_++;
    const double t = static_cast<double>(update_count_) / 200.0;
    
    data_.timestamp_us = now_us();
    data_.gyro_x = 0.01f * std::sin(t * 0.5f) + noise(0.002f);
    data_.gyro_y = 0.008f * std::cos(t * 0.7f) + noise(0.002f);
    data_.gyro_z = 0.005f * std::sin(t * 0.3f) + noise(0.001f);
    data_.acc_x  = 0.1f * std::sin(t * 0.2f) + noise(0.05f);
    data_.acc_y  = 0.08f * std::cos(t * 0.15f) + noise(0.05f);
    data_.acc_z  = -9.81f + 0.05f * std::sin(t * 0.1f) + noise(0.02f);
    data_.valid   = true;
    
    return data_.valid;
}

bool IMUSensor::is_healthy() const {
    return initialized_ && data_.valid;
}

// ═══════════════════════════════════════════════════════════
// Barometer Sensor
// ═══════════════════════════════════════════════════════════

bool BarometerSensor::try_hardware(I2CBus& bus) {
    static BMP280Driver driver;
    
    if (driver.initialize(bus, BMP280Driver::DEFAULT_ADDR) ||
        driver.initialize(bus, BMP280Driver::ALT_ADDR)) {
        hw_driver_ = &driver;
        simulated_ = false;
        std::printf("[BARO] Using real BMP280 hardware\n");
        return true;
    }
    
    std::printf("[BARO] No hardware found — using simulation\n");
    return false;
}

bool BarometerSensor::initialize() {
    data_ = {};
    data_.pressure = base_pressure_;
    data_.temperature = 22.0f;
    initialized_ = true;
    return true;
}

bool BarometerSensor::update() {
    if (!initialized_) return false;
    
    if (!simulated_ && hw_driver_) {
        return hw_driver_->read(data_);
    }
    
    // Simulation
    update_count_++;
    const double t = static_cast<double>(update_count_) / 50.0;
    
    target_alt_ = 5.0f + 2.0f * std::sin(t * 0.05f);
    
    data_.timestamp_us = now_us();
    data_.altitude = target_alt_ + noise(0.1f);
    data_.pressure = base_pressure_ - (data_.altitude * 0.12f) + noise(0.01f);
    data_.temperature = 22.0f + noise(0.5f) - data_.altitude * 0.0065f;
    data_.valid = true;
    
    return data_.valid;
}

bool BarometerSensor::is_healthy() const {
    return initialized_ && data_.valid;
}

// ═══════════════════════════════════════════════════════════
// GPS Sensor
// ═══════════════════════════════════════════════════════════

bool GPSSensor::try_hardware(UARTBus& uart) {
    static NMEAParser parser;
    
    if (parser.initialize(uart)) {
        hw_parser_ = &parser;
        simulated_ = false;
        std::printf("[GPS] Using real NMEA UART hardware\n");
        return true;
    }
    
    std::printf("[GPS] No hardware found — using simulation\n");
    return false;
}

bool GPSSensor::initialize() {
    data_ = {};
    data_.lat = 50.4501;
    data_.lon = 30.5234;
    data_.satellites = 12;
    data_.fix_type = 3;
    initialized_ = true;
    return true;
}

bool GPSSensor::update() {
    if (!initialized_) return false;
    
    if (!simulated_ && hw_parser_) {
        return hw_parser_->update(data_);
    }
    
    // Simulation
    update_count_++;
    const double t = static_cast<double>(update_count_) / 10.0;
    
    data_.timestamp_us = now_us();
    data_.lat = 50.4501 + 0.0001 * std::sin(t * 0.02);
    data_.lon = 30.5234 + 0.0001 * std::cos(t * 0.015);
    data_.alt = 150.0f + 5.0f * std::sin(t * 0.05f) + noise(0.3f);
    data_.speed = 2.0f + noise(0.5f);
    int sats = 12 + static_cast<int>(noise(2.0f));
    data_.satellites = static_cast<uint8_t>(clamp_val(sats, 4, 24));
    data_.fix_type = 3;
    data_.valid = true;
    
    return data_.valid;
}

bool GPSSensor::is_healthy() const {
    return initialized_ && data_.valid && data_.fix_type >= 2;
}

// ═══════════════════════════════════════════════════════════
// Rangefinder Sensor (simulation only for now)
// ═══════════════════════════════════════════════════════════

bool RangefinderSensor::initialize() {
    data_ = {};
    initialized_ = true;
    return true;
}

bool RangefinderSensor::update() {
    if (!initialized_) return false;
    
    if (simulated_) {
        update_count_++;
        const double t = static_cast<double>(update_count_) / 50.0;
        
        data_.timestamp_us = now_us();
        data_.distance = 3.0f + 1.5f * std::sin(t * 0.1f) + noise(0.05f);
        data_.signal_quality = 0.95f + noise(0.03f);
        if (data_.distance < 0.1f) data_.distance = 0.1f;
        if (data_.signal_quality > 1.0f) data_.signal_quality = 1.0f;
        if (data_.signal_quality < 0.0f) data_.signal_quality = 0.0f;
        data_.valid = true;
    }
    
    return data_.valid;
}

bool RangefinderSensor::is_healthy() const {
    return initialized_ && data_.valid && data_.signal_quality > 0.3f;
}

// ═══════════════════════════════════════════════════════════
// Optical Flow Sensor (simulation only for now)
// ═══════════════════════════════════════════════════════════

bool OpticalFlowSensor::initialize() {
    data_ = {};
    initialized_ = true;
    return true;
}

bool OpticalFlowSensor::update() {
    if (!initialized_) return false;
    
    if (simulated_) {
        update_count_++;
        const double t = static_cast<double>(update_count_) / 50.0;
        
        data_.timestamp_us = now_us();
        data_.flow_x = 0.05f * std::sin(t * 0.3f) + noise(0.01f);
        data_.flow_y = 0.03f * std::cos(t * 0.2f) + noise(0.01f);
        int quality = 200 + static_cast<int>(noise(30.0f));
        data_.quality = static_cast<uint8_t>(clamp_val(quality, 0, 255));
        data_.ground_distance = 3.0f + noise(0.1f);
        data_.valid = true;
    }
    
    return data_.valid;
}

bool OpticalFlowSensor::is_healthy() const {
    return initialized_ && data_.valid && data_.quality > 50;
}

} // namespace jtzero
