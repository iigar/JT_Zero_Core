# JT-Zero Runtime - PRD

## Original Problem Statement
Design and implement a robotics runtime called JT-Zero for lightweight drone autonomy on Raspberry Pi Zero 2 W. Multi-phase implementation: architecture, repository structure, core runtime, sensor modules, camera pipeline, MAVLink interface, Python bindings, FastAPI server, React dashboard, performance optimization.

## Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                     JT-Zero Runtime                         │
│  T0: Supervisor (10Hz)    T5: MAVLink (50Hz)                │
│  T1: Sensors (200Hz)      T6: Camera (15FPS)                │
│  T2: Events (200Hz)       T7: API Bridge                    │
│  T3: Reflex (200Hz)                                         │
│  T4: Rules (20Hz)                                           │
│                                                             │
│  Lock-free SPSC Ring Buffers │ Fixed Memory Pools           │
│  FAST Corner Detection       │ Lucas-Kanade Optical Flow    │
│  MAVLink v2: VISION_POS, ODOMETRY, OPT_FLOW_RAD            │
│                                                             │
│  Python Simulator → FastAPI → WebSocket → React Dashboard   │
└─────────────────────────────────────────────────────────────┘
```

## User Personas
- Embedded Systems Engineers developing drone firmware
- Robotics Developers prototyping autonomous behavior
- Drone Operators monitoring flight telemetry

## Core Requirements (Static)
1. C++17 runtime with lock-free data structures
2. Multi-threaded architecture (8 threads) for real-time processing
3. Sensor pipeline: IMU (200Hz), Barometer (50Hz), GPS (10Hz), Rangefinder (50Hz), Optical Flow (50Hz)
4. Camera pipeline: FAST corner detection + Lucas-Kanade optical flow + Visual Odometry
5. MAVLink interface: VISION_POSITION_ESTIMATE, ODOMETRY, OPTICAL_FLOW_RAD
6. Event-driven architecture with reflex (<5ms) and rule engines
7. Web dashboard for monitoring and control
8. REST API + WebSocket for real-time telemetry at 10Hz

## What's Been Implemented

### Phase 1-3 (2026-03-07): Architecture + Core Runtime
- [x] Complete C++ project with CMake build system
- [x] Lock-free SPSC ring buffer (1024 events, power-of-2 capacity)
- [x] Fixed-size memory pool for realtime allocation
- [x] Event/Reflex/Rule/Memory/Output engines
- [x] Multi-threaded runtime (5 core threads: T0-T4)
- [x] Default reflexes: emergency stop, low battery, altitude limit
- [x] Default rules: auto-RTL, GPS-lost hold, takeoff complete

### Phase 4 (2026-03-07): Sensor Modules
- [x] IMU sensor (gyro_xyz, acc_xyz) @ 200Hz
- [x] Barometer (pressure, altitude, temperature) @ 50Hz
- [x] GPS (lat, lon, alt, speed, satellites, fix_type) @ 10Hz
- [x] Rangefinder (distance, signal_quality) @ 50Hz
- [x] Optical Flow (flow_xy, quality, ground_distance) @ 50Hz

### Phase 5 (2026-03-07): Camera Pipeline
- [x] Camera source abstraction (Pi CSI, USB, IP, Simulated)
- [x] Simulated camera with moving test patterns + noise
- [x] FAST-9 corner detector (simplified for embedded)
- [x] Lucas-Kanade sparse optical flow tracker (iterative 2x2 system)
- [x] Visual Odometry estimator (feature detect → track → estimate)
- [x] Camera Pipeline orchestrator (capture + VO per tick)
- [x] T6 Camera thread running at 15 FPS
- [x] Camera stats API + dashboard panel with feature map visualization

### Phase 6 (2026-03-07): MAVLink Interface
- [x] MAVLink message types: VISION_POSITION_ESTIMATE, ODOMETRY, OPTICAL_FLOW_RAD
- [x] Connection state machine (DISCONNECTED → CONNECTING → CONNECTED → LOST)
- [x] Message builders from runtime state + VO results
- [x] Heartbeat exchange + connection monitoring (3s timeout)
- [x] T5 MAVLink thread running at 50 Hz
- [x] Simulated FC info (ArduPilot 4.5.0, QUADROTOR)
- [x] MAVLink stats API + dashboard panel with message counters

### Phase 8-9 (2026-03-07): FastAPI + React Dashboard
- [x] REST: /health, /state, /events, /telemetry, /threads, /engines, /camera, /mavlink, /command
- [x] WebSocket: /ws/telemetry (10Hz with camera+mavlink), /ws/events
- [x] Command interface: arm, disarm, takeoff, land, hold, rtl, emergency
- [x] Dashboard: Header, Sidebar, Drone Telemetry (attitude indicator, compass), Sensor Panels, Camera/VO panel, MAVLink panel, Event Log, Command Panel, Telemetry Charts, Runtime Info

## Testing Status
- Iteration 1: Backend 100%, Frontend 95%, WebSocket 100%
- Iteration 2: Backend 95%, Frontend 100%, Camera 100%, MAVLink 100%, WebSocket 100%

## Prioritized Backlog

### P0 - Done
- Core C++ runtime ✓
- Sensor modules ✓
- Camera pipeline ✓
- MAVLink interface ✓
- FastAPI server ✓
- React dashboard ✓

### P1 - Next Phase
- Phase 7: Python bindings via pybind11 (bridge compiled C++ to Python)
- Phase 10: Performance optimization (CPU/RAM profiling, memory pooling audit)

### P2 - Future
- Cross-compilation toolchain for Pi Zero 2 W
- Real sensor I2C/SPI driver implementations (MPU6050, BMP280, NMEA GPS)
- Real camera drivers (libcamera for Pi CSI, V4L2 for USB)
- Real MAVLink serial/UDP connection (mavlink C library)
- Flight path recording and replay
- Geofencing support
- Autonomous mission planning (waypoint navigation)
- 3D drone visualization in dashboard
