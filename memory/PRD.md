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
- Cameras: Pi CSI Camera Module v2/v3 (Forward VO), USB thermal cameras Caddx 256x192 (Downward thermal)
- Analog FPV camera (direct to VTX, not processed by Pi)

## Architecture
```
/app
├── backend/           # FastAPI server, simulator, native bridge
├── frontend/          # React dashboard (Tailwind CSS)
│   └── src/components/
│       ├── CameraPanel.js     # Primary VO camera
│       ├── ThermalPanel.js    # Secondary thermal camera (NEW)
│       └── ...
├── jt-zero/           # C++ core
│   ├── core/          # runtime.cpp
│   ├── camera/        # camera_pipeline.cpp, camera_drivers.cpp
│   ├── mavlink/       # mavlink_interface.cpp
│   ├── api/           # python_bindings.cpp
│   └── include/       # Header files (camera.h with multi-cam)
└── memory/            # PRD, changelog, roadmap
```

## Implementation Status

### Completed
- C++ Runtime core (event loop, thread management, sensor fusion)
- Visual Odometry: FAST + Shi-Tomasi detection, LK tracking with bilinear interpolation, Sobel gradients
- Kalman filter velocity smoothing + IMU cross-validation
- Confidence-based covariance reporting to ArduPilot EKF
- MAVLink interface (ODOMETRY messages)
- FastAPI backend with REST + WebSocket telemetry
- React dashboard (7 tabs)
- Python simulator, documentation, offline installation

### Completed - Feb/Mar 2026
- **USB Camera V4L2 MMAP Fix (P0)**: Rewrote USB camera driver for proper V4L2 MMAP streaming
- **Platform/VO Mode Refactor**: Separated Platform (hardware) from VO Mode (algorithmic)
- **LK Tracker Bilinear Interpolation (CRITICAL)**: Fixed fundamental bug — LK was using integer pixel access, preventing sub-pixel convergence
- **Sobel 3x3 Gradients**: Replaced simple central differences with Sobel operator in LK tracker and Shi-Tomasi detector — 4x signal amplification, 16x better conditioning
- **Shi-Tomasi Grid Corner Detector**: Fallback when FAST fails on low-contrast images — computes structure tensor eigenvalues to find actual corners (not edges)
- **Convergence Tolerance**: Relaxed from 0.01 to 0.05 px for thermal images
- **Verified on Pi 4 + Caddx thermal**: Det:180, Track:16-59, Inliers:100%, Valid:True, Conf:0.18-0.29
- **MAVLink Parser Overhaul (P0)**: CRC validation, relaxed heartbeat filter, default 921600 baud, v2 signing support, diagnostic counters (bytes/heartbeats/CRC errors), raw hex dump
- **MAVLink Heartbeat Parsing (P0)**: RESOLVED — auto-baud detection (CRC-validated), relaxed heartbeat filter, verified on Pi Zero 2W + Matek H743
- **EKF3 ExternalNav Integration**: ArduPilot EKF3 using JT-Zero VO data (confirmed: "EKF3 IMU0/1 is using external nav data")
- **Automation Scripts**: setup.sh (first install), update.sh (quick update with Pi model auto-detection)
- **UI Refresh**: Rounded corners (12px), ~1.5x larger fonts, lighter colors, expanded MAVLink panel, Events scroll-lock

### Completed - Mar 23, 2026
- **Multi-Camera Architecture (P1)**: Full CSI + USB thermal dual camera support
  - C++ layer: CameraSlot enum, CameraSlotInfo struct, multi-camera methods in CameraPipeline
  - Backend: GET /api/cameras (list slots), GET/POST /api/camera/secondary/* (stats, capture, frame)
  - WebSocket: cameras array in telemetry payload
  - Frontend: Camera tab with SPLIT/VO ONLY/THERMAL view switcher
  - ThermalPanel.js: On-demand capture, auto-refresh (1fps), iron palette false-color rendering
  - Dashboard sidebar: CAMERAS section showing both camera slots
  - All 24 tests pass (backend + frontend)

## Multi-Camera Configuration
| Camera | Interface | Role | Stream | Pi Load |
|--------|-----------|------|--------|---------|
| CSI (Forward) | CSI → GPU/ISP | Visual Odometry | Always (15fps) | Low (GPU ISP) |
| USB Thermal (Down) | USB 2.0 V4L2 | Thermal scanning | On-demand | Low (256x192) |
| Analog FPV | Analog VTX | Pilot view | N/A (bypasses Pi) | None |

### API Endpoints
- `GET /api/cameras` — List all camera slots (PRIMARY, SECONDARY)
- `GET /api/camera` — Primary (VO) camera stats
- `GET /api/camera/frame` — Primary camera frame (PNG)
- `GET /api/camera/secondary/stats` — Thermal camera stats
- `POST /api/camera/secondary/capture` — Trigger on-demand thermal capture
- `GET /api/camera/secondary/frame` — Thermal camera frame (PNG, false-color in frontend)

## Backlog

### P2 - Future
- IP camera (RTSP) support
- ARM NEON optimization for C++ core
- Autonomous Mission Planning UI
- Focal length calibration for USB thermal cameras
- CSI camera testing with new Sobel/bilinear improvements
- MAVLink diagnostics page in React Dashboard
