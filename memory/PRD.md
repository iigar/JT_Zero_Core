# JT-Zero Runtime - PRD

## Original Problem Statement
JT-Zero robotics runtime for drone autonomy on Raspberry Pi Zero 2 W.
C++ core, Python bindings (pybind11), FastAPI backend, React dashboard.

## Architecture
```
/app
├── backend/
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
│   │   ├── DocumentationTab.js # 8-section built-in docs
│   │   └── SettingsTab.js      # Settings with diagnostics
│   └── hooks/useApi.js      # WebSocket with same-origin support
├── jt-zero/                 # C++ Core
│   ├── README.md            # Beginner-friendly overview
│   ├── DEPLOYMENT.md        # Full install guide (online + offline methods)
│   ├── SYSTEM.md            # Architecture, VO algorithm, characteristics
│   ├── COMMANDS.md          # Complete command reference
│   ├── FC_CONNECTION.md     # Flight controller wiring guide
│   ├── create_archive.sh    # Installer archive generator
│   ├── CMakeLists.txt
│   ├── include/jt_zero/
│   ├── core/
│   ├── sensors/
│   ├── camera/
│   ├── mavlink/
│   └── api/
└── memory/
    └── PRD.md
```

## Completed Features

### Core System
- C++ runtime with 8 real-time threads (lock-free event processing)
- Sensor framework: IMU, Baro, GPS, Rangefinder, Optical Flow
- Camera pipeline with Visual Odometry (FAST + Lucas-Kanade)
- MAVLink v2/v1 bidirectional communication
- Visual Odometry → ArduPilot EKF3 as ExternalNav source
- 7-tab React dashboard with WebSocket telemetry

### 2026-03-14 Latest Session
- **P0 Fix: MAVLink data jitter** — Throttled frontend 10Hz→5Hz, React.memo on components
- **Documentation overhaul:**
  - SYSTEM.md: Algorithm explanation, performance characteristics (speed, altitude, range, accuracy)
  - DEPLOYMENT.md: Full install guide with offline method (ZIP/SCP/USB)
  - COMMANDS.md: Complete command reference (service, build, API, diagnostics, troubleshooting)
  - README.md: Beginner-friendly overview
  - create_archive.sh: Self-contained installer archive generator
  - ArduPilot pre-arm fix guidance (Rangefinder, Battery, VisOdom)

## Current Hardware Status
- **Camera:** PI_CSI (OV5647) — 15fps
- **MAVLink:** CONNECTED to Matek H743-SLIM V3, ArduCopter V4.3.6
- **EKF:** Accepting VO as ExternalNav source
- **VO Rate:** ~12 Hz

## Backlog

### P1
- Fix CRC for outgoing REQUEST_DATA_STREAM

### P2
- IP camera (RTSP/HTTP) and thermal camera support
- ARM NEON optimization for C++ core
- Autonomous mission planning (waypoint navigation UI)
- Direct I2C/SPI sensor drivers recompile on Pi

## Testing
- 77 backend tests passing (iteration 13)
- All 7 frontend tabs verified
- Test files: /app/backend/tests/test_jtzero_api.py
- Reports: /app/test_reports/iteration_13.json
