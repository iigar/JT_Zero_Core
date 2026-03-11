# JT-Zero Runtime - PRD

## Original Problem Statement
Design and implement JT-Zero robotics runtime for lightweight drone autonomy on Raspberry Pi Zero 2 W.
Full scope: C++ core, Python bindings (pybind11), FastAPI backend, React monitoring dashboard.

## Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                 JT-Zero Native C++ Runtime                      │
│  T0: Supervisor (10Hz)    T5: MAVLink (50Hz)                    │
│  T1: Sensors (200Hz)      T6: Camera (15FPS FAST+LK VO)        │
│  T2: Events (200Hz)       T7: API Bridge (30Hz)                 │
│  T3: Reflex (200Hz)       Lock-free SPSC Ring Buffers           │
│  T4: Rules (20Hz)         Lock-free MemoryPool (O(1) CAS)      │
│                                                                 │
│  pybind11 ──→ FastAPI ──→ WebSocket 10Hz ──→ React Dashboard   │
└─────────────────────────────────────────────────────────────────┘
```

## Completed
- Phase 1-11: Full runtime, sensors, camera, MAVLink, dashboard
- Bug fixes: VO displacement, MemoryPool race, MAVLink semantics, roll atan2
- UI overhaul: 7-tab interface (Dashboard, Telemetry, Camera/VO, MAVLink, Events, Docs, Settings)
- 3D drone: detailed model, gray-green background, correct orientation
- P1: Sensor auto-detect (I2C/UART probing, HW/SIM badges)
- P2: Camera drivers (PiCSI V4L2 MMAP, USB V4L2)
- P2: MAVLink Serial/UDP transport
- CLAUDE.md: full technical reference with FAQ
- Roll bug fix: atan2(acc_y, -acc_z) in native bridge
- Complementary filter for Python simulator

## Testing Status
- Iteration 7: Backend 100% (48 tests), Frontend 100%
- Roll fix verified: roll ≈ 0° when level

## Backlog
### P2
- Autonomous mission planning (waypoint navigation)
- MAVLink v2 full message serialization
- Camera IP_STREAM (RTSP/HTTP)
- recharts console warning (cosmetic)
