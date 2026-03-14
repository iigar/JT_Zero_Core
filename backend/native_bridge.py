"""
JT-Zero Native Bridge
Wraps the compiled C++ runtime (jtzero_native) with the same interface
as the Python simulator, enabling seamless switching.
"""

import time
import math
import sys
import os

# Try to import native module
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import jtzero_native as _native
    NATIVE_AVAILABLE = True
    BUILD_INFO = dict(_native.get_build_info())
except ImportError:
    NATIVE_AVAILABLE = False
    BUILD_INFO = None


class NativeRuntime:
    """Adapter wrapping C++ Runtime with simulator-compatible interface."""
    
    _VO_PROFILES = [
        {"id": 0, "name": "Pi Zero 2W", "type": "PI_ZERO_2W", "width": 320, "height": 240,
         "fast_threshold": 30, "lk_window": 5, "lk_iterations": 4, "max_features": 100,
         "focal_length": 277.0, "target_fps": 15.0},
        {"id": 1, "name": "Pi 4", "type": "PI_4", "width": 640, "height": 480,
         "fast_threshold": 25, "lk_window": 7, "lk_iterations": 5, "max_features": 200,
         "focal_length": 554.0, "target_fps": 30.0},
        {"id": 2, "name": "Pi 5", "type": "PI_5", "width": 800, "height": 600,
         "fast_threshold": 20, "lk_window": 9, "lk_iterations": 6, "max_features": 300,
         "focal_length": 693.0, "target_fps": 30.0},
    ]
    
    def __init__(self):
        if not NATIVE_AVAILABLE:
            raise RuntimeError("jtzero_native module not found")
        
        self._rt = _native.Runtime()
        self._active_profile_id = 0
        
        # Auto-detect: use real hardware on Pi, simulator elsewhere
        # Override with JT_ZERO_SIMULATE=1 to force simulation
        force_sim = os.environ.get("JT_ZERO_SIMULATE", "").lower() in ("1", "true", "yes")
        if force_sim:
            self._rt.set_simulator_mode(True)
            print("[JT-Zero] Forced SIMULATOR mode (JT_ZERO_SIMULATE=1)")
        else:
            # Check if we're on a Raspberry Pi
            is_pi = os.path.exists("/sys/firmware/devicetree/base/model")
            if is_pi:
                self._rt.set_simulator_mode(False)
                print("[JT-Zero] Running on Pi — HARDWARE mode (auto-detect sensors)")
            else:
                self._rt.set_simulator_mode(True)
                print("[JT-Zero] Not on Pi — SIMULATOR mode")
        
        self._start_time = time.time()
        self.running = False
    
    def start(self):
        if self.running:
            return
        ok = self._rt.initialize()
        if not ok:
            raise RuntimeError("C++ runtime initialization failed")
        self._rt.start()
        self._start_time = time.time()
        self.running = True
    
    def stop(self):
        if not self.running:
            return
        self._rt.stop()
        self.running = False
    
    def send_command(self, cmd: str, param1: float = 0, param2: float = 0) -> bool:
        return self._rt.send_command(cmd, param1, param2)
    
    def get_state(self) -> dict:
        state = dict(self._rt.get_state())
        # Fix roll/pitch: C++ uses atan2(acc_y, acc_z) where acc_z=-9.81 → roll≈180°
        # Correct: atan2(acc_y, -acc_z) → roll≈0° when level
        imu = state.get("imu", {})
        if isinstance(imu, dict):
            ay = imu.get("acc_y", 0)
            az = imu.get("acc_z", -9.81)
            ax = imu.get("acc_x", 0)
            state["roll"] = math.atan2(ay, -az) * 57.2958
            state["pitch"] = math.atan2(-ax, math.sqrt(ay**2 + az**2)) * 57.2958
        return state
    
    def get_events(self, count: int = 50) -> list:
        events = self._rt.get_events(count)
        return [dict(e) for e in events]
    
    def get_telemetry_history(self, count: int = 100) -> list:
        history = self._rt.get_telemetry_history(count)
        return [dict(h) for h in history]
    
    def get_thread_stats(self) -> list:
        return [dict(t) for t in self._rt.get_threads()]
    
    def get_engine_stats(self) -> dict:
        return dict(self._rt.get_engines())
    
    def get_camera_stats(self) -> dict:
        d = dict(self._rt.get_camera())
        # Add new long-range VO fields with defaults (C++ module may not have them yet)
        d.setdefault("vo_inlier_count", d.get("vo_features_tracked", 0))
        d.setdefault("vo_confidence", d.get("vo_tracking_quality", 0))
        d.setdefault("vo_position_uncertainty", 0)
        d.setdefault("vo_total_distance", 0)
        # Hardware profile — inject from managed state
        p = self._VO_PROFILES[self._active_profile_id]
        d["active_profile"] = self._active_profile_id
        d["profile_name"] = p["name"]
        # Only override resolution if C++ hasn't set it
        if d.get("width", 320) == 320 and self._active_profile_id != 0:
            d["width"] = p["width"]
            d["height"] = p["height"]
        # Adaptive parameters defaults
        d.setdefault("altitude_zone", 0)
        d.setdefault("altitude_zone_name", "LOW")
        d.setdefault("adaptive_fast_thresh", float(p["fast_threshold"]))
        d.setdefault("adaptive_lk_window", float(p["lk_window"]))
        # Hover yaw correction defaults
        d.setdefault("hover_detected", False)
        d.setdefault("hover_duration", 0.0)
        d.setdefault("yaw_drift_rate", 0.0)
        d.setdefault("corrected_yaw", 0.0)
        return d
    
    def get_frame_data(self) -> bytes:
        """Get latest camera frame as raw grayscale bytes (320x240)."""
        try:
            return self._rt.get_frame_data()
        except Exception:
            return b''
    
    def get_features(self) -> list:
        """Get current VO feature positions [{x, y, tracked, response}, ...]."""
        try:
            return [dict(f) for f in self._rt.get_features()]
        except Exception:
            return []
    
    def get_mavlink_stats(self) -> dict:
        return dict(self._rt.get_mavlink())
    
    def get_sensor_modes(self) -> dict:
        try:
            if hasattr(self._rt, 'get_sensor_modes'):
                return dict(self._rt.get_sensor_modes())
        except Exception:
            pass
        # Fallback: native mode without new C++ binding = mavlink
        return {
            "imu": "mavlink",
            "baro": "mavlink",
            "gps": "mavlink",
            "rangefinder": "mavlink",
            "optical_flow": "mavlink",
            "hw_info": {
                "i2c_available": False,
                "imu_detected": False,
                "baro_detected": False,
                "gps_detected": False,
                "spi_available": False,
                "uart_available": False,
                "imu_model": "none",
                "baro_model": "none",
                "gps_model": "none",
            },
        }
    
    def get_performance(self) -> dict:
        return dict(self._rt.get_performance())
    
    def get_sim_config(self) -> dict:
        return dict(self._rt.get_sim_config())
    
    def set_sim_config(self, config: dict):
        self._rt.set_sim_config(config)
    
    def get_vo_profiles(self) -> list:
        try:
            if hasattr(self._rt, 'get_vo_profiles'):
                return [dict(p) for p in self._rt.get_vo_profiles()]
        except Exception:
            pass
        return list(self._VO_PROFILES)
    
    def set_vo_profile(self, profile_id: int) -> bool:
        if 0 <= profile_id < len(self._VO_PROFILES):
            # Try C++ first
            try:
                if hasattr(self._rt, 'set_vo_profile'):
                    self._rt.set_vo_profile(profile_id)
            except Exception:
                pass
            # Always update managed state
            self._active_profile_id = profile_id
            return True
        return False
