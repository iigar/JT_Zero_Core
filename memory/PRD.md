# JT-Zero Runtime - PRD

## Original Problem Statement
JT-Zero robotics runtime for drone autonomy on Raspberry Pi Zero 2 W.
C++ core, Python bindings (pybind11), FastAPI backend, React dashboard.

## Completed
- Phase 1-11: Full runtime, sensors, camera, MAVLink, dashboard
- Bug fixes: VO displacement, MemoryPool race, MAVLink semantics, roll atan2
- UI overhaul: 7-tab interface, detailed 3D drone, gray-green background
- P1: Sensor auto-detect (I2C/UART probing, HW/SIM badges)
- P2: Camera drivers (PiCSI V4L2, USB V4L2), MAVLink Serial/UDP
- **Layout fix (2026-03-12):** Fixed panel overflow (fixed heights 240/220/150px + overflow-hidden)
- **Event dedup (2026-03-12):** _filter_events() groups same events with (xN), filters IMU_UPDATE/SYS_HEARTBEAT noise
- **CLAUDE.md:** Full technical reference with FAQ about IMU-less operation
- **Camera Setup Docs (2026-03-12):** Complete documentation for Pi Camera (CSI) and USB camera setup, libcamera installation, boot config, troubleshooting, auto-detection flow
- **Matek H743-SLIM V3 Detailed Docs (2026-03-12):** Board layout diagram, UART6 wiring table, ArduPilot parameters, JT-Zero config, verification steps, Pixhawk TELEM2 pinout, safety guidelines, full drone wiring diagram
- **DEPLOYMENT.md Camera Section (2026-03-12):** Added Etap 11 with camera setup (CSI/USB), libcamera install, boot config, troubleshooting for Pi Zero 2W

## Testing
- Iteration 9: Backend 100% (51 tests), Frontend 100% (all docs sections verified)

## Active Issues
### P0 - Pi Deployment
- Real data not showing on Pi deployment (stuck in simulator mode)
- User needs to install libcamera-apps and configure camera
- Awaiting user feedback from their Raspberry Pi

## Backlog
### P1
- Implement real camera drivers (full libcamera/V4L2 integration with VO pipeline)
- Implement real MAVLink connection (Serial/UDP transport with real FC)

### P2
- Autonomous mission planning (waypoint navigation / Mission Planner tab)
- MAVLink v2 full message serialization
- Camera IP_STREAM (RTSP/HTTP)
- recharts console chart dimension warnings (cosmetic)
- Performance optimization (ARM NEON intrinsics)
