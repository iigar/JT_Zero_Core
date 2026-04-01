"""
JT-Zero VO (Visual Odometry) Features Tests
Tests for hardware profiles, altitude-adaptive parameters, and hover yaw correction.
New features for 5km RTL flight with <300m error.
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestVOProfiles:
    """Tests for /api/vo/profiles and /api/vo/profile/{id} endpoints - Hardware Profiles"""
    
    def test_vo_profiles_returns_200(self):
        """VO profiles endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/vo/profiles")
        assert response.status_code == 200
        
    def test_vo_profiles_returns_list(self):
        """VO profiles endpoint returns a list"""
        response = requests.get(f"{BASE_URL}/api/vo/profiles")
        data = response.json()
        assert isinstance(data, list)
        
    def test_vo_profiles_count_is_three(self):
        """VO profiles returns exactly 3 profiles (Pi Zero 2W, Pi 4, Pi 5)"""
        response = requests.get(f"{BASE_URL}/api/vo/profiles")
        data = response.json()
        assert len(data) == 3, f"Expected 3 profiles, got {len(data)}"
        
    def test_vo_profiles_has_required_fields(self):
        """Each VO profile has all required fields"""
        response = requests.get(f"{BASE_URL}/api/vo/profiles")
        data = response.json()
        required_fields = ["id", "name", "type", "width", "height", 
                          "fast_threshold", "lk_window", "lk_iterations", 
                          "max_features", "focal_length", "target_fps"]
        
        for profile in data:
            for field in required_fields:
                assert field in profile, f"Profile missing field: {field}"
                
    def test_vo_profile_pi_zero_2w(self):
        """First profile is Pi Zero 2W with correct specs"""
        response = requests.get(f"{BASE_URL}/api/vo/profiles")
        data = response.json()
        pi_zero = data[0]
        
        assert pi_zero["id"] == 0
        assert pi_zero["name"] == "Pi Zero 2W"
        assert pi_zero["type"] == "PI_ZERO_2W"
        assert pi_zero["width"] == 320
        assert pi_zero["height"] == 240
        assert pi_zero["fast_threshold"] == 30
        assert pi_zero["lk_window"] == 5
        assert pi_zero["max_features"] == 100
        assert pi_zero["target_fps"] == 15.0
        
    def test_vo_profile_pi_4(self):
        """Second profile is Pi 4 with correct specs"""
        response = requests.get(f"{BASE_URL}/api/vo/profiles")
        data = response.json()
        pi4 = data[1]
        
        assert pi4["id"] == 1
        assert pi4["name"] == "Pi 4"
        assert pi4["type"] == "PI_4"
        assert pi4["width"] == 640
        assert pi4["height"] == 480
        assert pi4["fast_threshold"] == 25
        assert pi4["lk_window"] == 7
        assert pi4["max_features"] == 200
        assert pi4["target_fps"] == 30.0
        
    def test_vo_profile_pi_5(self):
        """Third profile is Pi 5 with correct specs"""
        response = requests.get(f"{BASE_URL}/api/vo/profiles")
        data = response.json()
        pi5 = data[2]
        
        assert pi5["id"] == 2
        assert pi5["name"] == "Pi 5"
        assert pi5["type"] == "PI_5"
        assert pi5["width"] == 800
        assert pi5["height"] == 600
        assert pi5["fast_threshold"] == 20
        assert pi5["lk_window"] == 9
        assert pi5["max_features"] == 300
        assert pi5["target_fps"] == 30.0
        
    def test_set_vo_profile_0(self):
        """POST /api/vo/profile/0 switches to Pi Zero 2W"""
        response = requests.post(f"{BASE_URL}/api/vo/profile/0")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] == True
        assert data["profile_id"] == 0
        
    def test_set_vo_profile_1(self):
        """POST /api/vo/profile/1 switches to Pi 4"""
        response = requests.post(f"{BASE_URL}/api/vo/profile/1")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] == True
        assert data["profile_id"] == 1
        
    def test_set_vo_profile_2(self):
        """POST /api/vo/profile/2 switches to Pi 5"""
        response = requests.post(f"{BASE_URL}/api/vo/profile/2")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] == True
        assert data["profile_id"] == 2
        
    def test_profile_change_reflects_in_camera(self):
        """After changing profile, /api/camera reflects the new active_profile"""
        # Set profile to Pi Zero 2W
        requests.post(f"{BASE_URL}/api/vo/profile/0")
        time.sleep(0.2)
        
        response = requests.get(f"{BASE_URL}/api/camera")
        data = response.json()
        assert data["active_profile"] == 0
        assert data["profile_name"] == "Pi Zero 2W"
        
        # Set profile to Pi 5
        requests.post(f"{BASE_URL}/api/vo/profile/2")
        time.sleep(0.2)
        
        response = requests.get(f"{BASE_URL}/api/camera")
        data = response.json()
        assert data["active_profile"] == 2
        assert data["profile_name"] == "Pi 5"


class TestCameraAdaptiveFields:
    """Tests for /api/camera endpoint - Adaptive VO fields"""
    
    def test_camera_has_active_profile(self):
        """Camera stats includes active_profile field"""
        response = requests.get(f"{BASE_URL}/api/camera")
        assert response.status_code == 200
        data = response.json()
        assert "active_profile" in data
        assert isinstance(data["active_profile"], int)
        assert data["active_profile"] in [0, 1, 2]
        
    def test_camera_has_profile_name(self):
        """Camera stats includes profile_name field"""
        response = requests.get(f"{BASE_URL}/api/camera")
        data = response.json()
        assert "profile_name" in data
        assert data["profile_name"] in ["Pi Zero 2W", "Pi 4", "Pi 5"]
        
    def test_camera_has_altitude_zone(self):
        """Camera stats includes altitude_zone field"""
        response = requests.get(f"{BASE_URL}/api/camera")
        data = response.json()
        assert "altitude_zone" in data
        assert isinstance(data["altitude_zone"], int)
        assert data["altitude_zone"] in [0, 1, 2, 3]  # LOW=0, MEDIUM=1, HIGH=2, CRUISE=3
        
    def test_camera_has_altitude_zone_name(self):
        """Camera stats includes altitude_zone_name field"""
        response = requests.get(f"{BASE_URL}/api/camera")
        data = response.json()
        assert "altitude_zone_name" in data
        assert data["altitude_zone_name"] in ["LOW", "MEDIUM", "HIGH", "CRUISE", "MED"]
        
    def test_camera_has_adaptive_fast_thresh(self):
        """Camera stats includes adaptive_fast_thresh field"""
        response = requests.get(f"{BASE_URL}/api/camera")
        data = response.json()
        assert "adaptive_fast_thresh" in data
        assert isinstance(data["adaptive_fast_thresh"], (int, float))
        # FAST threshold should be between 15-35 typically
        assert 15 <= data["adaptive_fast_thresh"] <= 35
        
    def test_camera_has_adaptive_lk_window(self):
        """Camera stats includes adaptive_lk_window field"""
        response = requests.get(f"{BASE_URL}/api/camera")
        data = response.json()
        assert "adaptive_lk_window" in data
        assert isinstance(data["adaptive_lk_window"], (int, float))
        # LK window should be between 3-15 pixels typically
        assert 3 <= data["adaptive_lk_window"] <= 15


class TestCameraHoverFields:
    """Tests for /api/camera endpoint - Hover Yaw Correction fields"""
    
    def test_camera_has_hover_detected(self):
        """Camera stats includes hover_detected field"""
        response = requests.get(f"{BASE_URL}/api/camera")
        assert response.status_code == 200
        data = response.json()
        assert "hover_detected" in data
        assert isinstance(data["hover_detected"], bool)
        
    def test_camera_has_hover_duration(self):
        """Camera stats includes hover_duration field"""
        response = requests.get(f"{BASE_URL}/api/camera")
        data = response.json()
        assert "hover_duration" in data
        assert isinstance(data["hover_duration"], (int, float))
        assert data["hover_duration"] >= 0
        
    def test_camera_has_yaw_drift_rate(self):
        """Camera stats includes yaw_drift_rate field"""
        response = requests.get(f"{BASE_URL}/api/camera")
        data = response.json()
        assert "yaw_drift_rate" in data
        assert isinstance(data["yaw_drift_rate"], (int, float))
        
    def test_camera_has_corrected_yaw(self):
        """Camera stats includes corrected_yaw field"""
        response = requests.get(f"{BASE_URL}/api/camera")
        data = response.json()
        assert "corrected_yaw" in data
        assert isinstance(data["corrected_yaw"], (int, float))


class TestCameraAllNewFields:
    """Complete test for all new camera fields introduced for long-range VO"""
    
    def test_camera_all_new_vo_fields_present(self):
        """Camera endpoint has all new VO fields required for 5km RTL flight"""
        response = requests.get(f"{BASE_URL}/api/camera")
        assert response.status_code == 200
        data = response.json()
        
        # Hardware profile fields
        assert "active_profile" in data
        assert "profile_name" in data
        
        # Altitude-adaptive fields
        assert "altitude_zone" in data
        assert "altitude_zone_name" in data
        assert "adaptive_fast_thresh" in data
        assert "adaptive_lk_window" in data
        
        # Hover yaw correction fields
        assert "hover_detected" in data
        assert "hover_duration" in data
        assert "yaw_drift_rate" in data
        assert "corrected_yaw" in data
        
        # Previously added long-range fields (iteration 14)
        assert "vo_inlier_count" in data
        assert "vo_confidence" in data
        assert "vo_position_uncertainty" in data
        assert "vo_total_distance" in data
        
    def test_camera_data_types_correct(self):
        """Camera new fields have correct data types"""
        response = requests.get(f"{BASE_URL}/api/camera")
        data = response.json()
        
        # Integer fields
        assert isinstance(data["active_profile"], int)
        assert isinstance(data["altitude_zone"], int)
        
        # String fields
        assert isinstance(data["profile_name"], str)
        assert isinstance(data["altitude_zone_name"], str)
        
        # Float fields
        assert isinstance(data["adaptive_fast_thresh"], (int, float))
        assert isinstance(data["adaptive_lk_window"], (int, float))
        assert isinstance(data["hover_duration"], (int, float))
        assert isinstance(data["yaw_drift_rate"], (int, float))
        assert isinstance(data["corrected_yaw"], (int, float))
        
        # Boolean fields
        assert isinstance(data["hover_detected"], bool)


class TestWebSocketTelemetryNewFields:
    """Test that WebSocket telemetry includes new camera fields"""
    
    def test_camera_fields_accessible_via_rest(self):
        """Verify all new fields are present (WebSocket sends same camera data)"""
        response = requests.get(f"{BASE_URL}/api/camera")
        assert response.status_code == 200
        data = response.json()
        
        # These fields should be present in WebSocket camera payload
        new_fields = [
            "active_profile", "profile_name",
            "altitude_zone", "altitude_zone_name",
            "adaptive_fast_thresh", "adaptive_lk_window",
            "hover_detected", "hover_duration",
            "yaw_drift_rate", "corrected_yaw"
        ]
        
        for field in new_fields:
            assert field in data, f"Missing field in camera data: {field}"
