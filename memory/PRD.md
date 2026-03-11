# JT-Zero Runtime - PRD

## Original Problem Statement
Design and implement JT-Zero robotics runtime for lightweight drone autonomy on Raspberry Pi Zero 2 W.

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
- Phase 1-3: Architecture + Core Runtime ✅
- Phase 4: Sensor Modules ✅
- Phase 5: Camera Pipeline ✅
- Phase 6: MAVLink Interface ✅
- Phase 7: Python Bindings (pybind11) ✅
- Phase 8: FastAPI Server ✅
- Phase 9: React Dashboard ✅
- Phase 10: Performance Optimization ✅
- Phase 11: Real Sensor Drivers ✅ (2026-03-08)
  - I2C Bus HAL (Linux /dev/i2c-*)
  - SPI Bus HAL (Linux /dev/spidev*)
  - UART Bus HAL (/dev/ttyS*)
  - MPU6050 IMU Driver (I2C 0x68)
  - BMP280 Barometer Driver (I2C 0x76)
  - NMEA GPS Parser (UART)
- Cross-Compilation Toolchain ✅
- Flight Physics & 3D Visualization ✅

## Code Review Bug Fixes (2026-03-08)
All 9 issues from 3 independent code reviewers addressed:

| Bug | Status | Description |
|-----|--------|-------------|
| VO displacement = 0 | FIXED | Added prev_features_ array, computes real pixel-to-meter flow |
| FAST threshold overflow | FIXED | uint8_t → int comparison prevents overflow at center > 225 |
| MemoryPool race condition | FIXED | Replaced with lock-free free-list (O(1) CAS allocate/deallocate) |
| Heartbeat double-increment | FIXED | Removed duplicate ++ in send_heartbeat() |
| GPS-as-vision-position | FIXED | Uses accumulated VO local pose instead of GPS coordinates |
| Odometry delta-as-position | FIXED | Uses accumulated local pose (NED frame) |
| uint8_t overflow sensors | FIXED | Added clamp for satellites (4-24) and quality (0-255) |
| rand() not thread-safe | FIXED | Replaced with thread-local xorshift32 PRNG |
| Camera sim sqrt per-pixel | FIXED | Uses squared distance comparison instead |

## Testing Status
- Iteration 5: Backend 100% (43 tests), Frontend 100%
- VO displacement bug verified: vo_dx/vo_dy now return real non-zero values

## Backlog
### P1
- Integrate real drivers into sensor update() (auto-detect hardware)

### P2
- Real camera drivers (PI_CSI via libcamera, USB via V4L2)
- Real MAVLink serial/UDP connection
- Autonomous mission planning (waypoint navigation)
