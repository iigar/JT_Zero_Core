"""
JT-Zero Backend API Tests
Tests for all REST endpoints and validates response data structures
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealthEndpoint:
    """Tests for /api/health endpoint - runtime mode and build info"""
    
    def test_health_status_ok(self):
        """Health endpoint returns status ok"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
    
    def test_health_runtime_mode(self):
        """Health endpoint returns runtime mode (native or simulator)"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert "mode" in data
        assert data["mode"] in ["native", "simulator"]
        assert "native" in data
        assert isinstance(data["native"], bool)
    
    def test_health_build_info(self):
        """Health endpoint returns build info when in native mode"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        if data["mode"] == "native":
            assert "build_info" in data
            build_info = data["build_info"]
            assert "compiler" in build_info
            assert "cpp_standard" in build_info
            assert "platform" in build_info


class TestStateEndpoint:
    """Tests for /api/state endpoint - drone state with roll/pitch/yaw/altitude"""
    
    def test_state_returns_200(self):
        """State endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/state")
        assert response.status_code == 200
    
    def test_state_flight_mode(self):
        """State contains flight_mode"""
        response = requests.get(f"{BASE_URL}/api/state")
        data = response.json()
        assert "flight_mode" in data
        assert data["flight_mode"] in ["IDLE", "ARMED", "TAKEOFF", "HOVER", "LAND", "RTL", "EMERGENCY"]
    
    def test_state_attitude(self):
        """State contains roll, pitch, yaw values"""
        response = requests.get(f"{BASE_URL}/api/state")
        data = response.json()
        assert "roll" in data
        assert "pitch" in data
        assert "yaw" in data
        assert isinstance(data["roll"], (int, float))
        assert isinstance(data["pitch"], (int, float))
        assert isinstance(data["yaw"], (int, float))
    
    def test_state_altitude(self):
        """State contains altitude_agl"""
        response = requests.get(f"{BASE_URL}/api/state")
        data = response.json()
        assert "altitude_agl" in data
        assert isinstance(data["altitude_agl"], (int, float))
    
    def test_state_battery(self):
        """State contains battery info"""
        response = requests.get(f"{BASE_URL}/api/state")
        data = response.json()
        assert "battery_voltage" in data
        assert "battery_percent" in data
        assert data["battery_voltage"] > 0
    
    def test_state_imu_sensor(self):
        """State contains IMU sensor data"""
        response = requests.get(f"{BASE_URL}/api/state")
        data = response.json()
        assert "imu" in data
        imu = data["imu"]
        assert "gyro_x" in imu
        assert "gyro_y" in imu
        assert "gyro_z" in imu
        assert "acc_x" in imu
        assert "acc_y" in imu
        assert "acc_z" in imu
        assert "valid" in imu
    
    def test_state_gps_sensor(self):
        """State contains GPS sensor data"""
        response = requests.get(f"{BASE_URL}/api/state")
        data = response.json()
        assert "gps" in data
        gps = data["gps"]
        assert "lat" in gps
        assert "lon" in gps
        assert "alt" in gps
        assert "satellites" in gps
    
    def test_state_barometer(self):
        """State contains barometer data"""
        response = requests.get(f"{BASE_URL}/api/state")
        data = response.json()
        assert "baro" in data
        baro = data["baro"]
        assert "pressure" in baro
        assert "altitude" in baro
        assert "temperature" in baro


class TestTelemetryEndpoint:
    """Tests for /api/telemetry endpoint - state + threads + engines"""
    
    def test_telemetry_returns_200(self):
        """Telemetry endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/telemetry")
        assert response.status_code == 200
    
    def test_telemetry_state(self):
        """Telemetry contains state object"""
        response = requests.get(f"{BASE_URL}/api/telemetry")
        data = response.json()
        assert "state" in data
        assert "roll" in data["state"]
        assert "pitch" in data["state"]
    
    def test_telemetry_threads(self):
        """Telemetry contains threads array"""
        response = requests.get(f"{BASE_URL}/api/telemetry")
        data = response.json()
        assert "threads" in data
        assert isinstance(data["threads"], list)
        if len(data["threads"]) > 0:
            thread = data["threads"][0]
            assert "name" in thread
            assert "running" in thread
            assert "cpu_percent" in thread
    
    def test_telemetry_engines(self):
        """Telemetry contains engines object"""
        response = requests.get(f"{BASE_URL}/api/telemetry")
        data = response.json()
        assert "engines" in data
        engines = data["engines"]
        assert "events" in engines
        assert "reflexes" in engines


class TestEventsEndpoint:
    """Tests for /api/events endpoint - event array"""
    
    def test_events_returns_200(self):
        """Events endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/events")
        assert response.status_code == 200
    
    def test_events_returns_array(self):
        """Events returns an array"""
        response = requests.get(f"{BASE_URL}/api/events")
        data = response.json()
        assert isinstance(data, list)
    
    def test_events_structure(self):
        """Events have correct structure"""
        response = requests.get(f"{BASE_URL}/api/events")
        data = response.json()
        if len(data) > 0:
            event = data[0]
            assert "timestamp" in event
            assert "type" in event
            assert "priority" in event
    
    def test_events_count_param(self):
        """Events endpoint respects count parameter"""
        response = requests.get(f"{BASE_URL}/api/events?count=10")
        assert response.status_code == 200
        data = response.json()
        assert len(data) <= 10


class TestCameraEndpoint:
    """Tests for /api/camera endpoint - camera stats with fps/frames/resolution"""
    
    def test_camera_returns_200(self):
        """Camera endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/camera")
        assert response.status_code == 200
    
    def test_camera_basic_stats(self):
        """Camera returns fps, frame count, resolution"""
        response = requests.get(f"{BASE_URL}/api/camera")
        data = response.json()
        assert "fps_actual" in data
        assert "frame_count" in data
        assert "width" in data
        assert "height" in data
        assert data["width"] > 0
        assert data["height"] > 0
    
    def test_camera_visual_odometry(self):
        """Camera returns visual odometry data"""
        response = requests.get(f"{BASE_URL}/api/camera")
        data = response.json()
        assert "vo_features_detected" in data
        assert "vo_features_tracked" in data
        assert "vo_tracking_quality" in data


class TestMavlinkEndpoint:
    """Tests for /api/mavlink endpoint - mavlink connection state"""
    
    def test_mavlink_returns_200(self):
        """MAVLink endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/mavlink")
        assert response.status_code == 200
    
    def test_mavlink_state(self):
        """MAVLink returns connection state"""
        response = requests.get(f"{BASE_URL}/api/mavlink")
        data = response.json()
        assert "state" in data
        assert data["state"] in ["CONNECTED", "DISCONNECTED", "CONNECTING"]
    
    def test_mavlink_message_counters(self):
        """MAVLink returns message counters"""
        response = requests.get(f"{BASE_URL}/api/mavlink")
        data = response.json()
        assert "messages_sent" in data
        assert "messages_received" in data
        assert isinstance(data["messages_sent"], int)
        assert isinstance(data["messages_received"], int)
    
    def test_mavlink_fc_info(self):
        """MAVLink returns flight controller info"""
        response = requests.get(f"{BASE_URL}/api/mavlink")
        data = response.json()
        assert "fc_autopilot" in data
        assert "fc_type" in data


class TestPerformanceEndpoint:
    """Tests for /api/performance endpoint - CPU/memory/latency metrics"""
    
    def test_performance_returns_200(self):
        """Performance endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/performance")
        assert response.status_code == 200
    
    def test_performance_cpu_metrics(self):
        """Performance returns CPU metrics"""
        response = requests.get(f"{BASE_URL}/api/performance")
        data = response.json()
        if "error" not in data:  # Only available with native runtime
            assert "total_cpu_percent" in data
            assert "threads" in data
    
    def test_performance_memory_metrics(self):
        """Performance returns memory metrics"""
        response = requests.get(f"{BASE_URL}/api/performance")
        data = response.json()
        if "error" not in data:
            assert "memory" in data
            mem = data["memory"]
            assert "total_mb" in mem
    
    def test_performance_latency_metrics(self):
        """Performance returns latency metrics"""
        response = requests.get(f"{BASE_URL}/api/performance")
        data = response.json()
        if "error" not in data:
            assert "latency" in data
            assert "throughput" in data


class TestSimulatorConfigEndpoint:
    """Tests for /api/simulator/config GET and POST"""
    
    def test_sim_config_get_returns_200(self):
        """Simulator config GET returns 200"""
        response = requests.get(f"{BASE_URL}/api/simulator/config")
        assert response.status_code == 200
    
    def test_sim_config_get_structure(self):
        """Simulator config returns expected fields"""
        response = requests.get(f"{BASE_URL}/api/simulator/config")
        data = response.json()
        if "error" not in data:
            assert "wind_speed" in data
            assert "wind_direction" in data
            assert "sensor_noise" in data
            assert "battery_drain" in data
    
    def test_sim_config_post_updates(self):
        """Simulator config POST updates config"""
        # Get initial config
        initial = requests.get(f"{BASE_URL}/api/simulator/config").json()
        if "error" in initial:
            pytest.skip("Simulator config not available")
        
        # Update wind speed
        response = requests.post(
            f"{BASE_URL}/api/simulator/config",
            json={"wind_speed": 5.5}
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
        assert data.get("config", {}).get("wind_speed") == 5.5
        
        # Reset wind speed
        requests.post(
            f"{BASE_URL}/api/simulator/config",
            json={"wind_speed": initial.get("wind_speed", 0)}
        )


class TestCommandEndpoint:
    """Tests for /api/command POST - ARM/DISARM/TAKEOFF/LAND"""
    
    def test_command_arm(self):
        """Command ARM works"""
        response = requests.post(
            f"{BASE_URL}/api/command",
            json={"command": "arm", "param1": 0, "param2": 0}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] == True
        assert data["command"] == "arm"
        
        # Cleanup - disarm
        requests.post(
            f"{BASE_URL}/api/command",
            json={"command": "disarm", "param1": 0, "param2": 0}
        )
    
    def test_command_disarm(self):
        """Command DISARM works"""
        response = requests.post(
            f"{BASE_URL}/api/command",
            json={"command": "disarm", "param1": 0, "param2": 0}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] == True
        assert data["command"] == "disarm"
    
    def test_command_takeoff(self):
        """Command TAKEOFF works with altitude parameter"""
        response = requests.post(
            f"{BASE_URL}/api/command",
            json={"command": "takeoff", "param1": 10, "param2": 0}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] == True
        assert data["command"] == "takeoff"
        
        # Cleanup
        time.sleep(0.5)
        requests.post(
            f"{BASE_URL}/api/command",
            json={"command": "disarm", "param1": 0, "param2": 0}
        )
    
    def test_command_land(self):
        """Command LAND works"""
        response = requests.post(
            f"{BASE_URL}/api/command",
            json={"command": "land", "param1": 0, "param2": 0}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] == True
        assert data["command"] == "land"


class TestThreadsAndEnginesEndpoints:
    """Tests for /api/threads and /api/engines endpoints"""
    
    def test_threads_returns_200(self):
        """Threads endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/threads")
        assert response.status_code == 200
    
    def test_threads_structure(self):
        """Threads returns list with expected structure"""
        response = requests.get(f"{BASE_URL}/api/threads")
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            thread = data[0]
            assert "name" in thread
            assert "running" in thread
    
    def test_engines_returns_200(self):
        """Engines endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/engines")
        assert response.status_code == 200
    
    def test_engines_structure(self):
        """Engines returns expected components"""
        response = requests.get(f"{BASE_URL}/api/engines")
        data = response.json()
        assert "events" in data
        assert "reflexes" in data
        assert "rules" in data
        assert "memory" in data


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
