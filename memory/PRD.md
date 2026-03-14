# JT-Zero Runtime - PRD

## Original Problem Statement
JT-Zero robotics runtime for drone autonomy on Raspberry Pi Zero 2 W.
C++ core, Python bindings (pybind11), FastAPI backend, React dashboard.

## Architecture
```
/app
├── backend/
│   ├── server.py            # FastAPI + WebSocket (atomic snapshot) + camera
│   ├── native_bridge.py     # C++ wrapper
│   ├── simulator.py         # Python fallback for non-Pi
│   ├── diagnostics.py       # Hardware scanning
│   ├── system_metrics.py    # OS metrics via psutil
│   └── tests/test_jtzero_api.py  # 77 tests
├── frontend/src/
│   ├── App.js               # Throttled state (5Hz), sensorModes propagation
│   ├── components/
│   │   ├── CameraPanel.js
│   │   ├── MAVLinkPanel.js     # React.memo
│   │   ├── SensorPanels.js     # React.memo + SourceBadge (HW/MAV/SIM)
│   │   ├── PerformancePanel.js  # React.memo
│   │   ├── DiagnosticsPanel.js
│   │   ├── TelemetryCharts.js
│   │   ├── DocumentationTab.js  # QuickStartSection (API health checks)
│   │   └── SettingsTab.js
│   └── hooks/useApi.js
├── jt-zero/                 # C++ Core
│   ├── README.md            # Beginner-friendly overview
│   ├── DEPLOYMENT.md        # Full install (online + offline ZIP/USB)
│   ├── SYSTEM.md            # Architecture, VO algorithm, characteristics
│   ├── COMMANDS.md          # Complete command reference
│   ├── FC_CONNECTION.md     # Flight controller wiring
│   ├── create_archive.sh    # Installer archive generator
│   ├── include/jt_zero/
│   │   └── mavlink_interface.h  # Added stream retry fields
│   ├── mavlink/
│   │   └── mavlink_interface.cpp  # HEARTBEAT filter + SET_MESSAGE_INTERVAL + retry
│   └── api/
│       └── python_bindings.cpp  # Expanded MAV_TYPE mapping
└── memory/PRD.md
```

## Completed Features (Latest Session - 2026-03-14)

### Bug Fixes
- **P0: MAVLink data jitter** — Throttled frontend 10Hz→5Hz, React.memo on components
- **MAVLink "Unknown" FC values** — C++ HEARTBEAT filter skips GCS (MAV_TYPE=6,0,27,18)
- **GPS showing "enabled" when simulated** — Added sensor source badges (HW/MAV/SIM)
- **sensorModes prop not passed** — Fixed DashboardTab + TelemetryTab

### New Features
- **Quick Start interactive checklist** in Docs tab (8 API-based health checks)
- **Sensor source badges** on IMU, Barometer, GPS panels
- **GPS conditional display** — shows "Simulated Data" or "No GPS Fix" when appropriate

### P1: Stream Request Fix
- **HEARTBEAT filter** — ignores GCS/generic heartbeats, only accepts vehicle types
- **Expanded MAV_TYPE mapping** — 15+ vehicle types instead of 4
- **REQUEST_DATA_STREAM retry** — 3 attempts with 5-second intervals
- **SET_MESSAGE_INTERVAL** — modern COMMAND_LONG method alongside legacy streams

### Documentation Overhaul
- **SYSTEM.md** — Full algorithm explanation, performance characteristics
- **DEPLOYMENT.md** — Online + offline installation (ZIP/SCP/USB)
- **COMMANDS.md** — Complete command reference with troubleshooting
- **create_archive.sh** — Self-contained installer generator

## Current Status
- All 77 backend tests pass
- All 7 frontend tabs working
- Quick Start: 8/8 checks pass on preview
- C++ changes need recompile on Pi

## Backlog

### P2
- IP camera (RTSP/HTTP) and thermal camera
- ARM NEON optimization for C++ core
- Autonomous mission planning (waypoint navigation UI)

## Testing
- Reports: /app/test_reports/iteration_13.json
- Tests: /app/backend/tests/test_jtzero_api.py (77 tests)
