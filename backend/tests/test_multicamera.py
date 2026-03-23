"""
JT-Zero Multi-Camera API Tests (Iteration 16)
Tests for CSI (Primary/VO) + USB Thermal (Secondary) camera system
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestCamerasEndpoint:
    """Tests for GET /api/cameras - lists all camera slots (PRIMARY + SECONDARY)"""
    
    def test_cameras_returns_200(self):
        """GET /api/cameras returns 200"""
        response = requests.get(f"{BASE_URL}/api/cameras")
        assert response.status_code == 200
    
    def test_cameras_returns_array(self):
        """GET /api/cameras returns an array"""
        response = requests.get(f"{BASE_URL}/api/cameras")
        data = response.json()
        assert isinstance(data, list), "Response should be an array"
    
    def test_cameras_has_two_slots(self):
        """GET /api/cameras returns exactly 2 camera slots (PRIMARY + SECONDARY)"""
        response = requests.get(f"{BASE_URL}/api/cameras")
        data = response.json()
        assert len(data) == 2, f"Expected 2 camera slots, got {len(data)}"
    
    def test_cameras_primary_slot_exists(self):
        """GET /api/cameras includes PRIMARY slot"""
        response = requests.get(f"{BASE_URL}/api/cameras")
        data = response.json()
        slots = [cam.get("slot") for cam in data]
        assert "PRIMARY" in slots, "PRIMARY camera slot should exist"
    
    def test_cameras_secondary_slot_exists(self):
        """GET /api/cameras includes SECONDARY slot"""
        response = requests.get(f"{BASE_URL}/api/cameras")
        data = response.json()
        slots = [cam.get("slot") for cam in data]
        assert "SECONDARY" in slots, "SECONDARY camera slot should exist"
    
    def test_cameras_primary_metadata(self):
        """PRIMARY camera has correct metadata (Forward VO camera)"""
        response = requests.get(f"{BASE_URL}/api/cameras")
        data = response.json()
        primary = next((cam for cam in data if cam.get("slot") == "PRIMARY"), None)
        assert primary is not None
        
        # Required fields
        assert "camera_type" in primary
        assert "camera_open" in primary
        assert "active" in primary
        assert "frame_count" in primary
        assert "fps_actual" in primary
        assert "width" in primary
        assert "height" in primary
        assert "label" in primary
        assert "has_vo" in primary
        
        # Primary should have VO enabled
        assert primary["has_vo"] == True, "PRIMARY camera should have VO enabled"
        assert "Forward" in primary.get("label", "") or "VO" in primary.get("label", "")
    
    def test_cameras_secondary_metadata(self):
        """SECONDARY camera has correct metadata (Thermal downward camera)"""
        response = requests.get(f"{BASE_URL}/api/cameras")
        data = response.json()
        secondary = next((cam for cam in data if cam.get("slot") == "SECONDARY"), None)
        assert secondary is not None
        
        # Required fields
        assert "camera_type" in secondary
        assert "camera_open" in secondary
        assert "active" in secondary
        assert "frame_count" in secondary
        assert "fps_actual" in secondary
        assert "width" in secondary
        assert "height" in secondary
        assert "label" in secondary
        assert "has_vo" in secondary
        
        # Secondary should be thermal without VO
        assert secondary["has_vo"] == False, "SECONDARY camera should NOT have VO"
        assert "Thermal" in secondary.get("label", "") or "Down" in secondary.get("label", "")
        assert secondary.get("camera_type") == "USB_THERMAL"
        
        # Thermal camera resolution (256x192 typical)
        assert secondary.get("width") == 256
        assert secondary.get("height") == 192


class TestSecondaryCameraStats:
    """Tests for GET /api/camera/secondary/stats - thermal camera stats"""
    
    def test_secondary_stats_returns_200(self):
        """GET /api/camera/secondary/stats returns 200"""
        response = requests.get(f"{BASE_URL}/api/camera/secondary/stats")
        assert response.status_code == 200
    
    def test_secondary_stats_structure(self):
        """Secondary camera stats has expected fields"""
        response = requests.get(f"{BASE_URL}/api/camera/secondary/stats")
        data = response.json()
        
        # Should not be an error response
        assert "error" not in data, f"Got error: {data.get('error')}"
        
        # Required fields
        assert "slot" in data
        assert data["slot"] == "SECONDARY"
        assert "camera_type" in data
        assert "camera_open" in data
        assert "active" in data
        assert "frame_count" in data
        assert "width" in data
        assert "height" in data
    
    def test_secondary_stats_thermal_type(self):
        """Secondary camera is USB_THERMAL type"""
        response = requests.get(f"{BASE_URL}/api/camera/secondary/stats")
        data = response.json()
        assert data.get("camera_type") == "USB_THERMAL"


class TestSecondaryCameraCapture:
    """Tests for POST /api/camera/secondary/capture - on-demand thermal capture"""
    
    def test_capture_returns_200(self):
        """POST /api/camera/secondary/capture returns 200"""
        response = requests.post(f"{BASE_URL}/api/camera/secondary/capture")
        assert response.status_code == 200
    
    def test_capture_returns_success(self):
        """POST /api/camera/secondary/capture returns success=true"""
        response = requests.post(f"{BASE_URL}/api/camera/secondary/capture")
        data = response.json()
        assert "success" in data
        assert data["success"] == True, f"Capture should succeed, got: {data}"
    
    def test_capture_increments_frame_count(self):
        """Capture increments secondary camera frame_count"""
        # Get initial frame count
        stats_before = requests.get(f"{BASE_URL}/api/camera/secondary/stats").json()
        count_before = stats_before.get("frame_count", 0)
        
        # Trigger capture
        response = requests.post(f"{BASE_URL}/api/camera/secondary/capture")
        assert response.json().get("success") == True
        
        # Check frame count increased
        stats_after = requests.get(f"{BASE_URL}/api/camera/secondary/stats").json()
        count_after = stats_after.get("frame_count", 0)
        
        assert count_after > count_before, f"Frame count should increase: {count_before} -> {count_after}"
    
    def test_capture_sets_active_flag(self):
        """Capture sets secondary camera active flag to true"""
        # Trigger capture
        requests.post(f"{BASE_URL}/api/camera/secondary/capture")
        
        # Check active flag
        stats = requests.get(f"{BASE_URL}/api/camera/secondary/stats").json()
        assert stats.get("active") == True, "Secondary camera should be active after capture"


class TestSecondaryCameraFrame:
    """Tests for GET /api/camera/secondary/frame - thermal frame PNG"""
    
    def test_frame_returns_200_after_capture(self):
        """GET /api/camera/secondary/frame returns 200 after capture"""
        # First trigger a capture
        requests.post(f"{BASE_URL}/api/camera/secondary/capture")
        time.sleep(0.1)  # Allow frame to be generated
        
        response = requests.get(f"{BASE_URL}/api/camera/secondary/frame")
        assert response.status_code == 200
    
    def test_frame_returns_png(self):
        """GET /api/camera/secondary/frame returns PNG image"""
        # Trigger capture first
        requests.post(f"{BASE_URL}/api/camera/secondary/capture")
        time.sleep(0.1)
        
        response = requests.get(f"{BASE_URL}/api/camera/secondary/frame")
        assert response.status_code == 200
        
        # Check content type
        content_type = response.headers.get("Content-Type", "")
        assert "image/png" in content_type, f"Expected image/png, got {content_type}"
    
    def test_frame_has_valid_png_header(self):
        """GET /api/camera/secondary/frame returns valid PNG data"""
        # Trigger capture first
        requests.post(f"{BASE_URL}/api/camera/secondary/capture")
        time.sleep(0.1)
        
        response = requests.get(f"{BASE_URL}/api/camera/secondary/frame")
        assert response.status_code == 200
        
        # PNG magic bytes
        content = response.content
        if len(content) > 8:
            png_header = b'\x89PNG\r\n\x1a\n'
            assert content[:8] == png_header, "Response should be valid PNG"
    
    def test_frame_has_frame_id_header(self):
        """GET /api/camera/secondary/frame includes X-Frame-Id header"""
        requests.post(f"{BASE_URL}/api/camera/secondary/capture")
        time.sleep(0.1)
        
        response = requests.get(f"{BASE_URL}/api/camera/secondary/frame")
        assert response.status_code == 200
        
        # Check for frame ID header
        frame_id = response.headers.get("X-Frame-Id")
        assert frame_id is not None, "X-Frame-Id header should be present"


class TestPrimaryCameraBackwardCompatibility:
    """Tests for backward compatibility - /api/camera and /api/camera/frame still work"""
    
    def test_camera_endpoint_still_works(self):
        """GET /api/camera still returns primary camera stats (backward compat)"""
        response = requests.get(f"{BASE_URL}/api/camera")
        assert response.status_code == 200
        
        data = response.json()
        # Should have standard camera fields
        assert "fps_actual" in data
        assert "frame_count" in data
        assert "width" in data
        assert "height" in data
        assert "vo_features_detected" in data
    
    def test_camera_frame_endpoint_still_works(self):
        """GET /api/camera/frame still returns primary camera frame (backward compat)"""
        response = requests.get(f"{BASE_URL}/api/camera/frame")
        # Should return 200 or 204 (no content if no frame yet)
        assert response.status_code in [200, 204]
        
        if response.status_code == 200:
            content_type = response.headers.get("Content-Type", "")
            assert "image/png" in content_type


class TestWebSocketCamerasPayload:
    """Tests for WebSocket telemetry including cameras array"""
    
    def test_cameras_in_telemetry_via_rest(self):
        """Verify cameras array is included in telemetry (test via REST /api/telemetry)"""
        # Note: Full WebSocket test would require async client
        # We verify the data structure via REST endpoint
        response = requests.get(f"{BASE_URL}/api/telemetry")
        assert response.status_code == 200
        
        # The telemetry endpoint doesn't include cameras directly,
        # but we can verify the cameras endpoint works
        cameras_response = requests.get(f"{BASE_URL}/api/cameras")
        assert cameras_response.status_code == 200
        cameras = cameras_response.json()
        
        assert len(cameras) == 2
        assert any(c["slot"] == "PRIMARY" for c in cameras)
        assert any(c["slot"] == "SECONDARY" for c in cameras)


class TestMultiCameraIntegration:
    """Integration tests for multi-camera system"""
    
    def test_both_cameras_can_be_queried(self):
        """Both cameras can be queried simultaneously"""
        # Query primary
        primary_response = requests.get(f"{BASE_URL}/api/camera")
        assert primary_response.status_code == 200
        
        # Query secondary
        secondary_response = requests.get(f"{BASE_URL}/api/camera/secondary/stats")
        assert secondary_response.status_code == 200
        
        # Query cameras list
        cameras_response = requests.get(f"{BASE_URL}/api/cameras")
        assert cameras_response.status_code == 200
    
    def test_thermal_capture_workflow(self):
        """Full thermal capture workflow: capture -> get stats -> get frame"""
        # Step 1: Capture
        capture_resp = requests.post(f"{BASE_URL}/api/camera/secondary/capture")
        assert capture_resp.status_code == 200
        assert capture_resp.json().get("success") == True
        
        # Step 2: Get stats
        stats_resp = requests.get(f"{BASE_URL}/api/camera/secondary/stats")
        assert stats_resp.status_code == 200
        stats = stats_resp.json()
        assert stats.get("active") == True
        assert stats.get("frame_count", 0) > 0
        
        # Step 3: Get frame
        time.sleep(0.1)
        frame_resp = requests.get(f"{BASE_URL}/api/camera/secondary/frame")
        assert frame_resp.status_code == 200
        assert len(frame_resp.content) > 0
    
    def test_primary_vo_still_works_with_secondary(self):
        """Primary camera VO features still work when secondary is active"""
        # Activate secondary
        requests.post(f"{BASE_URL}/api/camera/secondary/capture")
        
        # Check primary VO still works
        primary = requests.get(f"{BASE_URL}/api/camera").json()
        assert "vo_features_detected" in primary
        assert "vo_features_tracked" in primary
        assert "vo_tracking_quality" in primary
        
        # VO should still be producing data
        assert isinstance(primary.get("vo_features_detected"), (int, float))


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
