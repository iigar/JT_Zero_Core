# JT-Zero Runtime - Product Requirements Document

## Original Problem Statement
Build a complex robotics runtime "JT-Zero" for a drone on Raspberry Pi with:
- High-performance C++ core for event processing and real-time control
- Python bindings via pybind11
- FastAPI backend + React monitoring dashboard
- Camera integration (CSI + USB/thermal) with Visual Odometry
- MAVLink flight controller integration
- Visual Odometry as navigation source for ArduPilot EKF

## Target Hardware
- Primary: Raspberry Pi Zero 2 W (ARM Cortex-A53, 512MB RAM)
- Extended: Raspberry Pi 4 (4GB), Raspberry Pi 5
- Cameras: Pi CSI Camera Module v2/v3, USB thermal cameras (Caddx 256)

## Core Requirements
1. Stable C++ core for event processing and real-time control
2. FastAPI backend + React frontend monitoring dashboard
3. CSI camera + USB camera + MAVLink flight controller integration
4. Robust Visual Odometry: 5km flight with <300m RTL error (no GPS, no compass)
5. VO resilient to drift during long hover periods (up to 20 minutes)
6. Adaptive configurations for different hardware (Pi Zero/4/5) and flight envelopes
7. Comprehensive deployment guide with offline installation
8. Detailed system documentation and intuitive UI

## Architecture
```
/app
├── backend/           # FastAPI server, simulator, native bridge
├── frontend/          # React dashboard (Tailwind CSS)
├── jt-zero/           # C++ core (camera, VO, MAVLink, runtime)
│   ├── core/          # runtime.cpp, visual_odometry logic
│   ├── camera/        # camera_pipeline.cpp, camera_drivers.cpp
│   ├── mavlink/       # mavlink_interface.cpp
│   ├── api/           # python_bindings.cpp
│   └── include/       # Header files
└── memory/            # PRD, changelog, roadmap
```

## Implementation Status

### Completed (100%)
- C++ Runtime core (event loop, thread management, sensor fusion)
- Visual Odometry: FAST detection, LK tracking, median filter, MAD outlier rejection
- Kalman filter velocity smoothing + IMU cross-validation
- Confidence-based covariance reporting to ArduPilot EKF
- MAVLink interface (SET_MESSAGE_INTERVAL, ODOMETRY messages)
- FastAPI backend with REST + WebSocket telemetry
- React dashboard (6 tabs: Dashboard, Telemetry, Camera/VO, MAVLink, Events, Settings)
- Python simulator for development without hardware
- Quick Start checklist for system health verification
- Comprehensive documentation (DEPLOY, SYSTEM, COMMANDS, LONG_RANGE_FLIGHT)
- Offline installation archive (create_archive.sh)
- Frontend performance optimization (useReducer, throttle, React.memo)

### Completed - March 2026
- **Hardware Profiles**: 3 profiles (Pi Zero 2W/Pi 4/Pi 5) with different resolutions and VO parameters
- **Altitude-Adaptive Parameters**: FAST threshold, LK window, Kalman Q/R auto-adjust based on barometric altitude (4 zones: LOW/MEDIUM/HIGH/CRUISE)
- **Hover Yaw Correction**: Detects hovering, estimates gyroscopic yaw drift, applies EMA-smoothed correction
- **Profile Management UI**: Settings tab with clickable profile cards and Adaptive VO Status panel
- **Camera Panel Enhanced**: Profile badge, zone badge, HOVER badge, 2-row stats (FAST/LK/ZONE/DRIFT/YAW)
- **New API Endpoints**: GET /api/vo/profiles, POST /api/vo/profile/{id}
- **Platform/VO Mode Refactor**: Separated "Platform" (auto-detected, sets resolution) from "VO Mode" (user-selectable, adjusts algorithm parameters)

### Completed - Feb 2026
- **USB Camera V4L2 MMAP Fix (P0)**: Rewrote USB camera driver to use proper V4L2 MMAP streaming instead of simple read(). Fixed Caddx thermal camera on Pi 4 (480x320 YUYV @ 25fps). Verified working with 395+ frames captured at 15fps.

## Backlog

### P2 - Future
- IP camera (RTSP) and further thermal camera support
- ARM NEON optimization for C++ core
- Autonomous Mission Planning UI/features
- Focal length calibration for USB thermal cameras (current Pi 4 focal assumes CSI camera)

## Testing
- Backend: /app/backend/tests/test_jtzero_api.py, /app/backend/tests/test_vo_features.py
- Test reports: /app/test_reports/iteration_15.json (24/24 tests pass)
- USB camera fix verified on Pi 4 hardware with Caddx thermal 256
