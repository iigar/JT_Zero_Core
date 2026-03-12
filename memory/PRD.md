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

## Testing
- Iteration 8: Backend 100% (51 tests), Frontend 100%

## Backlog
### P2
- Autonomous mission planning (waypoint navigation / Mission Planner tab)
- MAVLink v2 full message serialization
- Camera IP_STREAM (RTSP/HTTP)
- recharts console chart dimension warnings (cosmetic)
