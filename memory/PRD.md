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
- Camera Setup Docs, Matek H743-SLIM V3 Docs, DEPLOYMENT.md Camera Section

### 2026-03-13 Critical Fixes (Session 1):
- **native_bridge.py**: Fixed `set_simulator_mode(True)` → auto-detect (Pi = hardware mode)
- **camera_drivers.cpp**: Fixed 320x240 → 640x480 capture (OV5647 minimum), multi-device scan
- **camera.h**: Updated PiCSICamera for rpicam-vid pipe-based capture
- **RESULT**: Pi Camera OV5647 working! PI_CSI detected, 15fps, real VO features

### 2026-03-13 Fixes (Session 2):
- **CameraPanel.js**: Fixed critical prop name mismatch (`cameraData` → `camera`) — video was NEVER displaying
- **CameraPanel.js**: Fixed null handling (camera state initially null, not undefined)
- **CameraPanel.js**: Fixed `isReal` check — SIM camera type was incorrectly treated as real
- **useApi.js**: Added same-origin fallback for WebSocket (supports Pi deployment without hardcoded URL)
- **mavlink_interface.h**: Fixed baud rate 921600 → 115200 (matching FC config)
- **RESULT**: Live video streaming working on Pi! MAVLink CONNECTED to Matek H743 FC!

### 2026-03-13 VO Features (Session 2):
- **camera.h**: Added public `features()` and `feature_count()` accessors to VisualOdometry
- **camera.h**: Added `vo()` accessor to CameraPipeline
- **python_bindings.cpp**: New `get_features()` method returns [{x, y, tracked, response}, ...]
- **native_bridge.py**: Added `get_features()` method
- **server.py**: Features sent via WebSocket + new `/api/camera/features` endpoint
- **App.js**: Features state passed through to CameraPanel
- **CameraPanel.js**: Draws REAL feature positions (tracked=green squares, detected=cyan circles)

## Testing
- Iteration 9: Backend 100% (51 tests), Frontend 100%
- Session 2: Backend tested via curl on Pi, frontend visually confirmed

## Current Status
- Camera: WORKING (PI_CSI, OV5647, 15fps, real VO with feature positions)
- MAVLink: CONNECTED (Serial /dev/ttyAMA0 @ 115200 to Matek H743-SLIM V3)
- Sensors: Simulation (no physical I2C/SPI sensors connected)
- Dashboard: Serving from static files on Pi

## Backlog
### P0
- MAVLink message parsing (currently connected but not parsing FC telemetry)
- Real FC data (IMU, Baro, GPS) should replace simulated values

### P1
- Enable I2C/SPI on Pi for direct sensor access
- Hardware Diagnostics Panel (auto-check camera, I2C/SPI, MAVLink on startup)

### P2
- Direct I2C/SPI sensor drivers (MPU6050, BMP280)
- Autonomous mission planning (waypoint navigation)
- MAVLink v2 full message serialization
- Camera IP_STREAM (RTSP/HTTP)
- Thermal camera support
- Performance optimization (ARM NEON intrinsics)

## Architecture
```
/app
├── backend/
│   ├── static/           # Built React frontend
│   ├── server.py         # FastAPI + WebSocket + camera frame endpoint
│   ├── native_bridge.py  # C++ wrapper with get_features()
│   └── simulator.py      # Python fallback
├── frontend/src/
│   ├── App.js            # Main app with features state
│   ├── components/
│   │   └── CameraPanel.js # Real VO feature overlay
│   └── hooks/useApi.js   # WebSocket with same-origin support
├── jt-zero/              # C++ Core
│   ├── include/jt_zero/
│   │   ├── camera.h      # FeaturePoint, VO with features() accessor
│   │   └── mavlink_interface.h # 115200 baud default
│   ├── api/python_bindings.cpp # get_features() binding
│   └── mavlink/mavlink_interface.cpp
└── memory/PRD.md
```
