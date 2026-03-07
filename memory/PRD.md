# JT-Zero Runtime - PRD

## Original Problem Statement
Design and implement a robotics runtime called JT-Zero for lightweight drone autonomy on Raspberry Pi Zero 2 W. The system must include Event/Reflex/Rule/Memory/Output engines, multi-threaded architecture (8 threads), sensor pipeline (IMU, Barometer, GPS, Rangefinder, Optical Flow), camera pipeline, MAVLink support, Python bindings, FastAPI server, and React dashboard.

## Architecture
- **C++ Core**: Lock-free SPSC ring buffers, fixed memory pools, zero dynamic allocation in realtime paths
- **Thread Model**: T0-T7 (Supervisor 10Hz, Sensors 200Hz, Events 200Hz, Reflex 200Hz, Rules 20Hz, MAVLink 50Hz, Camera 15FPS, API Bridge)
- **Python Simulator**: Mirrors C++ runtime behavior for web dashboard
- **FastAPI Backend**: REST endpoints + WebSocket telemetry streaming at 10Hz
- **React Dashboard**: Ground Station with 7 panels (System, Sensors, Drone Telemetry, Charts, Event Log, Commands, Runtime Info)

## User Personas
- Embedded Systems Engineers developing drone firmware
- Robotics Developers prototyping autonomous behavior
- Drone Operators monitoring flight telemetry

## Core Requirements (Static)
1. C++17 runtime with lock-free data structures
2. Multi-threaded architecture for real-time processing
3. Sensor pipeline: IMU, Barometer, GPS, Rangefinder, Optical Flow
4. Event-driven architecture with reflex (<5ms) and rule engines
5. Web dashboard for monitoring and control
6. REST API + WebSocket for real-time telemetry

## What's Been Implemented (2026-03-07)
### Phase 1-3: Architecture + Core Runtime
- [x] Complete C++ project with CMake build system
- [x] Lock-free SPSC ring buffer (1024 events, power-of-2 capacity)
- [x] Fixed-size memory pool for realtime allocation
- [x] Event Engine with priority dispatch
- [x] Reflex Engine with condition/action pairs and cooldown
- [x] Rule Engine with priority-based evaluation
- [x] Memory Engine (2048 telemetry + 512 event records)
- [x] Output Engine with pluggable handlers
- [x] Multi-threaded runtime (5 active threads: T0-T4)
- [x] Default reflexes: emergency stop, low battery, altitude limit
- [x] Default rules: auto-RTL, GPS-lost hold, takeoff complete
- [x] Compiled binary: /app/jt-zero/build/jt-zero (runs on aarch64)

### Phase 4: Sensor Modules
- [x] IMU sensor (gyro_xyz, acc_xyz) @ 200Hz
- [x] Barometer (pressure, altitude, temperature) @ 50Hz
- [x] GPS (lat, lon, alt, speed, satellites, fix_type) @ 10Hz
- [x] Rangefinder (distance, signal_quality) @ 50Hz
- [x] Optical Flow (flow_xy, quality, ground_distance) @ 50Hz
- [x] Simulated implementations for all sensors

### Phase 8: FastAPI Server
- [x] REST endpoints: /health, /state, /events, /telemetry, /threads, /engines, /command
- [x] WebSocket: /ws/telemetry (10Hz stream), /ws/events
- [x] Python simulator (simulator.py) mirroring C++ runtime
- [x] Command interface: arm, disarm, takeoff, land, hold, rtl, emergency

### Phase 9: React Dashboard
- [x] Dark engineering theme (Orbital Command aesthetic)
- [x] Header with flight mode, connection status, battery, CPU temp
- [x] Sidebar with system stats, sensor health, thread status, engine stats
- [x] Drone Telemetry: attitude indicator, compass, altitude/speed data
- [x] Sensor Panels: IMU, Barometer, GPS, Rangefinder, Optical Flow
- [x] Event Log with color-coded real-time events
- [x] Command Panel with 7 command buttons
- [x] Telemetry Charts (attitude, gyro, battery/CPU)
- [x] Runtime info panel
- [x] JetBrains Mono font, scanline overlay, corner brackets

## Testing Status
- Backend: 100% (all endpoints verified)
- Frontend: 95% (minor chart dimension warning)
- WebSocket: 100% (10Hz streaming verified)
- Integration: 100% (commands work end-to-end)

## Prioritized Backlog

### P0 - Done
- Core C++ runtime ✓
- Sensor modules ✓
- FastAPI server ✓
- React dashboard ✓

### P1 - Next Phase
- Phase 5: Camera pipeline (Pi camera, USB camera, IP camera support)
- Phase 6: MAVLink interface (VISION_POSITION_ESTIMATE, ODOMETRY, OPTICAL_FLOW_RAD)
- Phase 7: Python bindings via pybind11

### P2 - Future
- Phase 10: Performance optimization
- Visual Odometry (FAST corner detection, Lucas-Kanade optical flow)
- Cross-compilation toolchain for Pi Zero 2 W
- Real sensor I2C/SPI driver implementations
- Flight path recording and replay
- Geofencing support
- Autonomous mission planning
