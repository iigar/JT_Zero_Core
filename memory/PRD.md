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

## Completed Phases
- Phase 1-3: Architecture + Core Runtime
- Phase 4: Sensor Modules
- Phase 5: Camera Pipeline
- Phase 6: MAVLink Interface
- Phase 7: Python Bindings (pybind11)
- Phase 8: FastAPI Server
- Phase 9: React Dashboard
- Phase 10: Performance Optimization
- Phase 11: Real Sensor Drivers (I2C/SPI/UART HALs, MPU6050, BMP280, NMEA GPS)
- Cross-Compilation Toolchain
- Flight Physics & 3D Visualization
- UI Overhaul: Tabbed Interface (2026-03-11)

## Code Review Bug Fixes (2026-03-08)
All 9 issues from 3 independent code reviewers addressed:

| Bug | Status |
|-----|--------|
| VO displacement = 0 | FIXED |
| FAST threshold overflow | FIXED |
| MemoryPool race condition | FIXED |
| Heartbeat double-increment | FIXED |
| GPS-as-vision-position | FIXED |
| Odometry delta-as-position | FIXED |
| uint8_t overflow sensors | FIXED |
| rand() not thread-safe | FIXED |
| Camera sim sqrt per-pixel | FIXED |

## UI Overhaul (2026-03-11)
- 7-tab interface: Dashboard, Telemetry, Camera/VO, MAVLink, Events, Docs, Settings
- SettingsTab: Simulator config (6 sliders), Runtime info, System Resources, MAVLink, Hardware Sensors, Thread Status, Engine Statistics
- DocumentationTab: 6 sections (Pi Zero Install 11-step Ukrainian guide, Wiring/GPIO with ASCII pinout, API Reference, Thread Model, File Structure, Hardware)
- Events prop bug fix in DashboardTab
- Slider decimal precision fix

## Testing Status
- Iteration 6: Backend 100% (43 tests), Frontend 100% (all 7 tabs verified)
- All new features verified: tabbed UI, settings sliders, docs sections, GPIO wiring table

## Backlog
### P1
- Integrate real drivers into sensor update() (auto-detect hardware)

### P2
- Real camera drivers (PI_CSI via libcamera, USB via V4L2)
- Real MAVLink serial/UDP connection
- Autonomous mission planning (waypoint navigation)
- recharts ResponsiveContainer width=0 console warning (cosmetic)
