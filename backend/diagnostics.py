"""
Hardware Diagnostics Scanner for JT-Zero.
Detects cameras, I2C/SPI buses, UART ports, GPIO, and MAVLink connections.
Works on Raspberry Pi; gracefully degrades in other environments.
"""

import os
import glob
import subprocess
import time

# Known I2C device addresses
I2C_KNOWN_DEVICES = {
    0x1E: "HMC5883L (Compass)",
    0x29: "VL53L0X (Rangefinder)",
    0x3C: "SSD1306 (OLED)",
    0x48: "ADS1115 (ADC)",
    0x50: "AT24C32 (EEPROM)",
    0x53: "ADXL345 (Accel)",
    0x68: "MPU6050 / ICM42688P (IMU)",
    0x69: "MPU6050 alt (IMU)",
    0x76: "BMP280 / DPS310 (Baro)",
    0x77: "BMP280 alt / BME280 (Baro)",
}

_cached_result = None
_last_scan_time = 0


def _run_cmd(cmd, timeout=5):
    """Run a shell command, return (stdout, success)."""
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip(), r.returncode == 0
    except Exception:
        return "", False


def _check_camera():
    """Detect CSI and USB cameras."""
    results = []

    # Check video devices
    video_devs = sorted(glob.glob("/dev/video*"))

    # CSI camera check (Pi-specific)
    csi_detected = False
    csi_info = ""

    # vcgencmd method (Pi OS)
    out, ok = _run_cmd("vcgencmd get_camera 2>/dev/null")
    if ok and "detected=1" in out:
        csi_detected = True
        csi_info = out

    # libcamera method
    if not csi_detected:
        out, ok = _run_cmd("libcamera-hello --list-cameras 2>/dev/null | head -5")
        if ok and "Available" in out and "No cameras" not in out:
            csi_detected = True
            csi_info = "libcamera detected"

    # Fallback: check /dev/video0 exists and is a bcm2835 device
    if not csi_detected and os.path.exists("/dev/video0"):
        out, _ = _run_cmd("v4l2-ctl --device=/dev/video0 --info 2>/dev/null | grep -i 'card\\|driver'")
        if "bcm2835" in out.lower() or "unicam" in out.lower() or "mmal" in out.lower():
            csi_detected = True
            csi_info = out.replace("\n", "; ")

    results.append({
        "name": "CSI Camera",
        "detected": csi_detected,
        "status": "ok" if csi_detected else "not_found",
        "device": "/dev/video0" if csi_detected else None,
        "info": csi_info or "No CSI camera detected",
    })

    # USB cameras (non-CSI video devices)
    usb_cameras = []
    for dev in video_devs:
        out, _ = _run_cmd(f"v4l2-ctl --device={dev} --info 2>/dev/null | grep -i 'card\\|driver'")
        if out and "bcm2835" not in out.lower() and "unicam" not in out.lower():
            usb_cameras.append({"device": dev, "info": out.replace("\n", "; ")})

    results.append({
        "name": "USB Camera",
        "detected": len(usb_cameras) > 0,
        "status": "ok" if usb_cameras else "not_found",
        "devices": usb_cameras,
        "info": f"{len(usb_cameras)} USB camera(s)" if usb_cameras else "No USB cameras",
    })

    return results


def _check_i2c():
    """Scan I2C buses for devices."""
    buses = sorted(glob.glob("/dev/i2c-*"))
    results = {
        "available": len(buses) > 0,
        "buses": [b.split("-")[-1] for b in buses],
        "devices": [],
    }

    for bus in buses:
        bus_num = bus.split("-")[-1]
        # Try i2cdetect
        out, ok = _run_cmd(f"i2cdetect -y {bus_num} 2>/dev/null")
        if ok:
            # Parse i2cdetect output for addresses
            for line in out.split("\n"):
                parts = line.split(":")
                if len(parts) == 2:
                    base_str = parts[0].strip()
                    try:
                        base = int(base_str, 16)
                    except ValueError:
                        continue
                    for i, cell in enumerate(parts[1].split()):
                        if cell != "--" and cell != "UU":
                            try:
                                addr = int(cell, 16)
                                name = I2C_KNOWN_DEVICES.get(addr, f"Unknown (0x{addr:02X})")
                                results["devices"].append({
                                    "bus": int(bus_num),
                                    "address": f"0x{addr:02X}",
                                    "name": name,
                                    "status": "ok",
                                })
                            except ValueError:
                                pass
                        elif cell == "UU":
                            addr = base + i
                            name = I2C_KNOWN_DEVICES.get(addr, f"In-use (0x{addr:02X})")
                            results["devices"].append({
                                "bus": int(bus_num),
                                "address": f"0x{addr:02X}",
                                "name": name,
                                "status": "busy",
                            })

    return results


def _check_spi():
    """Check SPI bus availability."""
    devs = sorted(glob.glob("/dev/spidev*"))
    return {
        "available": len(devs) > 0,
        "devices": [os.path.basename(d) for d in devs],
        "info": f"{len(devs)} SPI device(s)" if devs else "SPI not available",
    }


def _check_uart():
    """Check UART port availability."""
    ports = []
    uart_paths = [
        ("/dev/ttyAMA0", "Pi GPIO UART (PL011)"),
        ("/dev/ttyAMA1", "Pi UART1"),
        ("/dev/ttyS0", "Pi mini-UART"),
        ("/dev/serial0", "Pi primary UART (symlink)"),
        ("/dev/serial1", "Pi secondary UART (symlink)"),
    ]
    # Add USB serial devices
    for usb in sorted(glob.glob("/dev/ttyUSB*")):
        uart_paths.append((usb, "USB Serial Adapter"))
    for acm in sorted(glob.glob("/dev/ttyACM*")):
        uart_paths.append((acm, "USB ACM Device"))

    for path, desc in uart_paths:
        exists = os.path.exists(path)
        # Check if it's a symlink and resolve
        real_path = None
        if exists and os.path.islink(path):
            real_path = os.path.realpath(path)
        ports.append({
            "device": path,
            "description": desc,
            "available": exists,
            "real_path": real_path,
        })

    return {
        "ports": ports,
        "available_count": sum(1 for p in ports if p["available"]),
    }


def _check_gpio():
    """Check GPIO availability."""
    gpio_available = os.path.exists("/sys/class/gpio")
    gpio_mem = os.path.exists("/dev/gpiomem")
    gpio_chip = os.path.exists("/dev/gpiochip0")

    # Check exported GPIOs
    exported = []
    if gpio_available:
        for g in sorted(glob.glob("/sys/class/gpio/gpio*")):
            name = os.path.basename(g)
            if name.startswith("gpio") and name[4:].isdigit():
                pin = int(name[4:])
                try:
                    with open(os.path.join(g, "direction")) as f:
                        direction = f.read().strip()
                    exported.append({"pin": pin, "direction": direction})
                except Exception:
                    exported.append({"pin": pin, "direction": "unknown"})

    return {
        "sysfs_available": gpio_available,
        "gpiomem": gpio_mem,
        "gpiochip0": gpio_chip,
        "exported_pins": exported,
    }


def _check_platform():
    """Detect platform info."""
    is_pi = os.path.exists("/sys/firmware/devicetree/base/model")
    model = ""
    if is_pi:
        try:
            with open("/sys/firmware/devicetree/base/model") as f:
                model = f.read().strip().rstrip("\x00")
        except Exception:
            pass

    # CPU info
    cpu_model = ""
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("model name") or line.startswith("Model"):
                    cpu_model = line.split(":")[-1].strip()
                    break
    except Exception:
        pass

    # Kernel
    kernel, _ = _run_cmd("uname -r")

    # OS
    os_name = ""
    try:
        with open("/etc/os-release") as f:
            for line in f:
                if line.startswith("PRETTY_NAME="):
                    os_name = line.split("=", 1)[1].strip().strip('"')
                    break
    except Exception:
        pass

    return {
        "is_raspberry_pi": is_pi,
        "model": model,
        "cpu": cpu_model,
        "kernel": kernel,
        "os": os_name,
    }


def run_diagnostics(mavlink_stats=None):
    """Run full hardware diagnostics scan. Returns dict with all results."""
    global _cached_result, _last_scan_time

    start = time.time()

    platform = _check_platform()
    cameras = _check_camera()
    i2c = _check_i2c()
    spi = _check_spi()
    uart = _check_uart()
    gpio = _check_gpio()

    # MAVLink status from runtime
    mavlink_status = {
        "connected": False,
        "fc_type": "N/A",
        "fc_firmware": "N/A",
        "baud_rate": "N/A",
        "port": "N/A",
    }
    if mavlink_stats:
        mavlink_status["connected"] = mavlink_stats.get("state") == "CONNECTED"
        mavlink_status["fc_type"] = mavlink_stats.get("fc_type", "N/A")
        mavlink_status["fc_firmware"] = mavlink_stats.get("fc_firmware", "N/A")

    scan_time = time.time() - start

    # Build summary
    csi_ok = any(c["detected"] for c in cameras if c["name"] == "CSI Camera")
    usb_cam_ok = any(c["detected"] for c in cameras if c["name"] == "USB Camera")
    i2c_device_count = len(i2c["devices"])

    summary = {
        "platform": "Raspberry Pi" if platform["is_raspberry_pi"] else "Other Linux",
        "camera": "CSI" if csi_ok else ("USB" if usb_cam_ok else "NONE"),
        "i2c_devices": i2c_device_count,
        "spi_available": spi["available"],
        "uart_available": uart["available_count"] > 0,
        "mavlink_connected": mavlink_status["connected"],
        "gpio_available": gpio["sysfs_available"],
        "overall": "ok" if (csi_ok or usb_cam_ok) and mavlink_status["connected"] else "partial",
    }

    result = {
        "timestamp": time.time(),
        "scan_duration_ms": round(scan_time * 1000, 1),
        "platform": platform,
        "camera": cameras,
        "i2c": i2c,
        "spi": spi,
        "uart": uart,
        "gpio": gpio,
        "mavlink": mavlink_status,
        "summary": summary,
    }

    _cached_result = result
    _last_scan_time = time.time()
    return result


def get_cached_diagnostics():
    """Return cached diagnostics or run a fresh scan."""
    if _cached_result is None:
        return run_diagnostics()
    return _cached_result
