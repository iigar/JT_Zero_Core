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

## Architecture
```
/app
├── backend/           # FastAPI server, simulator, native bridge
├── frontend/          # React dashboard (Tailwind CSS)
├── jt-zero/           # C++ core
│   ├── core/          # runtime.cpp
│   ├── camera/        # camera_pipeline.cpp, camera_drivers.cpp
│   ├── mavlink/       # mavlink_interface.cpp
│   ├── api/           # python_bindings.cpp
│   └── include/       # Header files
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
- React dashboard (6 tabs)
- Python simulator, documentation, offline installation

### Completed - Feb/Mar 2026
- **USB Camera V4L2 MMAP Fix (P0)**: Rewrote USB camera driver for proper V4L2 MMAP streaming
- **Platform/VO Mode Refactor**: Separated Platform (hardware) from VO Mode (algorithmic)
- **LK Tracker Bilinear Interpolation (CRITICAL)**: Fixed fundamental bug — LK was using integer pixel access, preventing sub-pixel convergence
- **Sobel 3x3 Gradients**: Replaced simple central differences with Sobel operator in LK tracker and Shi-Tomasi detector — 4x signal amplification, 16x better conditioning
- **Shi-Tomasi Grid Corner Detector**: Fallback when FAST fails on low-contrast images — computes structure tensor eigenvalues to find actual corners (not edges)
- **Convergence Tolerance**: Relaxed from 0.01 to 0.05 px for thermal images
- **Verified on Pi 4 + Caddx thermal**: Det:180, Track:16-59, Inliers:100%, Valid:True, Conf:0.18-0.29

## Backlog

### P2 - Future
- IP camera (RTSP) support
- ARM NEON optimization for C++ core
- Autonomous Mission Planning UI
- Focal length calibration for USB thermal cameras
- CSI camera testing with new Sobel/bilinear improvements
