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
├── .github/workflows/     # CI/CD
│   └── build-frontend.yml # Auto-build frontend on push
├── backend/               # FastAPI server, simulator, native bridge
│   └── static/            # Pre-built React frontend (served by FastAPI)
├── frontend/              # React dashboard (Tailwind CSS)
│   └── src/components/
│       ├── CameraPanel.js     # Primary VO camera
│       ├── ThermalPanel.js    # Secondary thermal camera
│       └── ...
├── jt-zero/               # C++ core
│   ├── core/              # runtime.cpp
│   ├── camera/            # camera_pipeline.cpp, camera_drivers.cpp
│   ├── mavlink/           # mavlink_interface.cpp
│   ├── api/               # python_bindings.cpp
│   └── include/           # Header files (camera.h with multi-cam)
├── update.sh              # Smart update script (pre-built priority)
└── memory/                # PRD, changelog, roadmap
```

## Deployment Strategy
- **Frontend build**: GitHub Actions auto-builds on push, commits `backend/static/` to git
- **Pi update**: `git pull && ./update.sh` — no Node.js needed on Pi
- **Fallback**: Local npm build with swap (for Pi 4+ only)
- **update.sh logic**: pre-built (git) > local build (npm) > error with instructions

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
- Multi-Camera Architecture (CSI + USB Thermal) — Variant B
- ThermalPanel with Iron palette false-color
- CSI Priority + USB Fallback with 7 CSI sensor auto-detection
- GitHub Actions CI/CD for frontend builds
- Pre-built frontend in git (no Node.js on Pi)

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
