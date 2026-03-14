"""
Real OS-level system metrics for JT-Zero dashboard.
Uses psutil and /proc/ for actual CPU, RAM, temp, network data.
"""

import psutil
import time
import os
from collections import deque

_prev_net = {"bytes_sent": 0, "bytes_recv": 0, "ts": 0}
_cpu_history = deque(maxlen=60)
_ram_history = deque(maxlen=60)
_temp_history = deque(maxlen=60)
_net_history = deque(maxlen=60)


def _read_cpu_temp():
    """Read CPU temperature from thermal zone (works on Pi and most Linux)."""
    try:
        temps = psutil.sensors_temperatures()
        if temps:
            for name in ("cpu_thermal", "cpu-thermal", "coretemp", "soc_thermal"):
                if name in temps and temps[name]:
                    return temps[name][0].current
            first_key = next(iter(temps))
            if temps[first_key]:
                return temps[first_key][0].current
    except Exception:
        pass
    # Fallback: read directly from sysfs
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return int(f.read().strip()) / 1000.0
    except Exception:
        return 0.0


def get_system_metrics():
    """Collect real OS metrics. Returns dict suitable for JSON."""
    now = time.time()

    # CPU
    cpu_percent = psutil.cpu_percent(interval=0)
    cpu_per_core = psutil.cpu_percent(interval=0, percpu=True)
    cpu_freq = psutil.cpu_freq()
    cpu_count = psutil.cpu_count()
    load_avg = os.getloadavg()

    # Memory
    mem = psutil.virtual_memory()

    # Disk
    try:
        disk = psutil.disk_usage("/")
        disk_info = {
            "total_gb": round(disk.total / (1024**3), 2),
            "used_gb": round(disk.used / (1024**3), 2),
            "free_gb": round(disk.free / (1024**3), 2),
            "percent": disk.percent,
        }
    except Exception:
        disk_info = {"total_gb": 0, "used_gb": 0, "free_gb": 0, "percent": 0}

    # Network I/O
    net = psutil.net_io_counters()
    dt = now - _prev_net["ts"] if _prev_net["ts"] > 0 else 1.0
    net_send_rate = (net.bytes_sent - _prev_net["bytes_sent"]) / max(dt, 0.01)
    net_recv_rate = (net.bytes_recv - _prev_net["bytes_recv"]) / max(dt, 0.01)
    _prev_net["bytes_sent"] = net.bytes_sent
    _prev_net["bytes_recv"] = net.bytes_recv
    _prev_net["ts"] = now

    # Temperature
    cpu_temp = _read_cpu_temp()

    # Process info
    try:
        proc = psutil.Process()
        proc_info = {
            "pid": proc.pid,
            "memory_mb": round(proc.memory_info().rss / (1024**2), 1),
            "cpu_percent": proc.cpu_percent(),
            "threads": proc.num_threads(),
        }
    except Exception:
        proc_info = {"pid": 0, "memory_mb": 0, "cpu_percent": 0, "threads": 0}

    # Uptime
    boot_time = psutil.boot_time()
    uptime_sec = int(now - boot_time)

    # Build histories
    _cpu_history.append({"t": now, "v": cpu_percent})
    _ram_history.append({"t": now, "v": mem.percent})
    _temp_history.append({"t": now, "v": cpu_temp})
    _net_history.append({"t": now, "send": net_send_rate / 1024, "recv": net_recv_rate / 1024})

    return {
        "cpu": {
            "total_percent": round(cpu_percent, 1),
            "per_core": [round(c, 1) for c in cpu_per_core],
            "core_count": cpu_count,
            "freq_mhz": round(cpu_freq.current, 0) if cpu_freq else 0,
            "load_1m": round(load_avg[0], 2),
            "load_5m": round(load_avg[1], 2),
            "load_15m": round(load_avg[2], 2),
        },
        "memory": {
            "total_mb": round(mem.total / (1024**2), 0),
            "used_mb": round(mem.used / (1024**2), 0),
            "available_mb": round(mem.available / (1024**2), 0),
            "percent": round(mem.percent, 1),
        },
        "temperature": round(cpu_temp, 1),
        "disk": disk_info,
        "network": {
            "send_kbps": round(net_send_rate / 1024, 1),
            "recv_kbps": round(net_recv_rate / 1024, 1),
            "total_sent_mb": round(net.bytes_sent / (1024**2), 1),
            "total_recv_mb": round(net.bytes_recv / (1024**2), 1),
        },
        "process": proc_info,
        "uptime_sec": uptime_sec,
        "histories": {
            "cpu": list(_cpu_history),
            "ram": list(_ram_history),
            "temp": list(_temp_history),
            "net": list(_net_history),
        },
    }
