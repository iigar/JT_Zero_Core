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
- USB Capture Card: MacroSilicon MS210x (AV TO USB2.0) — MJPEG only, YUYV returns zeros
- Analog FPV camera (direct to VTX, not processed by Pi)

## Architecture
```
/app
├── .github/workflows/     # CI/CD
│   └── build-frontend.yml # Auto-build frontend on push
├── backend/               # FastAPI server, simulator, native bridge
│   ├── server.py          # FastAPI + WebSocket, frame caching
│   ├── native_bridge.py   # C++ bridge + multi-camera init
│   ├── simulator.py       # Python simulator
│   ├── usb_camera.py      # V4L2 subprocess wrapper (MJPEG batch capture)
│   └── static/            # Pre-built React frontend (served by FastAPI)
├── frontend/              # React dashboard (Tailwind CSS)
│   └── src/components/
│       ├── CameraPanel.js     # Primary VO camera
│       ├── ThermalPanel.js    # Secondary thermal camera (live MJPEG)
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

## Key Technical Details

### USB Thermal Camera (MS210x Capture Card)
- **Detection**: `v4l2-ctl --list-devices` (Python ioctl fails on aarch64)
- **Format**: MJPEG only (YUYV returns all-zero data on this hardware)
- **Capture**: Batch mode (`v4l2-ctl --stream-count=2`) — each call reopens device
- **Why batch, not persistent**: MS210x repeats same frame when device stays open. Reopening forces fresh analog capture.
- **Resolution**: 640x480 (card supports 480x320, 640x480, 720x480)
- **Frame caching bug (FIXED)**: `get_secondary_frame_data()` must update `frame_count` in camera state dict, otherwise server cache never invalidates
- **FPS**: ~5fps with batch capture (0.2s per grab)

### Pre-built Frontend
- Pi Zero 2W lacks RAM to compile React
- Frontend built with `REACT_APP_BACKEND_URL=''` (empty!) so Pi connects to itself
- Committed to `backend/static/` in git
- **CRITICAL**: Never build with Emergent Preview URL — causes Pi to connect to wrong server

### Dual Camera VO Strategy
- **Current**: CSI for VO (high-res visual features), USB thermal for situational awareness
- **Planned**: VO Fallback — switch to USB thermal when CSI confidence drops
- **Future**: Sensor fusion — use both simultaneously with confidence weighting

## Deployment Strategy
- **Frontend build**: GitHub Actions auto-builds on push, commits `backend/static/` to git
- **Pi update**: `git pull && ./update.sh` — no Node.js needed on Pi
- **Fallback**: Local npm build with swap (for Pi 4+ only)

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
- Multi-Camera Architecture (CSI + USB Thermal)
- USB Thermal Camera live streaming (MJPEG batch capture, ~5fps)
- ThermalPanel with live JPEG rendering (CameraPanel pattern)
- CSI Priority + USB Fallback with 8 CSI sensor auto-detection + GENERIC fallback
- GitHub Actions CI/CD for frontend builds
- Pre-built frontend in git (no Node.js on Pi)
- IMX290 STARVIS added to known CSI sensors

### API Endpoints
- `GET /api/cameras` — List all camera slots (PRIMARY, SECONDARY)
- `GET /api/camera` — Primary (VO) camera stats
- `GET /api/camera/frame` — Primary camera frame (PNG)
- `GET /api/camera/secondary/stats` — Thermal camera stats
- `POST /api/camera/secondary/capture` — Trigger on-demand thermal capture
- `GET /api/camera/secondary/frame` — Thermal camera frame (JPEG or PNG)

## Backlog

### P1 - Next
- VO Fallback to USB thermal camera when CSI loses tracking
- Thermal camera FPS optimization (target: 10-15fps)

### P2 - Planned
- IP camera (RTSP) support
- ARM NEON optimization for C++ core
- Autonomous Mission Planning UI
- Focal length calibration for USB thermal cameras

### P3 - Future
- MAVLink diagnostics page in React Dashboard
- Sensor fusion (dual-camera VO simultaneously)
- CSI camera testing with new Sobel/bilinear improvements
