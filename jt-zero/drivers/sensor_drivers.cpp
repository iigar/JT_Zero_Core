/**
 * JT-Zero Real Sensor Driver Implementations
 * 
 * MPU6050: I2C burst read of 14 bytes (accel + temp + gyro)
 * BMP280:  I2C read with on-chip compensation
 * NMEA:    UART non-blocking line parser
 * 
 * All drivers follow embedded best practices:
 * - No dynamic allocation
 * - Bounded execution time
 * - Error handling without exceptions
 */

#include "sensor_drivers.h"
#include <cstring>
#include <cstdio>
#include <cmath>
#include <cstdlib>

namespace jtzero {

// ═══════════════════════════════════════════════════════════
// MPU6050 IMU Driver
// ═══════════════════════════════════════════════════════════

bool MPU6050Driver::initialize(I2CBus& bus, uint8_t addr) {
    bus_ = &bus;
    addr_ = addr;
    
    // Verify WHO_AM_I
    uint8_t who;
    if (!bus_->read_byte(addr_, REG_WHO_AM_I, who)) {
        std::printf("[MPU6050] Failed to read WHO_AM_I at 0x%02X\n", addr_);
        return false;
    }
    if (who != WHO_AM_I_VALUE) {
        std::printf("[MPU6050] Unexpected WHO_AM_I: 0x%02X (expected 0x%02X)\n", who, WHO_AM_I_VALUE);
        return false;
    }
    
    // Wake up (clear SLEEP bit in PWR_MGMT_1)
    if (!bus_->write_byte(addr_, REG_PWR_MGMT_1, 0x00)) return false;
    
    // Set clock source to PLL with X-axis gyro reference
    if (!bus_->write_byte(addr_, REG_PWR_MGMT_1, 0x01)) return false;
    
    // Set sample rate divider (1kHz / (1 + 4) = 200 Hz)
    if (!bus_->write_byte(addr_, REG_SMPLRT_DIV, 4)) return false;
    
    // Set DLPF to ~98 Hz bandwidth
    set_dlpf(2);
    
    // Default ranges: gyro 500 deg/s, accel 4g
    set_gyro_range(1);
    set_accel_range(1);
    
    initialized_ = true;
    std::printf("[MPU6050] Initialized at 0x%02X (200Hz, 500dps, 4g)\n", addr_);
    return true;
}

void MPU6050Driver::set_gyro_range(uint8_t range) {
    if (!bus_ || range > 3) return;
    bus_->write_byte(addr_, REG_GYRO_CONFIG, range << 3);
    gyro_scale_ = GYRO_SCALES[range];
}

void MPU6050Driver::set_accel_range(uint8_t range) {
    if (!bus_ || range > 3) return;
    bus_->write_byte(addr_, REG_ACCEL_CONFIG, range << 3);
    accel_scale_ = ACCEL_SCALES[range];
}

void MPU6050Driver::set_dlpf(uint8_t dlpf) {
    if (!bus_ || dlpf > 6) return;
    bus_->write_byte(addr_, REG_CONFIG, dlpf);
}

bool MPU6050Driver::read(IMUData& out) {
    if (!initialized_ || !bus_) return false;
    
    // Burst read 14 bytes: ACCEL(6) + TEMP(2) + GYRO(6)
    uint8_t raw[14];
    if (!bus_->read_bytes(addr_, REG_ACCEL_XOUT_H, raw, 14)) {
        return false;
    }
    
    // Parse accelerometer (big-endian)
    int16_t ax_raw = raw_to_int16(raw[0], raw[1]);
    int16_t ay_raw = raw_to_int16(raw[2], raw[3]);
    int16_t az_raw = raw_to_int16(raw[4], raw[5]);
    
    // Parse gyroscope
    int16_t gx_raw = raw_to_int16(raw[8], raw[9]);
    int16_t gy_raw = raw_to_int16(raw[10], raw[11]);
    int16_t gz_raw = raw_to_int16(raw[12], raw[13]);
    
    // Convert to physical units
    out.timestamp_us = now_us();
    out.acc_x = (static_cast<float>(ax_raw) / accel_scale_) * G_MPS2;
    out.acc_y = (static_cast<float>(ay_raw) / accel_scale_) * G_MPS2;
    out.acc_z = (static_cast<float>(az_raw) / accel_scale_) * G_MPS2;
    out.gyro_x = (static_cast<float>(gx_raw) / gyro_scale_) * DEG_TO_RAD;
    out.gyro_y = (static_cast<float>(gy_raw) / gyro_scale_) * DEG_TO_RAD;
    out.gyro_z = (static_cast<float>(gz_raw) / gyro_scale_) * DEG_TO_RAD;
    out.valid = true;
    
    return true;
}

bool MPU6050Driver::self_test() {
    if (!initialized_) return false;
    
    IMUData test;
    if (!read(test)) return false;
    
    // Basic sanity: acc_z should be near -9.81 when stationary
    return (test.acc_z < -5.0f && test.acc_z > -15.0f);
}

// ═══════════════════════════════════════════════════════════
// BMP280 Barometer Driver
// ═══════════════════════════════════════════════════════════

bool BMP280Driver::initialize(I2CBus& bus, uint8_t addr) {
    bus_ = &bus;
    addr_ = addr;
    
    // Verify chip ID
    uint8_t chip_id;
    if (!bus_->read_byte(addr_, REG_CHIP_ID, chip_id)) {
        std::printf("[BMP280] Failed to read chip ID at 0x%02X\n", addr_);
        return false;
    }
    if (chip_id != CHIP_ID_VALUE) {
        std::printf("[BMP280] Unexpected chip ID: 0x%02X (expected 0x%02X)\n", chip_id, CHIP_ID_VALUE);
        return false;
    }
    
    // Soft reset
    bus_->write_byte(addr_, REG_RESET, 0xB6);
    // Wait for reset (datasheet: 2ms startup time)
    // In embedded: busy-wait or use timer
    
    // Read compensation parameters
    if (!read_calibration()) {
        std::printf("[BMP280] Failed to read calibration data\n");
        return false;
    }
    
    // Configure: oversampling x4 temp, x8 pressure, normal mode
    // osrs_t=010 (x2), osrs_p=011 (x4), mode=11 (normal)
    if (!bus_->write_byte(addr_, REG_CTRL_MEAS, 0x4F)) return false;
    
    // Config: standby 62.5ms, filter coeff 4
    if (!bus_->write_byte(addr_, REG_CONFIG, 0x28)) return false;
    
    initialized_ = true;
    std::printf("[BMP280] Initialized at 0x%02X (normal mode, filter=4)\n", addr_);
    return true;
}

bool BMP280Driver::read_calibration() {
    uint8_t calib[26];
    if (!bus_->read_bytes(addr_, REG_CALIB_00, calib, 26)) return false;
    
    dig_T1_ = static_cast<uint16_t>(calib[0]) | (static_cast<uint16_t>(calib[1]) << 8);
    dig_T2_ = static_cast<int16_t>(calib[2] | (calib[3] << 8));
    dig_T3_ = static_cast<int16_t>(calib[4] | (calib[5] << 8));
    
    dig_P1_ = static_cast<uint16_t>(calib[6]) | (static_cast<uint16_t>(calib[7]) << 8);
    dig_P2_ = static_cast<int16_t>(calib[8]  | (calib[9]  << 8));
    dig_P3_ = static_cast<int16_t>(calib[10] | (calib[11] << 8));
    dig_P4_ = static_cast<int16_t>(calib[12] | (calib[13] << 8));
    dig_P5_ = static_cast<int16_t>(calib[14] | (calib[15] << 8));
    dig_P6_ = static_cast<int16_t>(calib[16] | (calib[17] << 8));
    dig_P7_ = static_cast<int16_t>(calib[18] | (calib[19] << 8));
    dig_P8_ = static_cast<int16_t>(calib[20] | (calib[21] << 8));
    dig_P9_ = static_cast<int16_t>(calib[22] | (calib[23] << 8));
    
    calibration_loaded_ = true;
    return true;
}

int32_t BMP280Driver::compensate_temperature(int32_t adc_T) {
    // BMP280 datasheet compensation formula
    int32_t var1 = ((((adc_T >> 3) - (static_cast<int32_t>(dig_T1_) << 1))) *
                    static_cast<int32_t>(dig_T2_)) >> 11;
    int32_t var2 = (((((adc_T >> 4) - static_cast<int32_t>(dig_T1_)) *
                    ((adc_T >> 4) - static_cast<int32_t>(dig_T1_))) >> 12) *
                    static_cast<int32_t>(dig_T3_)) >> 14;
    t_fine_ = var1 + var2;
    return (t_fine_ * 5 + 128) >> 8; // Temperature in 0.01 C
}

uint32_t BMP280Driver::compensate_pressure(int32_t adc_P) {
    // BMP280 datasheet compensation formula
    int64_t var1 = static_cast<int64_t>(t_fine_) - 128000;
    int64_t var2 = var1 * var1 * static_cast<int64_t>(dig_P6_);
    var2 = var2 + ((var1 * static_cast<int64_t>(dig_P5_)) << 17);
    var2 = var2 + (static_cast<int64_t>(dig_P4_) << 35);
    var1 = ((var1 * var1 * static_cast<int64_t>(dig_P3_)) >> 8) +
           ((var1 * static_cast<int64_t>(dig_P2_)) << 12);
    var1 = ((static_cast<int64_t>(1) << 47) + var1) * static_cast<int64_t>(dig_P1_) >> 33;
    
    if (var1 == 0) return 0; // Avoid division by zero
    
    int64_t p = 1048576 - adc_P;
    p = (((p << 31) - var2) * 3125) / var1;
    var1 = (static_cast<int64_t>(dig_P9_) * (p >> 13) * (p >> 13)) >> 25;
    var2 = (static_cast<int64_t>(dig_P8_) * p) >> 19;
    p = ((p + var1 + var2) >> 8) + (static_cast<int64_t>(dig_P7_) << 4);
    
    return static_cast<uint32_t>(p); // Pressure in Pa * 256
}

bool BMP280Driver::read(BarometerData& out) {
    if (!initialized_ || !calibration_loaded_) return false;
    
    // Read 6 bytes: pressure(3) + temperature(3)
    uint8_t raw[6];
    if (!bus_->read_bytes(addr_, REG_PRESS_MSB, raw, 6)) return false;
    
    // Parse 20-bit ADC values
    int32_t adc_P = (static_cast<int32_t>(raw[0]) << 12) |
                    (static_cast<int32_t>(raw[1]) << 4) |
                    (static_cast<int32_t>(raw[2]) >> 4);
    int32_t adc_T = (static_cast<int32_t>(raw[3]) << 12) |
                    (static_cast<int32_t>(raw[4]) << 4) |
                    (static_cast<int32_t>(raw[5]) >> 4);
    
    // Compensate (must do temperature first, sets t_fine_)
    int32_t temp_raw = compensate_temperature(adc_T);
    uint32_t press_raw = compensate_pressure(adc_P);
    
    out.timestamp_us = now_us();
    out.temperature = static_cast<float>(temp_raw) / 100.0f;  // C
    out.pressure = static_cast<float>(press_raw) / 25600.0f;   // hPa
    
    // Barometric altitude formula: h = 44330 * (1 - (P/P0)^(1/5.255))
    out.altitude = 44330.0f * (1.0f - std::pow(out.pressure / sea_level_pressure_, 0.190295f));
    out.valid = true;
    
    return true;
}

// ═══════════════════════════════════════════════════════════
// NMEA GPS Parser
// ═══════════════════════════════════════════════════════════

bool NMEAParser::initialize(UARTBus& uart) {
    uart_ = &uart;
    buf_pos_ = 0;
    std::memset(line_buf_, 0, sizeof(line_buf_));
    initialized_ = true;
    return true;
}

bool NMEAParser::read_line(char* out, size_t max) {
    if (!uart_ || !uart_->is_open()) return false;
    
    uint8_t buf[64];
    int n = uart_->read(buf, sizeof(buf));
    
    for (int i = 0; i < n; ++i) {
        char c = static_cast<char>(buf[i]);
        
        if (c == '$') {
            // Start of new sentence
            buf_pos_ = 0;
            line_buf_[buf_pos_++] = c;
        } else if (c == '\n' || c == '\r') {
            if (buf_pos_ > 5) {
                // Complete sentence
                line_buf_[buf_pos_] = '\0';
                std::strncpy(out, line_buf_, max - 1);
                out[max - 1] = '\0';
                buf_pos_ = 0;
                return true;
            }
            buf_pos_ = 0;
        } else if (buf_pos_ < sizeof(line_buf_) - 1) {
            line_buf_[buf_pos_++] = c;
        }
    }
    
    return false;
}

bool NMEAParser::verify_checksum(const char* sentence) {
    if (sentence[0] != '$') return false;
    
    const char* star = std::strchr(sentence, '*');
    if (!star) return false;
    
    uint8_t calc = 0;
    for (const char* p = sentence + 1; p < star; ++p) {
        calc ^= static_cast<uint8_t>(*p);
    }
    
    // Parse hex checksum after *
    unsigned int expected = 0;
    if (sscanf(star + 1, "%02X", &expected) != 1) return false;
    
    return calc == static_cast<uint8_t>(expected);
}

double NMEAParser::parse_coord(const char* str, char hemisphere) {
    if (!str || str[0] == '\0') return 0;
    
    // NMEA format: ddmm.mmmm (latitude) or dddmm.mmmm (longitude)
    double raw = atof(str);
    int degrees = static_cast<int>(raw / 100);
    double minutes = raw - degrees * 100;
    double decimal = degrees + minutes / 60.0;
    
    if (hemisphere == 'S' || hemisphere == 'W') {
        decimal = -decimal;
    }
    
    return decimal;
}

int NMEAParser::split_fields(char* sentence, char** fields, int max_fields) {
    int count = 0;
    char* p = sentence;
    
    while (*p && count < max_fields) {
        fields[count++] = p;
        p = std::strchr(p, ',');
        if (!p) break;
        *p++ = '\0'; // Replace comma with null
    }
    
    return count;
}

bool NMEAParser::parse_gga(const char* sentence, GPSData& out) {
    // $GPGGA,hhmmss.ss,ddmm.mmm,N,dddmm.mmm,E,fix,sats,hdop,alt,M,...*XX
    char buf[256];
    std::strncpy(buf, sentence, sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = '\0';
    
    char* fields[20];
    int n = split_fields(buf, fields, 20);
    if (n < 10) return false;
    
    // Field indices (0-based after split): 
    // 0=header, 1=time, 2=lat, 3=N/S, 4=lon, 5=E/W, 6=fix, 7=sats, 8=hdop, 9=alt
    
    out.lat = parse_coord(fields[2], fields[3][0]);
    out.lon = parse_coord(fields[4], fields[5][0]);
    out.fix_type = static_cast<uint8_t>(atoi(fields[6]));
    out.satellites = static_cast<uint8_t>(atoi(fields[7]));
    out.alt = static_cast<float>(atof(fields[9]));
    out.valid = (out.fix_type >= 1);
    out.timestamp_us = now_us();
    
    return true;
}

bool NMEAParser::parse_rmc(const char* sentence, GPSData& out) {
    // $GPRMC,hhmmss.ss,A,ddmm.mmm,N,dddmm.mmm,E,speed,course,...*XX
    char buf[256];
    std::strncpy(buf, sentence, sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = '\0';
    
    char* fields[20];
    int n = split_fields(buf, fields, 20);
    if (n < 8) return false;
    
    // fields: 0=header, 1=time, 2=status, 3=lat, 4=N/S, 5=lon, 6=E/W, 7=speed_knots
    
    if (fields[2][0] != 'A') return false; // A=active, V=void
    
    out.lat = parse_coord(fields[3], fields[4][0]);
    out.lon = parse_coord(fields[5], fields[6][0]);
    out.speed = static_cast<float>(atof(fields[7])) * 0.514444f; // knots to m/s
    out.valid = true;
    out.timestamp_us = now_us();
    
    return true;
}

bool NMEAParser::update(GPSData& out) {
    if (!initialized_) return false;
    
    char line[256];
    bool updated = false;
    
    // Process all available lines (may have multiple sentences buffered)
    while (read_line(line, sizeof(line))) {
        if (!verify_checksum(line)) continue;
        
        if (std::strncmp(line, "$GPGGA", 6) == 0 ||
            std::strncmp(line, "$GNGGA", 6) == 0) {
            if (parse_gga(line, last_fix_)) {
                updated = true;
            }
        } else if (std::strncmp(line, "$GPRMC", 6) == 0 ||
                   std::strncmp(line, "$GNRMC", 6) == 0) {
            if (parse_rmc(line, last_fix_)) {
                updated = true;
            }
        }
    }
    
    if (updated) {
        out = last_fix_;
    }
    
    return updated;
}

} // namespace jtzero
