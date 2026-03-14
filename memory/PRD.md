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
│   ├── simulator.py         # Python fallback for non-Pi environments
│   ├── diagnostics.py       # Hardware scanning (camera, I2C, UART, etc.)
│   ├── system_metrics.py    # OS metrics via psutil
│   └── tests/
│       └── test_jtzero_api.py  # 77 tests passing
├── frontend/src/
│   ├── App.js               # Main app with throttled state updates (5Hz)
│   ├── components/
│   │   ├── CameraPanel.js   # Real VO feature overlay on live video
│   │   ├── MAVLinkPanel.js  # React.memo wrapped MAVLink display
│   │   ├── SensorPanels.js  # React.memo wrapped sensor display
│   │   ├── PerformancePanel.js # React.memo wrapped system monitor
│   │   ├── DiagnosticsPanel.js # Hardware diagnostics UI
│   │   ├── TelemetryCharts.js  # Auto-scaling charts
│   │   ├── DocumentationTab.js # Docs tab
│   │   └── SettingsTab.js      # Settings with diagnostics
│   └── hooks/useApi.js      # WebSocket with same-origin support
├── jt-zero/                 # C++ Core
│   ├── README.md            # Beginner-friendly overview (UPDATED)
│   ├── DEPLOYMENT.md        # Install guide with offline method (UPDATED)
│   ├── SYSTEM.md            # Architecture + algorithms (UPDATED)
│   ├── COMMANDS.md          # Command reference
│   ├── FC_CONNECTION.md     # Flight controller wiring guide
│   ├── include/jt_zero/
│   │   ├── camera.h         # FeaturePoint, VO with features() accessor
│   │   ├── mavlink_interface.h  # FCTelemetry struct, v2 parser, CRC
│   │   └── runtime.h
│   ├── api/python_bindings.cpp  # get_features(), FC telemetry export
│   ├── core/runtime.cpp     # mavlink_loop feeds FC data into state
│   └── mavlink/mavlink_interface.cpp  # Full MAVLink v2/v1 parser + VO serializer
└── memory/
    └── PRD.md              # This file
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
- Implemented live video streaming (C++ -> pybind11 -> FastAPI -> React)

### 2026-03-13 Session 2 (Video + MAVLink)
- Fixed CameraPanel prop mismatch, null handling, useApi.js same-origin
- Implemented VO Feature Position Export
- Full MAVLink v2/v1 frame parser with 9 message types
- MAVLink v2 frame serializer with CRC-16/MCRF4XX
- Auto stream request, FC data feeds into SystemState

### 2026-03-14 Session (System Monitor + Charts + Diagnostics)
- Replaced PerformancePanel with System Monitor (psutil)
- Improved TelemetryCharts with auto-scaling
- Hardware Diagnostics Panel
- Direct I2C/SPI Sensor Driver Integration
- MAVLink VO Serialization (VISION_POSITION_ESTIMATE, ODOMETRY, OPTICAL_FLOW_RAD)
- ArduPilot EKF successfully using VO as ExternalNav source

### 2026-03-14 Session (P0 Fix + Docs)
- **P0 Fix: MAVLink data jitter** -- Throttled frontend state updates from 10Hz to 5Hz
  using pendingRef + setInterval mechanism. Added React.memo to MAVLinkPanel,
  SensorPanels, PerformancePanel. Backend builds consistent data snapshots.
- **Documentation Overhaul:**
  - README.md rewritten for beginners with doc links
  - DEPLOYMENT.md: added offline installation (ZIP/SCP/USB) without GitHub
  - DEPLOYMENT.md: added ArduPilot pre-arm fix guidance (Rangefinder, Battery, VisOdom)
  - SYSTEM.md: added ArduPilot EKF configuration details

## Current Hardware Status
- **Camera:** PI_CSI (OV5647) -- 15fps, real VO features
- **MAVLink:** CONNECTED via /dev/ttyAMA0 @ 115200 to Matek H743-SLIM V3
- **Attitude:** Real roll/pitch/yaw from FC
- **IMU:** Real ICM42688P data via RAW_IMU (27)
- **Barometer:** Real DPS310 data via SCALED_PRESSURE (29)
- **Battery:** Real 16.8V, 98%
- **VFR HUD:** Real altitude/speed/heading
- **GPS:** No fix (needs GPS antenna or outdoor test)
- **EKF:** Accepting VO as ExternalNav source

## FC Info
- ArduCopter V4.3.6
- Frame: QUAD/V
- Matek H743-SLIM V3 (MatekH743-bdshot)
- Dual IMU: ICM42688P (2kHz fast sampling)
- Baro: DPS310
- PreArm: Rangefinder no data (not connected)
- PreArm: Battery below minimum arming (needs charge)

## Backlog

### P1
- Fix CRC for outgoing REQUEST_DATA_STREAM (currently needs SR4_* manual config)

### P2
- IP camera (RTSP/HTTP) and thermal camera support
- ARM NEON optimization for C++ core
- Autonomous mission planning (waypoint navigation UI)
- Direct I2C/SPI sensor drivers (MPU6050, BMP280) -- C++ code complete, needs recompile on Pi

## Testing Status
- 77 backend pytest tests passing (iteration 13)
- All 7 frontend tabs verified working
- Test file: /app/backend/tests/test_jtzero_api.py
- Latest test report: /app/test_reports/iteration_13.json
