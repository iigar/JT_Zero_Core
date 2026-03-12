# JT-Zero Runtime - PRD

## Original Problem Statement
JT-Zero robotics runtime for drone autonomy on Raspberry Pi Zero 2 W.
C++ core, Python bindings (pybind11), FastAPI backend, React dashboard.

## Completed
- Phase 1-11: Full runtime, sensors, camera, MAVLink, dashboard
- Bug fixes: VO displacement, MemoryPool race, MAVLink semantics, roll atan2
- UI overhaul: 7-tab interface, detailed 3D drone, gray-green background
- P1: Sensor auto-detect (I2C/UART probing, HW/SIM badges)
- P2: Camera drivers (PiCSI V4L2, USB V4L2), MAVLink Serial/UDP
- Layout fix: Fixed panel overflow (fixed heights 240/220/150px + overflow-hidden)
- Event dedup: _filter_events() groups same events with (xN)
- Camera Setup Docs: Complete guide for Pi Camera (CSI/USB), libcamera → rpicam, troubleshooting
- Matek H743-SLIM V3 Detailed Docs: Board layout, UART6 wiring, ArduPilot params, full drone diagram
- DEPLOYMENT.md Camera Section: Etap 11 with camera setup, rpicam commands

### 2026-03-13 Critical Fixes:
- **native_bridge.py**: Fixed `set_simulator_mode(True)` → auto-detect (Pi = hardware mode)
- **camera_drivers.cpp**: Fixed 320x240 → 640x480 capture (OV5647 minimum), multi-device scan
- **camera_drivers.cpp**: Added rpicam-vid subprocess approach for libcamera compatibility
- **camera.h**: Updated PiCSICamera class for rpicam-vid pipe-based capture
- **RESULT**: Pi Camera OV5647 working! PI_CSI detected, 15fps, real VO features from camera!

## Testing
- Iteration 9: Backend 100% (51 tests), Frontend 100%

## Current Status
- Camera: WORKING (PI_CSI, OV5647, 15fps, real VO)
- Sensors: Simulation (no physical I2C/SPI sensors connected)
- MAVLink: Not connected (no FC connected yet)
- Dashboard: Serving from static files on Pi

## Backlog
### P1
- Connect Matek H743-SLIM V3 via UART6 (MAVLink)
- Enable I2C/SPI on Pi for direct sensor access
- Implement real MAVLink connection (Serial/UDP transport)

### P2
- Autonomous mission planning (waypoint navigation)
- MAVLink v2 full message serialization
- Camera IP_STREAM (RTSP/HTTP)
- Thermal camera support (FLIR Lepton, MLX90640)
- Performance optimization (ARM NEON intrinsics)
- recharts console warnings (cosmetic)
