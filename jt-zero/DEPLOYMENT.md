# JT-Zero Deployment Guide

## Target Hardware
- **Raspberry Pi Zero 2 W** (BCM2710A1, Cortex-A53 quad-core @ 1GHz)
- Compatible: Pi 3B/3B+, Pi 4, Pi 5 (all ARMv8-A / aarch64)

## Prerequisites

### On Host Machine (Ubuntu/Debian x86_64)
```bash
sudo apt update
sudo apt install -y gcc-aarch64-linux-gnu g++-aarch64-linux-gnu cmake ninja-build
```

### On Raspberry Pi
```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv libatomic1
```

## Cross-Compilation

### 1. Build C++ Runtime
```bash
cd jt-zero
mkdir build-pi && cd build-pi
cmake -DCMAKE_TOOLCHAIN_FILE=../toolchain-pi-zero.cmake \
      -DCMAKE_BUILD_TYPE=Release \
      -G Ninja ..
ninja -j$(nproc)
```

### 2. Transfer to Pi
```bash
# Copy binary and Python files
scp build-pi/jtzero_native*.so pi@<PI_IP>:~/jt-zero/
scp -r ../backend/ pi@<PI_IP>:~/jt-zero/
scp -r api/native_bridge.py pi@<PI_IP>:~/jt-zero/backend/
scp simulator/simulator.py pi@<PI_IP>:~/jt-zero/backend/
```

### 3. Run on Pi
```bash
ssh pi@<PI_IP>
cd ~/jt-zero/backend
python3 -m venv venv && source venv/bin/activate
pip install fastapi uvicorn websockets
python3 -c "import jtzero_native; print('Native runtime OK')"
uvicorn server:app --host 0.0.0.0 --port 8001
```

## Native Compilation (On Pi Directly)

If building directly on the Pi (slower but simpler):
```bash
sudo apt install -y cmake g++ python3-dev pybind11-dev
cd jt-zero
mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Release ..
make -j4
```

## System Constraints
| Resource | Limit        |
|----------|-------------|
| CPU      | <= 65%      |
| RAM      | <= 300 MB   |
| Threads  | 8 (T0-T7)   |

## Service Configuration (systemd)

Create `/etc/systemd/system/jtzero.service`:
```ini
[Unit]
Description=JT-Zero Runtime
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/jt-zero/backend
Environment=PYTHONPATH=/home/pi/jt-zero
ExecStart=/home/pi/jt-zero/backend/venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable jtzero
sudo systemctl start jtzero
sudo systemctl status jtzero
```

## Monitoring

- Dashboard: `http://<PI_IP>:3000`
- Health: `curl http://<PI_IP>:8001/api/health`
- Telemetry: `wscat -c ws://<PI_IP>:8001/api/ws/telemetry`
