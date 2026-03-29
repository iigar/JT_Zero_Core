# JT-Zero Runtime — Product Requirements Document

## Problem Statement
Building a complex robotics runtime "JT-Zero" for drone autonomy on Raspberry Pi (Zero 2 W and Pi 4). The system features a high-performance C++ core for Visual Odometry (VO), a FastAPI backend, and a React monitoring dashboard. The drone needs to maintain position using visual features from a CSI camera, with automatic fallback to a USB thermal camera in darkness/fog.

## Architecture
- **C++ Core**: Multi-threaded (8 threads), lock-free SPSC ring buffers, FAST corner detection + Lucas-Kanade optical flow
- **Python Backend**: FastAPI with WebSocket telemetry at 10Hz, native bridge via pybind11
- **React Frontend**: Pre-built to `backend/static/` (no Node.js on Pi), served by FastAPI
- **Hardware**: Raspberry Pi Zero 2W / Pi 4, Pi Camera v2 (CSI), USB thermal camera (Caddx via MS210x capture card)

## Key Technical Decisions
- **Brightness-only fallback trigger**: FAST detector tracks sensor noise in darkness → confidence unreliable. Rolling average brightness < 20 is the reliable trigger
- **Hybrid VO Fallback**: Python reads MJPEG from USB → decodes → injects into C++ pipeline (because C++ USBCamera YUYV returns zeros on MS210x hardware)
- **Pre-built frontend**: REACT_APP_BACKEND_URL="" for Pi builds (relative URLs), preview URL for Emergent testing
- **One camera at a time**: USB bus shared with WiFi, simultaneous VO overloads Pi Zero 2W CPU
- **RAII Spinlock**: `ScopedSpinLock` struct for thread-safe `fc_telem_` access (MAVLink write thread + Sensor read thread)

## What's Been Implemented
- Full VO pipeline (FAST/Shi-Tomasi + LK + Kalman filter)
- 8 CSI sensor profiles + GENERIC fallback
- Adaptive altitude zones (LOW/MEDIUM/HIGH/CRUISE)
- Hover yaw correction
- VO mode profiles (Light/Balanced/Performance)
- MAVLink v2 integration (VISION_POSITION_ESTIMATE at 25Hz)
- EKF3 ExternalNav integration with ArduPilot
- Multi-camera architecture (CSI PRIMARY + USB SECONDARY)
- USB thermal camera live streaming (MJPEG batch capture ~5fps)
- VO Fallback: brightness-only trigger, hybrid Python/C++ injection, periodic CSI probe recovery
- ThermalPanel feature overlay (dual-trigger rendering, PTS debug counter)
- Dashboard VO source indicators (sidebar badge, alert, stats bars)
- GitHub Actions CI/CD for frontend builds
- SET HOMEPOINT: VO reset via Commands panel, RC channel, API
- 3D Trail visualization in Dashboard
- ARM NEON SIMD acceleration (frame brightness, Sobel, Shi-Tomasi, SAD)
- MAVLink Diagnostics Panel (RC Channels, FC Telemetry, Messages)
- MAVLink STATUSTEXT broadcasting for critical events
- Encrypted Flight Logger (AES-256 Fernet, point cloud recording)
- Thread-safe MAVLink telemetry via RAII ScopedSpinLock (Bug Fix #24)
- Confidence-based covariance reporting to ArduPilot EKF
- Python simulator with simulated features for dev/preview testing
- Comprehensive documentation (CLAUDE.md, PRD.md, CHANGELOG.md)

### API Endpoints
- `GET /api/cameras` — List all camera slots (PRIMARY, SECONDARY)
- `GET /api/camera` — Primary (VO) camera stats
- `GET /api/camera/frame` — Primary camera frame (PNG)
- `GET /api/camera/features` — Current VO feature positions
- `GET /api/camera/secondary/stats` — Thermal camera stats
- `POST /api/camera/secondary/capture` — Trigger on-demand thermal capture
- `GET /api/camera/secondary/frame` — Thermal camera frame (JPEG or PNG)
- `GET /api/mavlink` — MAVLink stats + RC channels + FC telemetry
- `GET /api/vo/trail` — VO position trail for 3D visualization
- `GET /api/logs/status` — Flight log status
- `POST /api/logs/start` / `POST /api/logs/stop` — Flight log recording
- `WS /api/ws/telemetry` — WebSocket streaming (10Hz)

## Backlog

### P1 - Next
- Deploy to Pi: `git pull && ./update.sh` — all features: Flight Log, STATUSTEXT, NEON, MAVLink Diag, Thread Safety fix
- Set flight log password via Dashboard → start recording → fly → stop → download & analyze
- Test STATUSTEXT visibility in Mission Planner during fallback events
- Verify YAW glitch is resolved with real FC (thread-safety fix #24)

### P2 - Planned
- C++ native MJPEG support for USBCamera
- IP camera (RTSP) support
- Autonomous Mission Planning UI
- Focal length calibration for USB thermal cameras

### P3 - Future
- Sensor fusion (dual-camera VO simultaneously)
- CSI camera testing with Sobel/bilinear improvements
- 3D flight replay from encrypted logs
