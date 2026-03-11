# JT-Zero Runtime - PRD

## Original Problem Statement
Design and implement JT-Zero robotics runtime for lightweight drone autonomy on Raspberry Pi Zero 2 W.
Full scope: C++ core, Python bindings (pybind11), FastAPI backend, React monitoring dashboard.

## Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                 JT-Zero Native C++ Runtime                      │
│  T0: Supervisor (10Hz)    T5: MAVLink (50Hz)                    │
│  T1: Sensors (200Hz)      T6: Camera (15FPS FAST+LK VO)        │
│  T2: Events (200Hz)       T7: API Bridge (30Hz)                 │
│  T3: Reflex (200Hz)       Lock-free SPSC Ring Buffers           │
│  T4: Rules (20Hz)         Lock-free MemoryPool (O(1) CAS)      │
│                                                                 │
│  pybind11 ──→ FastAPI ──→ WebSocket 10Hz ──→ React Dashboard   │
└─────────────────────────────────────────────────────────────────┘
```

## Completed Phases
- Phase 1-3: Architecture + Core Runtime
- Phase 4: Sensor Modules
- Phase 5: Camera Pipeline
- Phase 6: MAVLink Interface
- Phase 7: Python Bindings (pybind11)
- Phase 8: FastAPI Server
- Phase 9: React Dashboard
- Phase 10: Performance Optimization
- Phase 11: Real Sensor Drivers (I2C/SPI/UART HALs, MPU6050, BMP280, NMEA GPS)

## Recent Work (2026-03-11)

### UI Overhaul
- 7-tab interface: Dashboard, Telemetry, Camera/VO, MAVLink, Events, Docs, Settings
- SettingsTab: Simulator config (6 sliders), Runtime info, System Resources, MAVLink, Hardware Sensors, Thread Status, Engine Statistics
- DocumentationTab: 6 sections (Pi Zero Install 11-step Ukrainian guide, Wiring/GPIO with ASCII pinout, API Reference, Thread Model, File Structure, Hardware)
- 3D drone visualization: detailed model (landing gear, camera gimbal, GPS tower, battery, antenna, LEDs), 50% lighter, almost-white (#F8FAFC) background

### P1: Real Sensor Drivers with Auto-Detect
- C++ sensors (sensors.h/cpp): Added try_hardware() methods for IMU, Baro, GPS
- Auto-detect flow: probe I2C bus for MPU6050/BMP280, check UART for GPS
- Backend: /api/hardware endpoint returns sensor detection status
- WebSocket: sensor_modes field in telemetry (imu, baro, gps, rangefinder, optical_flow)
- Frontend: SettingsTab shows HW/SIM badges from live telemetry

### P2: Camera Drivers (PI_CSI + USB V4L2)
- PiCSICamera: V4L2 via /dev/video0, MMAP capture, auto-detect CSI vs USB driver
- USBCamera: V4L2 YUYV→grayscale, read-based capture
- CameraPipeline::auto_detect_camera(): CSI → USB → Simulation fallback
- camera_drivers.cpp with full Linux V4L2 implementation

### P2: MAVLink Serial/UDP Transport
- MAVTransport enum: SIMULATED, SERIAL, UDP
- initialize_serial(): UART config (8N1, 921600 baud), /dev/ttyAMA0 
- initialize_udp(): non-blocking socket, 127.0.0.1:14550
- auto_detect_transport(): tries serial ports, then UDP
- send_raw/recv_raw: transport-agnostic I/O
- MAVLinkStats now includes transport type and transport_info string

## Testing Status
- Iteration 7: Backend 100% (48 tests), Frontend 100%
- All new features verified: hardware endpoint, sensor modes, light 3D theme, settings HW/SIM badges, docs install/wiring

## Backlog
### P2
- Autonomous mission planning (waypoint navigation)
- recharts ResponsiveContainer width=0 console warning (cosmetic)
- MAVLink v2 message serialization (currently counting only on real transport)
- Camera IP_STREAM support (RTSP/HTTP for network cameras)
