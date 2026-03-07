# JT-Zero: Lightweight Drone Autonomy Runtime

## Overview

JT-Zero is a high-performance robotics runtime designed for the Raspberry Pi Zero 2 W, enabling lightweight autonomous drone operations. Built in C++17 with embedded best practices, it provides a real-time event-driven architecture with lock-free data structures.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     JT-Zero Runtime                         │
│                                                             │
│  ┌─── T0: Supervisor (10 Hz) ───────────────────────────┐   │
│  │  System health, battery monitor, telemetry recording  │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─── T1: Sensor Pipeline (200 Hz) ─────────────────────┐   │
│  │  IMU(200Hz) BARO(50Hz) GPS(10Hz) RANGE(50Hz) FLOW    │   │
│  └──────────────────┬────────────────────────────────────┘   │
│                     │ Lock-free Ring Buffer                  │
│  ┌─── T2: Event Engine (200 Hz) ────────────────────────┐   │
│  │  Event queue dispatch, memory recording               │   │
│  └──────────────────┬────────────────────────────────────┘   │
│                     │                                        │
│  ┌─── T3: Reflex Engine (200 Hz) ───────────────────────┐   │
│  │  Ultra-fast reactions (<5ms): E-stop, proximity alert │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─── T4: Rule Engine (20 Hz) ──────────────────────────┐   │
│  │  Complex logic: auto-RTL, GPS-lost hold, mode mgmt   │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─── T7: API Bridge (HTTP/WebSocket) ──────────────────┐   │
│  │  FastAPI server, real-time telemetry streaming        │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## System Constraints

| Parameter       | Target            |
|----------------|-------------------|
| CPU usage       | <= 65%            |
| RAM usage       | <= 300 MB         |
| Reflex latency  | < 5 ms            |
| Platform        | Pi Zero 2 W (ARM) |
| C++ standard    | C++17             |

## Core Components

### Event Engine (`core/event_engine.cpp`)
- Lock-free SPSC ring buffer (1024 events)
- O(1) push/pop operations
- Zero dynamic allocation
- Event types: sensor, system, flight, camera, MAVLink, command

### Reflex Engine (`core/reflex_engine.cpp`)
- Pattern matching: Event → Condition → Action
- < 5ms latency guaranteed
- Cooldown support to prevent rapid firing
- Default reflexes: emergency stop, low battery, altitude limit

### Rule Engine (`core/rule_engine.cpp`)
- Priority-based behavior evaluation
- Flight mode state machine
- Default rules: auto-RTL on low battery, GPS-lost hold, takeoff detection

### Memory Engine (`core/memory_engine.cpp`)
- Ring buffer telemetry history (2048 records)
- Event history (512 records)
- Fixed memory: ~424 KB total

### Output Engine (`core/output_engine.cpp`)
- Queued output commands
- Support for GPIO, MAVLink, logging, buzzer, LED
- Pluggable output handler

## Sensor Modules

| Sensor       | Rate   | Data                                    |
|-------------|--------|----------------------------------------|
| IMU          | 200 Hz | gyro_xyz, acc_xyz (rad/s, m/s²)        |
| Barometer    | 50 Hz  | pressure (hPa), altitude (m), temp (°C)|
| GPS          | 10 Hz  | lat, lon (°), alt (m), speed (m/s)     |
| Rangefinder  | 50 Hz  | distance (m), signal_quality (0-1)     |
| Optical Flow | 50 Hz  | flow_xy (rad/s), quality (0-255)       |

## Building

### Native (development/test)
```bash
cd jt-zero
mkdir build && cd build
cmake ..
make -j$(nproc)
./jt-zero --duration 10
```

### Cross-compile for Pi Zero 2 W
```bash
cd jt-zero
mkdir build-pi && cd build-pi
cmake -DCMAKE_TOOLCHAIN_FILE=../toolchain-pi-zero.cmake ..
make -j$(nproc)
scp jt-zero pi@raspberrypi:/home/pi/
```

## Thread Model

| Thread | Name          | Rate     | Priority | Core | Purpose                   |
|--------|--------------|----------|----------|------|---------------------------|
| T0     | Supervisor    | 10 Hz    | 90       | 0    | Health, telemetry, output |
| T1     | Sensors       | 200 Hz   | 95       | 1    | Read all sensors          |
| T2     | Events        | 200 Hz   | 85       | 2    | Dispatch events           |
| T3     | Reflex        | 200 Hz   | 98       | 2    | Fast reactions            |
| T4     | Rules         | 20 Hz    | 70       | 3    | Complex behavior logic    |
| T5     | MAVLink       | 50 Hz    | 80       | 1    | Flight controller comm    |
| T6     | Camera        | 15 FPS   | 60       | 3    | Visual pipeline           |
| T7     | API           | 30 Hz    | 50       | any  | HTTP/WS bridge            |

## API Endpoints

| Method | Endpoint               | Description                    |
|--------|----------------------|--------------------------------|
| GET    | /api/health           | Runtime health check           |
| GET    | /api/state            | Full system state              |
| GET    | /api/events           | Recent events (query: count)   |
| GET    | /api/telemetry        | State + threads + engines      |
| GET    | /api/telemetry/history| Historical telemetry records   |
| GET    | /api/threads          | Thread statistics              |
| GET    | /api/engines          | Engine statistics              |
| POST   | /api/command          | Send command (arm/disarm/etc)  |
| WS     | /api/ws/telemetry     | Real-time telemetry stream     |
| WS     | /api/ws/events        | Real-time event stream         |

### Commands
- `arm` / `disarm` — Arm/disarm motors
- `takeoff` — Start takeoff (param1: altitude)
- `land` — Initiate landing
- `hold` — Position hold
- `rtl` — Return to launch
- `emergency` — Emergency stop

## Extending the System

### Adding a new sensor
1. Define data struct in `include/jt_zero/common.h`
2. Create sensor class in `include/jt_zero/sensors.h`
3. Implement in `sensors/` directory
4. Add to sensor loop in `runtime.cpp`

### Adding a reflex rule
```cpp
ReflexRule my_rule;
my_rule.name = "my_reflex";
my_rule.trigger = EventType::SENSOR_IMU_UPDATE;
my_rule.condition = [](const Event& e, const SystemState& s) {
    return s.imu.acc_z > -5.0f; // Free-fall detection
};
my_rule.action = [](const Event&, SystemState& s, EventEngine& ev) {
    s.flight_mode = FlightMode::EMERGENCY;
    ev.emit(EventType::SYSTEM_ERROR, 255, "Free-fall detected!");
};
reflex_engine_.add_rule(my_rule);
```

### Adding a behavior rule
```cpp
BehaviorRule my_rule;
my_rule.name = "altitude_fence";
my_rule.priority = 80;
my_rule.evaluate = [](const SystemState& s, RuleResult& r) -> bool {
    if (s.altitude_agl > 50.0f) {
        r.action = RuleAction::HOLD;
        strncpy(r.message, "Altitude fence triggered", sizeof(r.message));
        return true;
    }
    return false;
};
rule_engine_.add_rule(my_rule);
```

## File Structure
```
jt-zero/
├── include/jt_zero/
│   ├── common.h          # Types, ring buffer, memory pool
│   ├── event_engine.h    # Event queue interface
│   ├── reflex_engine.h   # Fast reaction interface
│   ├── rule_engine.h     # Behavior logic interface
│   ├── memory_engine.h   # Telemetry history interface
│   ├── output_engine.h   # Hardware output interface
│   ├── sensors.h         # Sensor interfaces
│   └── runtime.h         # Main runtime orchestrator
├── core/
│   ├── event_engine.cpp
│   ├── reflex_engine.cpp
│   ├── rule_engine.cpp
│   ├── memory_engine.cpp
│   ├── output_engine.cpp
│   └── runtime.cpp
├── sensors/
│   └── sensors.cpp       # Simulated sensor implementations
├── main.cpp              # Standalone entry point
├── CMakeLists.txt        # Build system
└── README.md             # This file
```

## License

MIT License - see LICENSE file for details.
