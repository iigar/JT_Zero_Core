# JT-Zero Runtime - PRD

## Original Problem Statement
JT-Zero robotics runtime for drone autonomy on Raspberry Pi Zero 2 W.
C++ core, Python bindings (pybind11), FastAPI backend, React dashboard.
Long-range flight capability: 5+ km RTL with VO+IMU only (no GPS, no compass).

## Architecture
```
/app
├── backend/
│   ├── server.py            # FastAPI + WebSocket (atomic snapshot)
│   ├── native_bridge.py     # C++ wrapper + VO field defaults
│   ├── simulator.py         # Python fallback with new VO fields
│   ├── diagnostics.py       # Hardware scanning
│   ├── system_metrics.py    # OS metrics via psutil
│   └── tests/test_jtzero_api.py  # 81 tests
├── frontend/src/
│   ├── App.js               # Throttled state (5Hz), sensorModes propagation
│   ├── components/
│   │   ├── CameraPanel.js     # 5 stats: DET/INL/CONF/DIST/ERR
│   │   ├── MAVLinkPanel.js    # React.memo, GCS heartbeat filtered
│   │   ├── SensorPanels.js    # React.memo + SourceBadge (HW/MAV/SIM)
│   │   ├── PerformancePanel.js # React.memo
│   │   ├── DiagnosticsPanel.js
│   │   ├── DocumentationTab.js # QuickStartSection (8 API checks)
│   │   └── SettingsTab.js
│   └── hooks/useApi.js
├── jt-zero/                 # C++ Core
│   ├── README.md
│   ├── DEPLOYMENT.md        # Online + offline install
│   ├── SYSTEM.md            # Architecture, VO algorithm
│   ├── COMMANDS.md          # Complete command reference
│   ├── FC_CONNECTION.md     # FC wiring
│   ├── LONG_RANGE_FLIGHT.md # 5km VO config + ArduPilot params
│   ├── create_archive.sh    # Installer archive generator
│   ├── camera/camera_pipeline.cpp  # Median+MAD, Kalman, IMU validation
│   ├── include/jt_zero/camera.h    # VOResult with confidence/uncertainty
│   ├── mavlink/mavlink_interface.cpp # Confidence covariance, HEARTBEAT filter
│   └── api/python_bindings.cpp      # New VO fields exposed
└── memory/PRD.md
```

## Completed (Latest Session 2026-03-14)

### Long-Range VO Improvements (5km target)
- **Median + MAD outlier rejection** — replaces simple mean, rejects 10-30% bad features
- **Kalman filter for velocity** — smooths noise, reduces random walk drift
- **IMU-aided cross-validation** — rejects VO frames inconsistent with IMU
- **Confidence-based covariance** — ArduPilot EKF knows when VO is unreliable
- **Position freeze** — stops updating when confidence < 15% (prevents wild drift)
- **Position uncertainty tracking** — estimates accumulated drift in meters
- **Total distance tracking** — tracks total path length

### Frontend Updates
- Camera/VO panel: 5 stats (DET/INL/CONF/DIST/ERR) with color coding
- Sensor badges (HW/MAV/SIM) on IMU, Barometer, GPS panels
- GPS conditional display (Simulated/No Fix/Real)
- Quick Start interactive checklist in Docs tab (8 API checks)

### Bug Fixes
- MAVLink "Unknown" FC values — HEARTBEAT filter ignores GCS
- GPS "enabled" when simulated — source badges
- Frontend jitter — throttled 10Hz→5Hz + React.memo
- Stream requests retry (3× with 5s interval) + SET_MESSAGE_INTERVAL

### Documentation
- LONG_RANGE_FLIGHT.md — ArduPilot params for 5km VO-only flight
- SYSTEM.md, DEPLOYMENT.md, COMMANDS.md — comprehensive overhaul
- create_archive.sh — offline installer

## Current Status
- 81 backend tests pass
- All 7 frontend tabs working
- C++ changes need recompile on Pi

## Backlog (P2)
- IP camera (RTSP) and thermal camera
- ARM NEON optimization for C++ core
- Autonomous mission planning (waypoint navigation UI)

## Testing
- Latest: /app/test_reports/iteration_14.json (81 tests, 100%)
- Tests: /app/backend/tests/test_jtzero_api.py
