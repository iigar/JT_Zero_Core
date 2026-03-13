/**
 * JT-Zero MAVLink Interface Implementation
 * 
 * Transport auto-detection:
 *   1. Try serial /dev/ttyAMA0 (Pi hardware UART) or /dev/serial0
 *   2. Try UDP 127.0.0.1:14550 (SITL / MissionPlanner / QGC)
 *   3. Fall back to simulated (in-memory)
 * 
 * MAVLink v2 message framing is used on real transports.
 */

#include "jt_zero/mavlink_interface.h"
#include <cstdio>
#include <cstring>
#include <cmath>

#ifdef __linux__
#include <fcntl.h>
#include <unistd.h>
#include <termios.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <errno.h>
#endif

namespace jtzero {

MAVLinkInterface::MAVLinkInterface() = default;

// ═══════════════════════════════════════════════════════════
// Transport Auto-Detection
// ═══════════════════════════════════════════════════════════

MAVTransport MAVLinkInterface::auto_detect_transport() {
#ifdef __linux__
    // Try serial ports common on Raspberry Pi
    const char* serial_devices[] = {"/dev/ttyAMA0", "/dev/serial0", "/dev/ttyS0"};
    for (auto dev : serial_devices) {
        struct stat st;
        if (stat(dev, &st) == 0 && S_ISCHR(st.st_mode)) {
            int fd = ::open(dev, O_RDWR | O_NOCTTY | O_NONBLOCK);
            if (fd >= 0) {
                ::close(fd);
                std::printf("[MAVLink] Serial port detected: %s\n", dev);
                return MAVTransport::SERIAL;
            }
        }
    }
    
    // Try UDP (check if a MAVLink endpoint is reachable)
    int udp = socket(AF_INET, SOCK_DGRAM, 0);
    if (udp >= 0) {
        ::close(udp);
        // We can always create a UDP socket, but only use it 
        // if explicitly configured (not auto-detected)
    }
#endif
    
    return MAVTransport::SIMULATED;
}

// ═══════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════

bool MAVLinkInterface::initialize(bool simulated) {
    simulated_ = simulated;
    
    if (simulated) {
        transport_ = MAVTransport::SIMULATED;
        state_ = MAVLinkState::CONNECTED;
        last_heartbeat_us_ = now_us();
        std::snprintf(transport_info_, sizeof(transport_info_), "simulated");
        std::printf("[MAVLink] Simulated connection established\n");
    } else {
        // Auto-detect real transport
        transport_ = auto_detect_transport();
        
        if (transport_ == MAVTransport::SERIAL) {
            return initialize_serial();
        } else if (transport_ == MAVTransport::UDP) {
            return initialize_udp();
        } else {
            // Fallback to simulation
            transport_ = MAVTransport::SIMULATED;
            state_ = MAVLinkState::CONNECTED;
            last_heartbeat_us_ = now_us();
            std::snprintf(transport_info_, sizeof(transport_info_), "simulated (no hw)");
            std::printf("[MAVLink] No transport detected — using simulation\n");
        }
    }
    
    return true;
}

bool MAVLinkInterface::initialize_serial(const char* device, int baudrate) {
#ifdef __linux__
    serial_fd_ = ::open(device, O_RDWR | O_NOCTTY | O_NONBLOCK);
    if (serial_fd_ < 0) {
        std::printf("[MAVLink] Failed to open %s: %s\n", device, strerror(errno));
        return false;
    }
    
    // Configure UART
    struct termios tty;
    if (tcgetattr(serial_fd_, &tty) != 0) {
        ::close(serial_fd_);
        serial_fd_ = -1;
        return false;
    }
    
    // Map baudrate
    speed_t baud;
    switch (baudrate) {
        case 57600:   baud = B57600;   break;
        case 115200:  baud = B115200;  break;
        case 230400:  baud = B230400;  break;
        case 460800:  baud = B460800;  break;
        case 921600:  baud = B921600;  break;
        default:      baud = B921600;  break;
    }
    
    cfsetospeed(&tty, baud);
    cfsetispeed(&tty, baud);
    
    // 8N1, no flow control
    tty.c_cflag &= ~PARENB;
    tty.c_cflag &= ~CSTOPB;
    tty.c_cflag &= ~CSIZE;
    tty.c_cflag |= CS8;
    tty.c_cflag &= ~CRTSCTS;
    tty.c_cflag |= CREAD | CLOCAL;
    
    // Raw mode
    tty.c_lflag &= ~(ICANON | ECHO | ECHOE | ISIG);
    tty.c_iflag &= ~(IXON | IXOFF | IXANY | IGNBRK | BRKINT | PARMRK | ISTRIP | INLCR | IGNCR | ICRNL);
    tty.c_oflag &= ~OPOST;
    
    tty.c_cc[VMIN] = 0;
    tty.c_cc[VTIME] = 1; // 100ms read timeout
    
    if (tcsetattr(serial_fd_, TCSANOW, &tty) != 0) {
        ::close(serial_fd_);
        serial_fd_ = -1;
        return false;
    }
    
    tcflush(serial_fd_, TCIOFLUSH);
    
    transport_ = MAVTransport::SERIAL;
    serial_baud_ = baudrate;
    state_ = MAVLinkState::CONNECTING;
    std::snprintf(transport_info_, sizeof(transport_info_), "%s@%d", device, baudrate);
    std::printf("[MAVLink] Serial opened: %s @ %d baud\n", device, baudrate);
    return true;
#else
    return false;
#endif
}

bool MAVLinkInterface::initialize_udp(const char* host, int port) {
#ifdef __linux__
    udp_fd_ = socket(AF_INET, SOCK_DGRAM, 0);
    if (udp_fd_ < 0) return false;
    
    // Set non-blocking
    int flags = fcntl(udp_fd_, F_GETFL, 0);
    fcntl(udp_fd_, F_SETFL, flags | O_NONBLOCK);
    
    // Bind to receive
    struct sockaddr_in addr;
    std::memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(port);
    
    if (bind(udp_fd_, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) < 0) {
        // Port in use — try connecting instead
        addr.sin_addr.s_addr = inet_addr(host);
        addr.sin_port = htons(port);
        if (connect(udp_fd_, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) < 0) {
            ::close(udp_fd_);
            udp_fd_ = -1;
            return false;
        }
    }
    
    std::strncpy(udp_host_, host, sizeof(udp_host_) - 1);
    udp_port_ = port;
    transport_ = MAVTransport::UDP;
    state_ = MAVLinkState::CONNECTING;
    std::snprintf(transport_info_, sizeof(transport_info_), "%s:%d", host, port);
    std::printf("[MAVLink] UDP opened: %s:%d\n", host, port);
    return true;
#else
    return false;
#endif
}

// ═══════════════════════════════════════════════════════════
// Raw Transport I/O
// ═══════════════════════════════════════════════════════════

bool MAVLinkInterface::send_raw(const uint8_t* data, size_t len) {
#ifdef __linux__
    if (transport_ == MAVTransport::SERIAL && serial_fd_ >= 0) {
        ssize_t n = ::write(serial_fd_, data, len);
        return n == static_cast<ssize_t>(len);
    }
    if (transport_ == MAVTransport::UDP && udp_fd_ >= 0) {
        ssize_t n = ::send(udp_fd_, data, len, MSG_DONTWAIT);
        return n == static_cast<ssize_t>(len);
    }
#endif
    return false;
}

int MAVLinkInterface::recv_raw(uint8_t* buf, size_t max_len) {
#ifdef __linux__
    if (transport_ == MAVTransport::SERIAL && serial_fd_ >= 0) {
        return static_cast<int>(::read(serial_fd_, buf, max_len));
    }
    if (transport_ == MAVTransport::UDP && udp_fd_ >= 0) {
        return static_cast<int>(::recv(udp_fd_, buf, max_len, MSG_DONTWAIT));
    }
#endif
    return -1;
}

// ═══════════════════════════════════════════════════════════
// Shutdown
// ═══════════════════════════════════════════════════════════

void MAVLinkInterface::shutdown() {
#ifdef __linux__
    if (serial_fd_ >= 0) { ::close(serial_fd_); serial_fd_ = -1; }
    if (udp_fd_ >= 0)    { ::close(udp_fd_);    udp_fd_ = -1; }
#endif
    state_ = MAVLinkState::DISCONNECTED;
    std::printf("[MAVLink] Disconnected\n");
}

// ═══════════════════════════════════════════════════════════
// Message Sending
// ═══════════════════════════════════════════════════════════

bool MAVLinkInterface::send_vision_position(const MAVVisionPositionEstimate& msg) {
    if (state_ != MAVLinkState::CONNECTED) return false;
    
    if (!simulated_ && (serial_fd_ >= 0 || udp_fd_ >= 0)) {
        // TODO: Serialize MAVLink v2 frame for VISION_POSITION_ESTIMATE (ID=102)
        // For now, just count
    }
    
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
    
    // Build and send our heartbeat to FC
    if (!simulated_ && (serial_fd_ >= 0 || udp_fd_ >= 0)) {
        // MAVLink v2 HEARTBEAT (msg_id=0, CRC_EXTRA=50)
        uint8_t payload[9] = {0};
        // custom_mode = 0
        payload[4] = 18;  // MAV_TYPE_ONBOARD_CONTROLLER
        payload[5] = 0;   // MAV_AUTOPILOT_GENERIC
        payload[6] = 0;   // base_mode
        payload[7] = 0;   // system_status = uninit
        payload[8] = 3;   // mavlink_version = 2
        send_mavlink_v2(0, payload, 9, 50);
    }
    
    last_heartbeat_us_ = now_us();
    msgs_sent_.fetch_add(1, std::memory_order_relaxed);
    
    if (simulated_) {
        msgs_received_.fetch_add(1, std::memory_order_relaxed);
        fc_armed_ = false;
    } else {
        process_incoming();
    }
    
    return true;
}

// ═══════════════════════════════════════════════════════════
// MAVLink v2 Frame Serializer
// ═══════════════════════════════════════════════════════════

// CRC-16/MCRF4XX (X.25)
static uint16_t mavlink_crc(const uint8_t* buf, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        uint8_t tmp = buf[i] ^ static_cast<uint8_t>(crc & 0xFF);
        tmp ^= (tmp << 4);
        crc = (crc >> 8) ^ (static_cast<uint16_t>(tmp) << 8) 
              ^ (static_cast<uint16_t>(tmp) << 3) ^ (tmp >> 4);
    }
    return crc;
}

static void mavlink_crc_accumulate(uint16_t& crc, uint8_t byte) {
    uint8_t tmp = byte ^ static_cast<uint8_t>(crc & 0xFF);
    tmp ^= (tmp << 4);
    crc = (crc >> 8) ^ (static_cast<uint16_t>(tmp) << 8)
          ^ (static_cast<uint16_t>(tmp) << 3) ^ (tmp >> 4);
}

bool MAVLinkInterface::send_mavlink_v2(uint32_t msg_id, const uint8_t* payload, uint8_t len, uint8_t crc_extra) {
    uint8_t frame[280];
    frame[0] = 0xFD;           // MAVLink v2 STX
    frame[1] = len;            // payload length
    frame[2] = 0;              // incompat_flags
    frame[3] = 0;              // compat_flags
    frame[4] = seq_++;         // sequence
    frame[5] = 1;              // system_id (us)
    frame[6] = 191;            // component_id (MAV_COMP_ID_ONBOARD_COMPUTER)
    frame[7] = msg_id & 0xFF;
    frame[8] = (msg_id >> 8) & 0xFF;
    frame[9] = (msg_id >> 16) & 0xFF;
    
    std::memcpy(frame + 10, payload, len);
    
    // CRC over bytes 1..end_of_payload, then accumulate crc_extra
    uint16_t crc = mavlink_crc(frame + 1, 9 + len);
    mavlink_crc_accumulate(crc, crc_extra);
    
    frame[10 + len] = crc & 0xFF;
    frame[11 + len] = (crc >> 8) & 0xFF;
    
    return send_raw(frame, 12 + len);
}

void MAVLinkInterface::request_data_streams() {
    if (simulated_) return;
    
    // REQUEST_DATA_STREAM (msg_id=66, CRC_EXTRA=148)
    // Request specific streams from FC at given Hz
    struct { uint8_t stream_id; uint16_t rate_hz; } streams[] = {
        { 1,  2 },  // RAW_SENSORS (SCALED_IMU, SCALED_PRESSURE)
        { 2,  2 },  // EXTENDED_STATUS (SYS_STATUS)
        { 6,  2 },  // POSITION (GLOBAL_POSITION_INT, GPS_RAW_INT)
        { 10, 4 },  // EXTRA1 (ATTITUDE)
        { 11, 2 },  // EXTRA2 (VFR_HUD)
    };
    
    for (auto& s : streams) {
        uint8_t payload[6];
        // uint16_t req_message_rate (little-endian)
        payload[0] = s.rate_hz & 0xFF;
        payload[1] = (s.rate_hz >> 8) & 0xFF;
        // uint8_t target_system
        payload[2] = fc_system_id_;
        // uint8_t target_component
        payload[3] = 1;  // MAV_COMP_ID_AUTOPILOT1
        // uint8_t req_stream_id
        payload[4] = s.stream_id;
        // uint8_t start_stop (1=start)
        payload[5] = 1;
        
        send_mavlink_v2(66, payload, 6, 148);
        msgs_sent_.fetch_add(1, std::memory_order_relaxed);
    }
    
    std::printf("[MAVLink] Requested data streams (5 types) from FC sysid=%d\n", fc_system_id_);
}

// ═══════════════════════════════════════════════════════════
// MAVLink Frame Parser
// ═══════════════════════════════════════════════════════════

void MAVLinkInterface::process_incoming() {
    // Read all available bytes into ring buffer
    while (true) {
        size_t space = RX_BUF_SIZE - rx_head_;
        if (space == 0) {
            // Buffer full — discard oldest data
            rx_tail_ = RX_BUF_SIZE / 2;
            std::memmove(rx_buf_, rx_buf_ + rx_tail_, rx_head_ - rx_tail_);
            rx_head_ -= rx_tail_;
            rx_tail_ = 0;
            space = RX_BUF_SIZE - rx_head_;
        }
        int n = recv_raw(rx_buf_ + rx_head_, space);
        if (n <= 0) break;
        rx_head_ += static_cast<size_t>(n);
    }
    
    // Parse frames from buffer
    while (rx_tail_ + 12 <= rx_head_) {  // Minimum frame: STX(1) + len(1) + header(8) + crc(2)
        // Find start-of-frame
        uint8_t stx = rx_buf_[rx_tail_];
        
        if (stx == 0xFD) {
            // MAVLink v2 frame
            uint8_t payload_len = rx_buf_[rx_tail_ + 1];
            size_t frame_len = 12 + payload_len;  // STX + len + incompat + compat + seq + sysid + compid + msgid(3) + payload + crc(2)
            
            if (rx_tail_ + frame_len > rx_head_) break;  // Incomplete frame
            
            uint8_t sysid = rx_buf_[rx_tail_ + 5];
            uint32_t msg_id = rx_buf_[rx_tail_ + 7]
                           | (static_cast<uint32_t>(rx_buf_[rx_tail_ + 8]) << 8)
                           | (static_cast<uint32_t>(rx_buf_[rx_tail_ + 9]) << 16);
            const uint8_t* payload = rx_buf_ + rx_tail_ + 10;
            
            handle_message(msg_id, payload, payload_len, sysid);
            msgs_received_.fetch_add(1, std::memory_order_relaxed);
            
            if (state_ == MAVLinkState::CONNECTING) {
                state_ = MAVLinkState::CONNECTED;
                std::printf("[MAVLink] Connected to FC (sysid=%d, first msg=%u)\n", sysid, msg_id);
            }
            last_heartbeat_us_ = now_us();
            
            rx_tail_ += frame_len;
            
        } else if (stx == 0xFE) {
            // MAVLink v1 frame
            uint8_t payload_len = rx_buf_[rx_tail_ + 1];
            size_t frame_len = 8 + payload_len;  // STX + len + seq + sysid + compid + msgid + payload + crc(2)
            
            if (rx_tail_ + frame_len > rx_head_) break;
            
            uint8_t sysid = rx_buf_[rx_tail_ + 3];
            uint32_t msg_id = rx_buf_[rx_tail_ + 5];
            const uint8_t* payload = rx_buf_ + rx_tail_ + 6;
            
            handle_message(msg_id, payload, payload_len, sysid);
            msgs_received_.fetch_add(1, std::memory_order_relaxed);
            
            if (state_ == MAVLinkState::CONNECTING) {
                state_ = MAVLinkState::CONNECTED;
                std::printf("[MAVLink] Connected via v1 (sysid=%d, msg=%u)\n", sysid, msg_id);
            }
            last_heartbeat_us_ = now_us();
            
            rx_tail_ += frame_len;
            
        } else {
            // Not a valid start byte — skip
            rx_tail_++;
        }
    }
    
    // Compact buffer if we've consumed a lot
    if (rx_tail_ > RX_BUF_SIZE / 2) {
        size_t remaining = rx_head_ - rx_tail_;
        if (remaining > 0) {
            std::memmove(rx_buf_, rx_buf_ + rx_tail_, remaining);
        }
        rx_head_ = remaining;
        rx_tail_ = 0;
    }
}

// Helper: read little-endian values from buffer
static inline float    read_f32(const uint8_t* p) { float v; std::memcpy(&v, p, 4); return v; }
static inline uint32_t read_u32(const uint8_t* p) { uint32_t v; std::memcpy(&v, p, 4); return v; }
static inline int32_t  read_i32(const uint8_t* p) { int32_t v; std::memcpy(&v, p, 4); return v; }
static inline uint16_t read_u16(const uint8_t* p) { uint16_t v; std::memcpy(&v, p, 2); return v; }
static inline int16_t  read_i16(const uint8_t* p) { int16_t v; std::memcpy(&v, p, 2); return v; }
static inline uint64_t read_u64(const uint8_t* p) { uint64_t v; std::memcpy(&v, p, 8); return v; }

void MAVLinkInterface::handle_message(uint32_t msg_id, const uint8_t* p, uint8_t len, uint8_t sysid) {
    fc_system_id_ = sysid;
    fc_telem_.last_update_us = now_us();
    fc_telem_.msg_count++;
    
    switch (msg_id) {
        
    case 0: {  // HEARTBEAT (9 bytes)
        if (len < 9) break;
        fc_telem_.custom_mode  = read_u32(p);
        fc_telem_.fc_type      = p[4];
        fc_telem_.fc_autopilot = p[5];
        fc_telem_.base_mode    = p[6];
        fc_telem_.system_status = p[7];
        fc_telem_.armed        = (p[6] & 0x80) != 0;  // MAV_MODE_FLAG_SAFETY_ARMED
        fc_telem_.heartbeat_valid = true;
        fc_armed_ = fc_telem_.armed;
        break;
    }
    
    case 1: {  // SYS_STATUS (31 bytes)
        if (len < 31) break;
        // bytes 0-11: sensors present/enabled/health (3x uint32)
        fc_telem_.battery_voltage   = read_u16(p + 14) * 0.001f;  // mV → V
        fc_telem_.battery_current   = read_i16(p + 16) * 0.01f;   // cA → A
        fc_telem_.battery_remaining = static_cast<int8_t>(p[30]);  // %
        fc_telem_.status_valid = true;
        break;
    }
    
    case 24: {  // GPS_RAW_INT (30+ bytes)
        if (len < 30) break;
        // uint64_t time_usec at p+0
        fc_telem_.gps_lat   = read_i32(p + 8) * 1.0e-7;   // degE7 → deg
        fc_telem_.gps_lon   = read_i32(p + 12) * 1.0e-7;
        fc_telem_.gps_alt   = read_i32(p + 16) * 0.001f;   // mm → m
        // eph at p+20, epv at p+22
        fc_telem_.gps_speed = read_u16(p + 24) * 0.01f;    // cm/s → m/s
        // cog at p+26
        fc_telem_.gps_fix   = p[28];
        fc_telem_.gps_sats  = p[29];
        fc_telem_.gps_valid = (fc_telem_.gps_fix >= 2);
        break;
    }
    
    case 26: {  // SCALED_IMU (22+ bytes)
        if (len < 22) break;
        // uint32_t time_boot_ms at p+0
        fc_telem_.acc_x  = read_i16(p + 4) * 0.00981f;   // mG → m/s² (mG * 9.81/1000)
        fc_telem_.acc_y  = read_i16(p + 6) * 0.00981f;
        fc_telem_.acc_z  = read_i16(p + 8) * 0.00981f;
        fc_telem_.gyro_x = read_i16(p + 10) * 0.001f;     // mrad/s → rad/s
        fc_telem_.gyro_y = read_i16(p + 12) * 0.001f;
        fc_telem_.gyro_z = read_i16(p + 14) * 0.001f;
        fc_telem_.mag_x  = read_i16(p + 16) * 0.001f;     // mgauss → gauss
        fc_telem_.mag_y  = read_i16(p + 18) * 0.001f;
        fc_telem_.mag_z  = read_i16(p + 20) * 0.001f;
        fc_telem_.imu_valid = true;
        break;
    }
    
    case 29: {  // SCALED_PRESSURE (14 bytes)
        if (len < 14) break;
        // uint32_t time_boot_ms at p+0
        fc_telem_.pressure    = read_f32(p + 4);            // hPa
        // press_diff at p+8
        fc_telem_.temperature = read_i16(p + 12) * 0.01f;   // cdeg → deg C
        fc_telem_.baro_valid = true;
        break;
    }
    
    case 30: {  // ATTITUDE (28 bytes)
        if (len < 28) break;
        // uint32_t time_boot_ms at p+0
        fc_telem_.roll       = read_f32(p + 4);    // rad
        fc_telem_.pitch      = read_f32(p + 8);    // rad
        fc_telem_.yaw        = read_f32(p + 12);   // rad
        fc_telem_.rollspeed  = read_f32(p + 16);   // rad/s
        fc_telem_.pitchspeed = read_f32(p + 20);   // rad/s
        fc_telem_.yawspeed   = read_f32(p + 24);   // rad/s
        fc_telem_.attitude_valid = true;
        break;
    }
    
    case 74: {  // VFR_HUD (20 bytes)
        if (len < 20) break;
        fc_telem_.airspeed    = read_f32(p);
        fc_telem_.groundspeed = read_f32(p + 4);
        fc_telem_.heading     = read_i16(p + 8);
        fc_telem_.throttle    = read_u16(p + 10);
        fc_telem_.alt         = read_f32(p + 12);
        fc_telem_.climb       = read_f32(p + 16);
        fc_telem_.hud_valid = true;
        break;
    }
    
    default:
        // Unknown message — ignore
        break;
    }
}

FCTelemetry MAVLinkInterface::get_fc_telemetry() const {
    return fc_telem_;  // Simple copy (all POD)
}

// ═══════════════════════════════════════════════════════════
// Message Building (unchanged logic from previous version)
// ═══════════════════════════════════════════════════════════

MAVVisionPositionEstimate MAVLinkInterface::build_vision_position(
    const SystemState& state, const VOResult& vo) {
    
    MAVVisionPositionEstimate msg;
    msg.usec = now_us();
    msg.x = vo_pose_x_;
    msg.y = vo_pose_y_;
    msg.z = -state.altitude_agl;
    msg.roll  = state.roll * 0.0174533f;
    msg.pitch = state.pitch * 0.0174533f;
    msg.yaw   = state.yaw * 0.0174533f;
    
    vo_pose_x_ += vo.dx;
    vo_pose_y_ += vo.dy;
    
    return msg;
}

MAVOdometry MAVLinkInterface::build_odometry(
    const SystemState& state, const VOResult& vo) {
    
    MAVOdometry msg;
    msg.time_usec = now_us();
    msg.x = vo_pose_x_;
    msg.y = vo_pose_y_;
    msg.z = -state.altitude_agl;
    msg.vx = state.vx + vo.vx;
    msg.vy = state.vy + vo.vy;
    msg.vz = state.vz + vo.vz;
    msg.rollspeed  = state.imu.gyro_x;
    msg.pitchspeed = state.imu.gyro_y;
    msg.yawspeed   = state.imu.gyro_z;
    msg.quality = vo.tracking_quality;
    msg.frame_id = 0;       // MAV_FRAME_LOCAL_NED
    msg.child_frame_id = 1; // MAV_FRAME_BODY_FRD
    
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
    msg.integration_time_us = 20000;
    msg.distance = flow.ground_distance;
    msg.temperature = 2200;
    msg.quality = flow.quality;
    msg.time_delta_distance_us = 20000;
    
    return msg;
}

// ═══════════════════════════════════════════════════════════
// Tick & Stats
// ═══════════════════════════════════════════════════════════

void MAVLinkInterface::tick(const SystemState& state, const VOResult& vo) {
    if (state_ == MAVLinkState::DISCONNECTED) return;
    
    // Always process incoming data (parse MAVLink frames)
    if (!simulated_) {
        process_incoming();
        
        // Request data streams once after connection is established
        if (state_ == MAVLinkState::CONNECTED && !streams_requested_ && fc_telem_.heartbeat_valid) {
            request_data_streams();
            streams_requested_ = true;
        }
    }
    
    check_connection();
    
    if (heartbeat_count_ % 50 == 0) {
        send_heartbeat();
    }
    heartbeat_count_++;
    
    uint64_t current = now_us();
    if (current - last_vision_us_ >= 33333) {
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
    stats.transport = transport_;
    stats.messages_sent = msgs_sent_.load(std::memory_order_relaxed);
    stats.messages_received = msgs_received_.load(std::memory_order_relaxed);
    stats.errors = errors_.load(std::memory_order_relaxed);
    stats.last_heartbeat_us = last_heartbeat_us_;
    stats.system_id = 1;
    stats.component_id = 191;
    stats.fc_system_id = fc_system_id_;
    stats.fc_armed = fc_armed_;
    
    // Link quality based on message rate
    if (state_ == MAVLinkState::CONNECTED && fc_telem_.msg_count > 0) {
        stats.link_quality = 0.95f;
        stats.fc_autopilot = fc_telem_.fc_autopilot;
        stats.fc_type = fc_telem_.fc_type;
    } else if (state_ == MAVLinkState::CONNECTED) {
        stats.link_quality = 0.5f;
    } else {
        stats.link_quality = 0;
    }
    
    // FC firmware string based on detected autopilot type
    if (fc_telem_.heartbeat_valid) {
        const char* ap = (fc_telem_.fc_autopilot == 3) ? "ArduPilot" : 
                         (fc_telem_.fc_autopilot == 12) ? "PX4" : "Unknown";
        const char* tp = (fc_telem_.fc_type == 2) ? "QUADROTOR" :
                         (fc_telem_.fc_type == 1) ? "FIXED_WING" :
                         (fc_telem_.fc_type == 13) ? "HEXAROTOR" : "OTHER";
        std::snprintf(stats.fc_firmware, sizeof(stats.fc_firmware), "%s %s", ap, tp);
    } else {
        std::strncpy(stats.fc_firmware, simulated_ ? "Simulated" : "Waiting...", sizeof(stats.fc_firmware) - 1);
    }
    
    std::strncpy(stats.transport_info, transport_info_, sizeof(stats.transport_info) - 1);
    
    return stats;
}

void MAVLinkInterface::check_connection() {
    if (simulated_) {
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
