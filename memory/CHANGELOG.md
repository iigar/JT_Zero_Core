# JT-Zero Changelog

## 2026-03-23 — Multi-Camera Architecture (P1)

### Multi-Camera Support
- **C++ Header (camera.h)**: Added `CameraSlot` enum (PRIMARY/SECONDARY), `CameraSlotInfo` struct, multi-camera methods to `CameraPipeline` (init_secondary, capture_secondary, get_slot_info, camera_count)
- **C++ Pipeline (camera_pipeline.cpp)**: Implemented secondary camera lifecycle (init, capture on-demand, shutdown), slot info reporting
- **Backend API (server.py)**: 4 new endpoints — `GET /api/cameras`, `GET /api/camera/secondary/stats`, `POST /api/camera/secondary/capture`, `GET /api/camera/secondary/frame`
- **Backend Bridge (native_bridge.py)**: Multi-camera fallback methods for C++ runtime (lazy-init, simulated thermal frames)
- **Backend Simulator (simulator.py)**: Full multi-camera simulation with thermal hotspot generation
- **Frontend ThermalPanel.js**: New component — on-demand capture, auto-refresh (1fps), iron palette false-color rendering, temperature legend
- **Frontend App.js**: CameraTab with SPLIT/VO ONLY/THERMAL view switcher, Dashboard sidebar CAMERAS section
- **WebSocket**: `cameras` array added to telemetry payload
- **Testing**: 24/24 tests pass (100%)

### Variant B — CSI Priority, USB Fallback
- **C++ camera.h**: Added `CSISensorType` enum (OV5647, IMX219, IMX477, IMX708, OV9281, IMX296, OV64A40), `CSISensorInfo` struct with sensor specs
- **C++ camera_drivers.cpp**: `detect_sensor()` — parses rpicam-hello output to identify CSI sensor model; `find_usb_device()` — scans /dev/video0..9 for USB cameras (skips CSI V4L2 devices); `initialize_multicam()` — Variant B logic
- **C++ PiCSICamera**: Stores detected sensor type and info, dynamic camera name from sensor model
- **Backend labels**: Dynamic PRIMARY label (CSI sensor name or "USB fallback"), "USB Thermal (Down)" for secondary
- **Frontend**: CSI sensor badge in Camera tab header, "USB Fallback" warning badge when no CSI

### Resource Management Strategy
- Primary CSI camera: Always active for VO navigation
- Secondary USB thermal: On-demand capture only (not continuous streaming)
- Suitable for both Pi Zero 2W (512MB) and Pi 4B (4GB)

## 2026-03-23 — EKF3 Integration, Automation, UI Refresh

### EKF3 ExternalNav
- ArduPilot EKF3 confirmed using JT-Zero VO data: "EKF3 IMU0/1 is using external nav data"
- VISION_POSITION_ESTIMATE @ 25Hz + ODOMETRY @ 25Hz flowing to FC
- Verified on both Pi Zero 2W and Pi 4B + Matek H743

### Automation Scripts
- `setup.sh` — full first-install automation (deps, UART/I2C/SPI, build, systemd, reboot)
- `update.sh` — quick update with auto Pi model detection (make -j2 for Zero, -j4 for Pi 4/5)

### UI Refresh
- Rounded corners: 12px on all panels (was sharp/2px)
- Font scaling: ~1.5x larger globally (8px→10, 9→11, 10→12, 11→13, xs→13px)
- Colors lightened 20-30%: borders #1E293B→#2D3A4E, accent #00F0FF→#33CCFF, bg #050505→#080A0F
- MAVLink panel expanded: bytes TX/RX, heartbeats_received, CRC errors, transport info, vision message counters, FC telemetry (att/imu/gps/batt), detected msg_ids
- Events tab: scroll-lock — log stays at user's scroll position, "Scroll to bottom" button appears

## 2026-03-22 — MAVLink Parser Overhaul (P0 Fix)

### Bug Fixes
- **Auto-baud detection**: Probes 115200/921600/57600/230400/460800, picks first with valid MAVLink STX markers (~500ms/rate)
- **CRC validation**: Added CRC-16/MCRF4XX on all received frames. Previously garbage bytes from baud mismatch counted as valid messages.
- **Heartbeat filter relaxed**: Old code rejected type=0 (GENERIC) and type=18 unconditionally. Now only filters own echoes (sysid=1+type=18), GCS, ADSB.
- **MAVLink v2 zero truncation**: Heartbeat min payload length 7→5. v2 trims trailing zeros, so base_mode=0 heartbeats had len<7.
- **MAVLink v2 signing**: Parser detects incompat_flags bit 0, adds 13-byte signature to frame length.

### New Diagnostics
- `bytes_sent` / `bytes_received` raw byte counters in /api/mavlink
- `heartbeats_received` separate heartbeat counter
- `crc_errors` count of CRC-failed frames
- `detected_msg_ids` always visible (not just after heartbeat)
- `transport_info` shows port + baud rate
- Raw hex dump of first 32 bytes in journalctl logs
- Per-heartbeat logging (first 10) with type/sysid/autopilot

### Verified
- Pi Zero 2W + Matek H743 @ 115200 baud
- State=CONNECTED, Heartbeats=4, FC=ArduPilot QUADROTOR
- Attitude + IMU telemetry flowing, 0 CRC errors

## 2026-02/03 — Visual Odometry & Camera Overhaul

- USB Camera V4L2 MMAP rewrite
- Platform/VO Mode separation
- LK Tracker bilinear interpolation (critical fix)
- Sobel 3x3 gradients (4x signal amplification)
- Shi-Tomasi grid corner detector for thermal
- Verified on Pi 4 + Caddx thermal: Det:180, Track:16-59, Conf:0.18-0.29
