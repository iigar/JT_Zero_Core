#pragma once
/**
 * JT-Zero Hardware Bus Abstractions
 * 
 * I2C, SPI, and UART HAL for Linux (Raspberry Pi)
 * Uses standard Linux device files (/dev/i2c-*, /dev/spidev*, /dev/ttyS*)
 * 
 * All operations are non-blocking where possible.
 * No dynamic allocation.
 */

#include <cstdint>
#include <cstddef>

namespace jtzero {

// ─── I2C Bus ─────────────────────────────────────────────
// Linux I2C interface via /dev/i2c-*

class I2CBus {
public:
    I2CBus() = default;
    ~I2CBus() { close(); }
    
    // Non-copyable
    I2CBus(const I2CBus&) = delete;
    I2CBus& operator=(const I2CBus&) = delete;
    
    bool open(const char* device = "/dev/i2c-1");
    void close();
    bool is_open() const { return fd_ >= 0; }
    
    // Low-level I2C operations
    bool write_byte(uint8_t addr, uint8_t reg, uint8_t value);
    bool read_byte(uint8_t addr, uint8_t reg, uint8_t& value);
    bool read_bytes(uint8_t addr, uint8_t reg, uint8_t* buf, size_t len);
    
    // Probe if device responds at address
    bool probe(uint8_t addr);

private:
    int fd_{-1};
    uint8_t current_addr_{0};
    
    bool set_address(uint8_t addr);
};

// ─── SPI Bus ─────────────────────────────────────────────
// Linux SPI interface via /dev/spidev*

class SPIBus {
public:
    SPIBus() = default;
    ~SPIBus() { close(); }
    
    SPIBus(const SPIBus&) = delete;
    SPIBus& operator=(const SPIBus&) = delete;
    
    bool open(const char* device = "/dev/spidev0.0",
              uint32_t speed_hz = 1000000, uint8_t mode = 0);
    void close();
    bool is_open() const { return fd_ >= 0; }
    
    // Full-duplex transfer
    bool transfer(const uint8_t* tx, uint8_t* rx, size_t len);
    
    // Read register (send reg addr, read response)
    bool read_reg(uint8_t reg, uint8_t& value);
    bool read_regs(uint8_t reg, uint8_t* buf, size_t len);

private:
    int fd_{-1};
    uint32_t speed_hz_{1000000};
    uint8_t mode_{0};
    uint8_t bits_per_word_{8};
};

// ─── UART Bus ────────────────────────────────────────────
// Linux UART interface via /dev/ttyS* or /dev/ttyAMA*

class UARTBus {
public:
    UARTBus() = default;
    ~UARTBus() { close(); }
    
    UARTBus(const UARTBus&) = delete;
    UARTBus& operator=(const UARTBus&) = delete;
    
    bool open(const char* device = "/dev/ttyS0", uint32_t baud = 9600);
    void close();
    bool is_open() const { return fd_ >= 0; }
    
    // Non-blocking read. Returns bytes read, 0 if none available, -1 on error
    int read(uint8_t* buf, size_t max_len);
    
    // Blocking write
    bool write(const uint8_t* buf, size_t len);
    
    // Flush buffers
    void flush();

private:
    int fd_{-1};
};

} // namespace jtzero
