#pragma once
/**
 * JT-Zero Sensor Drivers for Real Hardware
 * 
 * MPU6050 IMU (I2C)
 * BMP280 Barometer (I2C)
 * NMEA GPS Parser (UART)
 * 
 * Each driver reads real sensor data from Raspberry Pi peripherals.
 * Falls back to simulation if hardware not detected.
 */

#include "bus.h"
#include "jt_zero/common.h"

namespace jtzero {

// ─── MPU6050 IMU Driver (I2C 0x68/0x69) ─────────────────
// InvenSense MPU-6050 6-axis IMU
// Gyroscope: up to 2000 deg/s
// Accelerometer: up to 16g

class MPU6050Driver {
public:
    static constexpr uint8_t DEFAULT_ADDR = 0x68;
    static constexpr uint8_t ALT_ADDR = 0x69;
    
    bool initialize(I2CBus& bus, uint8_t addr = DEFAULT_ADDR);
    bool read(IMUData& out);
    bool self_test();
    
    // Configuration
    void set_gyro_range(uint8_t range);   // 0=250, 1=500, 2=1000, 3=2000 deg/s
    void set_accel_range(uint8_t range);  // 0=2g, 1=4g, 2=8g, 3=16g
    void set_dlpf(uint8_t dlpf);          // 0-6, digital low-pass filter
    
    bool is_initialized() const { return initialized_; }

private:
    I2CBus* bus_{nullptr};
    uint8_t addr_{DEFAULT_ADDR};
    bool initialized_{false};
    
    float gyro_scale_{0};    // rad/s per LSB
    float accel_scale_{0};   // m/s^2 per LSB
    
    // MPU6050 register addresses
    static constexpr uint8_t REG_WHO_AM_I      = 0x75;
    static constexpr uint8_t REG_PWR_MGMT_1    = 0x6B;
    static constexpr uint8_t REG_PWR_MGMT_2    = 0x6C;
    static constexpr uint8_t REG_SMPLRT_DIV    = 0x19;
    static constexpr uint8_t REG_CONFIG        = 0x1A;
    static constexpr uint8_t REG_GYRO_CONFIG   = 0x1B;
    static constexpr uint8_t REG_ACCEL_CONFIG  = 0x1C;
    static constexpr uint8_t REG_ACCEL_XOUT_H  = 0x3B;
    static constexpr uint8_t REG_TEMP_OUT_H    = 0x41;
    
    static constexpr uint8_t WHO_AM_I_VALUE    = 0x68;
    
    // Scale factors (from datasheet)
    static constexpr float GYRO_SCALES[4] = {
        131.0f,   // 250 deg/s  -> 131 LSB/(deg/s)
        65.5f,    // 500 deg/s
        32.8f,    // 1000 deg/s
        16.4f     // 2000 deg/s
    };
    
    static constexpr float ACCEL_SCALES[4] = {
        16384.0f, // 2g  -> 16384 LSB/g
        8192.0f,  // 4g
        4096.0f,  // 8g
        2048.0f   // 16g
    };
    
    // DEG_TO_RAD conversion
    static constexpr float DEG_TO_RAD = 0.0174533f;
    static constexpr float G_MPS2 = 9.80665f;
    
    int16_t raw_to_int16(uint8_t hi, uint8_t lo) {
        return static_cast<int16_t>((static_cast<uint16_t>(hi) << 8) | lo);
    }
};

// ─── BMP280 Barometer Driver (I2C 0x76/0x77) ────────────
// Bosch BMP280 Digital Pressure Sensor
// Pressure: 300-1100 hPa
// Altitude: derived via barometric formula

class BMP280Driver {
public:
    static constexpr uint8_t DEFAULT_ADDR = 0x76;
    static constexpr uint8_t ALT_ADDR = 0x77;
    
    bool initialize(I2CBus& bus, uint8_t addr = DEFAULT_ADDR);
    bool read(BarometerData& out);
    
    bool is_initialized() const { return initialized_; }

private:
    I2CBus* bus_{nullptr};
    uint8_t addr_{DEFAULT_ADDR};
    bool initialized_{false};
    bool calibration_loaded_{false};
    
    // BMP280 compensation parameters (loaded from chip NVM)
    uint16_t dig_T1_{0}; int16_t dig_T2_{0}, dig_T3_{0};
    uint16_t dig_P1_{0}; int16_t dig_P2_{0}, dig_P3_{0}, dig_P4_{0},
                                  dig_P5_{0}, dig_P6_{0}, dig_P7_{0},
                                  dig_P8_{0}, dig_P9_{0};
    int32_t t_fine_{0};  // Fine temperature (used in pressure comp)
    
    bool read_calibration();
    int32_t compensate_temperature(int32_t adc_T);
    uint32_t compensate_pressure(int32_t adc_P);
    
    // Sea-level reference pressure (adjustable)
    float sea_level_pressure_{1013.25f}; // hPa
    
    // BMP280 register addresses
    static constexpr uint8_t REG_CHIP_ID   = 0xD0;
    static constexpr uint8_t REG_RESET     = 0xE0;
    static constexpr uint8_t REG_STATUS    = 0xF3;
    static constexpr uint8_t REG_CTRL_MEAS = 0xF4;
    static constexpr uint8_t REG_CONFIG    = 0xF5;
    static constexpr uint8_t REG_PRESS_MSB = 0xF7;
    static constexpr uint8_t REG_CALIB_00  = 0x88;
    
    static constexpr uint8_t CHIP_ID_VALUE = 0x58;
};

// ─── NMEA GPS Parser (UART) ──────────────────────────────
// Parses standard NMEA-0183 sentences from serial GPS modules
// Supports: $GPGGA (fix data), $GPRMC (position/speed/course)

class NMEAParser {
public:
    bool initialize(UARTBus& uart);
    
    // Call at 10 Hz. Reads UART buffer, parses any complete sentences.
    // Returns true if GPS data was updated.
    bool update(GPSData& out);
    
    // Parse individual sentences (for testing)
    bool parse_gga(const char* sentence, GPSData& out);
    bool parse_rmc(const char* sentence, GPSData& out);
    
    bool is_initialized() const { return initialized_; }

private:
    UARTBus* uart_{nullptr};
    bool initialized_{false};
    
    // Line buffer for assembling NMEA sentences
    char line_buf_[256]{};
    size_t buf_pos_{0};
    
    // Internal state
    GPSData last_fix_{};
    
    // Read one complete NMEA line from UART buffer
    bool read_line(char* out, size_t max);
    
    // Parse latitude/longitude from NMEA format (ddmm.mmmm)
    static double parse_coord(const char* str, char hemisphere);
    
    // Verify NMEA checksum (*XX at end of sentence)
    static bool verify_checksum(const char* sentence);
    
    // Split NMEA fields by comma
    static int split_fields(char* sentence, char** fields, int max_fields);
};

} // namespace jtzero
