# JT-Zero Runtime - PRD

## Original Problem Statement
JT-Zero robotics runtime for drone autonomy on Raspberry Pi Zero 2 W.
C++ core, Python bindings (pybind11), FastAPI backend, React dashboard.

## Architecture
```
/app
├── backend/
│   ├── static/              # Built React frontend (REACT_APP_BACKEND_URL="")
│   ├── server.py            # FastAPI + WebSocket + camera endpoints
│   ├── native_bridge.py     # C++ wrapper with get_features()
│   └── simulator.py         # Python fallback for non-Pi environments
├── frontend/src/
│   ├── App.js               # Main app with features & telemetry state
│   ├── components/
│   │   ├── CameraPanel.js   # Real VO feature overlay on live video
│   │   └── DocumentationTab.js # Updated with real hardware images
│   └── hooks/useApi.js      # WebSocket with same-origin support
├── jt-zero/                 # C++ Core
│   ├── include/jt_zero/
│   │   ├── camera.h         # FeaturePoint, VO with features() accessor
│   │   ├── mavlink_interface.h  # FCTelemetry struct, v2 parser, CRC
│   │   └── runtime.h
│   ├── api/python_bindings.cpp  # get_features(), FC telemetry export
│   ├── core/runtime.cpp     # mavlink_loop feeds FC data into state
│   └── mavlink/mavlink_interface.cpp  # Full MAVLink v2/v1 parser
└── memory/PRD.md
```

## Completed Features

### Phase 1-11 (Previous sessions)
- Full C++ runtime with event processing, memory management, rules
- Sensor framework (IMU, Baro, GPS, Rangefinder, Optical Flow)
- Camera pipeline with Visual Odometry
- 7-tab React dashboard (Dashboard, Telemetry, Camera/VO, Config, System, Docs, 3D)
- Deployment guide for Raspberry Pi

### 2026-03-13 Session 1 (Critical Fixes)
- Fixed native_bridge.py: auto-detect Pi hardware mode
- Fixed camera_drivers.cpp: 640x480 for OV5647 CSI camera
- Implemented live video streaming (C++ → pybind11 → FastAPI → React)

### 2026-03-13 Session 2 (Video + MAVLink)
- **Fixed CameraPanel prop mismatch** (`cameraData` → `camera`) — video now displays
- **Fixed null handling** and `isReal` check for camera types
- **Fixed useApi.js** WebSocket same-origin for Pi deployment
- **Implemented VO Feature Position Export:**
  - camera.h: `features()` and `feature_count()` public accessors
  - python_bindings.cpp: `get_features()` returns [{x, y, tracked, response}]
  - CameraPanel.js: Real feature positions on canvas (green=tracked, cyan=detected)

### 2026-03-13 Session 2 (MAVLink Parser - MAJOR)
- **Full MAVLink v2/v1 frame parser** with ring buffer and state machine
- **Safe payload reading** handles MAVLink v2 zero-byte trimming
- **9 message types parsed:**
  - HEARTBEAT (0) — FC type, autopilot, armed state
  - SYS_STATUS (1) — battery voltage/current/remaining
  - GPS_RAW_INT (24) — lat/lon/alt/fix/sats
  - SCALED_IMU (26) — accelerometer/gyroscope/magnetometer
  - RAW_IMU (27) — same as 26 with uint64_t timestamp
  - SCALED_PRESSURE (29) — pressure/temperature
  - ATTITUDE (30) — roll/pitch/yaw in radians
  - GLOBAL_POSITION_INT (33) — fused GPS+INS position
  - VFR_HUD (74) — airspeed/groundspeed/heading/throttle/alt
- **MAVLink v2 frame serializer** with CRC-16/MCRF4XX
- **Auto stream request** via REQUEST_DATA_STREAM (msg 66)
- **FC data feeds into SystemState** replacing simulated values
- **Baud rate** fixed: 921600 → 115200

### Documentation Updates
- FC connection guide: UART3/TX3/RX3 → SERIAL4 (not UART6)
- Real hardware images: Pi Zero 2W pinout + Matek H743-SLIM V3
- Correct ArduPilot parameters: SR4_* stream rates
- UART mapping table for Matek H743-SLIM V3

## Current Hardware Status
- **Camera:** PI_CSI (OV5647) — 15fps, real VO features ✅
- **MAVLink:** CONNECTED via /dev/ttyAMA0 @ 115200 to Matek H743-SLIM V3 ✅
- **Attitude:** Real roll/pitch/yaw from FC ✅
- **IMU:** Real ICM42688P data via RAW_IMU (27) ✅
- **Barometer:** Real DPS310 data via SCALED_PRESSURE (29) ✅
- **Battery:** Real 16.8V, 98% ✅
- **VFR HUD:** Real altitude/speed/heading ✅
- **GPS:** No fix (needs GPS antenna or outdoor test)

## FC Info
- ArduCopter V4.3.6
- Frame: QUAD/V
- Matek H743-SLIM V3 (MatekH743-bdshot)
- Dual IMU: ICM42688P (2kHz fast sampling)
- Baro: DPS310
- PreArm: VisOdom not healthy (expected until calibrated)
- PreArm: Rangefinder no data (not connected)

## Backlog

### P1
- Implement MAVLink VISION_POSITION_ESTIMATE sending (so FC accepts VO data)
- Fix CRC for outgoing REQUEST_DATA_STREAM (currently needs SR4_* manual config)

### P2
- Direct I2C/SPI sensor drivers (MPU6050, BMP280) — C++ code complete, needs recompile on Pi
- Autonomous mission planning (waypoint navigation)
- Camera IP_STREAM (RTSP/HTTP), thermal camera
- Performance optimization (ARM NEON intrinsics)
- Full MAVLink v2 message serialization with proper CRC

### 2026-03-14 Session (System Monitor + Charts + Diagnostics)
- **Replaced PerformancePanel with System Monitor** — shows real OS metrics via psutil:
  CPU total + per-core, RAM used/total, temperature, disk usage, network TX/RX, process info, sparkline histories
- **Improved TelemetryCharts:**
  - Visible Y-axis labels with proper auto-scaling (paddedDomain)
  - Current value readouts next to chart titles
  - New Barometer pressure chart
  - ReferenceLine at y=0 for Attitude and Gyro charts
  - Disabled chart animations for smoother real-time updates
- **New backend module** `system_metrics.py` — uses psutil for CPU, RAM, temp, disk, network, process metrics
- **Updated /api/performance** — returns `{engine: ..., system: ...}` structure
- **WebSocket** now includes `system_metrics` field in telemetry payload
- **Hardware Diagnostics Panel:**
  - New `diagnostics.py` backend module: scans camera (CSI/USB), I2C buses + devices, SPI, UART ports, GPIO, MAVLink/FC
  - Auto-runs at startup via lifespan hook, caches results
  - `/api/diagnostics` GET (cached) and `/api/diagnostics/scan` POST (fresh scan)
  - Frontend `DiagnosticsPanel.js`: 3-column layout with summary badges, Re-Scan button
  - Integrated into Settings tab, replacing old "Hardware Sensors" section
  - Known I2C addresses: MPU6050 (0x68), BMP280 (0x76), HMC5883L (0x1E), etc.
- **Direct I2C/SPI Sensor Driver Integration:**
  - C++ runtime.cpp now calls `try_hardware()` during `initialize()` when not in simulator mode
  - Opens I2C bus, probes MPU6050 (0x68/0x69) and BMP280 (0x76/0x77) automatically
  - Opens UART for NMEA GPS on /dev/ttyS0
  - runtime.h: Added I2CBus, UARTBus, HardwareInfo members
  - python_bindings.cpp: Added `get_sensor_modes()` exposing hardware vs simulated status
  - `/api/sensors` endpoint returns sensor modes + hw_info
  - DiagnosticsPanel shows "C++ Sensor Drivers" section with HW/SIM badges
- **Backend tests:** 77 tests passing

