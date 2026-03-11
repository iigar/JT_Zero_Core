/**
 * JT-Zero Hardware Bus Implementations
 * 
 * Linux I2C/SPI/UART using standard ioctl interface.
 * Compiles on any Linux system (Pi, desktop, cross-compile).
 */

#include "bus.h"

#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <cstring>
#include <cstdio>

// Linux I2C
#include <linux/i2c-dev.h>

// Linux SPI
#include <linux/spi/spidev.h>

// UART
#include <termios.h>

namespace jtzero {

// ═══════════════════════════════════════════════════════════
// I2C Bus
// ═══════════════════════════════════════════════════════════

bool I2CBus::open(const char* device) {
    fd_ = ::open(device, O_RDWR);
    if (fd_ < 0) {
        std::printf("[I2C] Failed to open %s\n", device);
        return false;
    }
    return true;
}

void I2CBus::close() {
    if (fd_ >= 0) {
        ::close(fd_);
        fd_ = -1;
    }
}

bool I2CBus::set_address(uint8_t addr) {
    if (addr == current_addr_) return true;
    if (ioctl(fd_, I2C_SLAVE, addr) < 0) {
        return false;
    }
    current_addr_ = addr;
    return true;
}

bool I2CBus::probe(uint8_t addr) {
    if (!is_open()) return false;
    if (!set_address(addr)) return false;
    
    // Try to read one byte; success means device is present
    uint8_t dummy;
    return (::read(fd_, &dummy, 1) == 1);
}

bool I2CBus::write_byte(uint8_t addr, uint8_t reg, uint8_t value) {
    if (!set_address(addr)) return false;
    
    uint8_t buf[2] = {reg, value};
    return (::write(fd_, buf, 2) == 2);
}

bool I2CBus::read_byte(uint8_t addr, uint8_t reg, uint8_t& value) {
    if (!set_address(addr)) return false;
    
    if (::write(fd_, &reg, 1) != 1) return false;
    return (::read(fd_, &value, 1) == 1);
}

bool I2CBus::read_bytes(uint8_t addr, uint8_t reg, uint8_t* buf, size_t len) {
    if (!set_address(addr)) return false;
    
    if (::write(fd_, &reg, 1) != 1) return false;
    return (::read(fd_, buf, len) == static_cast<ssize_t>(len));
}

// ═══════════════════════════════════════════════════════════
// SPI Bus
// ═══════════════════════════════════════════════════════════

bool SPIBus::open(const char* device, uint32_t speed_hz, uint8_t mode) {
    fd_ = ::open(device, O_RDWR);
    if (fd_ < 0) {
        std::printf("[SPI] Failed to open %s\n", device);
        return false;
    }
    
    speed_hz_ = speed_hz;
    mode_ = mode;
    
    // Configure SPI mode
    if (ioctl(fd_, SPI_IOC_WR_MODE, &mode_) < 0) return false;
    if (ioctl(fd_, SPI_IOC_WR_BITS_PER_WORD, &bits_per_word_) < 0) return false;
    if (ioctl(fd_, SPI_IOC_WR_MAX_SPEED_HZ, &speed_hz_) < 0) return false;
    
    return true;
}

void SPIBus::close() {
    if (fd_ >= 0) {
        ::close(fd_);
        fd_ = -1;
    }
}

bool SPIBus::transfer(const uint8_t* tx, uint8_t* rx, size_t len) {
    struct spi_ioc_transfer tr{};
    tr.tx_buf = reinterpret_cast<unsigned long>(tx);
    tr.rx_buf = reinterpret_cast<unsigned long>(rx);
    tr.len = static_cast<unsigned int>(len);
    tr.speed_hz = speed_hz_;
    tr.bits_per_word = bits_per_word_;
    
    return (ioctl(fd_, SPI_IOC_MESSAGE(1), &tr) >= 0);
}

bool SPIBus::read_reg(uint8_t reg, uint8_t& value) {
    uint8_t tx[2] = {static_cast<uint8_t>(reg | 0x80), 0x00}; // Read flag
    uint8_t rx[2] = {0, 0};
    if (!transfer(tx, rx, 2)) return false;
    value = rx[1];
    return true;
}

bool SPIBus::read_regs(uint8_t reg, uint8_t* buf, size_t len) {
    // Fixed-size buffer to avoid VLA (max 32 registers at once)
    constexpr size_t MAX_REGS = 32;
    if (len > MAX_REGS) len = MAX_REGS;
    
    uint8_t tx[MAX_REGS + 1];
    uint8_t rx[MAX_REGS + 1];
    std::memset(tx, 0, len + 1);
    tx[0] = reg | 0x80; // Read flag
    
    if (!transfer(tx, rx, len + 1)) return false;
    std::memcpy(buf, rx + 1, len);
    return true;
}

// ═══════════════════════════════════════════════════════════
// UART Bus
// ═══════════════════════════════════════════════════════════

bool UARTBus::open(const char* device, uint32_t baud) {
    fd_ = ::open(device, O_RDWR | O_NOCTTY | O_NONBLOCK);
    if (fd_ < 0) {
        std::printf("[UART] Failed to open %s\n", device);
        return false;
    }
    
    struct termios tty{};
    if (tcgetattr(fd_, &tty) != 0) {
        close();
        return false;
    }
    
    // Map baud rate
    speed_t baud_flag;
    switch (baud) {
        case 4800:   baud_flag = B4800;   break;
        case 9600:   baud_flag = B9600;   break;
        case 19200:  baud_flag = B19200;  break;
        case 38400:  baud_flag = B38400;  break;
        case 57600:  baud_flag = B57600;  break;
        case 115200: baud_flag = B115200; break;
        default:     baud_flag = B9600;   break;
    }
    
    cfsetispeed(&tty, baud_flag);
    cfsetospeed(&tty, baud_flag);
    
    // 8N1 configuration
    tty.c_cflag &= ~PARENB;   // No parity
    tty.c_cflag &= ~CSTOPB;   // 1 stop bit
    tty.c_cflag &= ~CSIZE;
    tty.c_cflag |= CS8;        // 8 data bits
    tty.c_cflag |= CREAD | CLOCAL; // Enable read, ignore modem control
    
    // Raw mode (no line processing)
    tty.c_lflag &= ~(ICANON | ECHO | ECHOE | ISIG);
    tty.c_iflag &= ~(IXON | IXOFF | IXANY);
    tty.c_oflag &= ~OPOST;
    
    // Non-blocking: return immediately with available data
    tty.c_cc[VMIN] = 0;
    tty.c_cc[VTIME] = 0;
    
    if (tcsetattr(fd_, TCSANOW, &tty) != 0) {
        close();
        return false;
    }
    
    tcflush(fd_, TCIOFLUSH);
    return true;
}

void UARTBus::close() {
    if (fd_ >= 0) {
        ::close(fd_);
        fd_ = -1;
    }
}

int UARTBus::read(uint8_t* buf, size_t max_len) {
    if (!is_open()) return -1;
    ssize_t n = ::read(fd_, buf, max_len);
    return (n < 0) ? 0 : static_cast<int>(n); // EAGAIN returns 0 (non-blocking)
}

bool UARTBus::write(const uint8_t* buf, size_t len) {
    if (!is_open()) return false;
    return (::write(fd_, buf, len) == static_cast<ssize_t>(len));
}

void UARTBus::flush() {
    if (is_open()) {
        tcflush(fd_, TCIOFLUSH);
    }
}

} // namespace jtzero
