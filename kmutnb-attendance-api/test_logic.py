import sys
import os

# ทำให้สามารถดึงโมดูล utils ได้
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from utils.geo import calculate_gps_distance
from utils.totp import generate_totp_secret, generate_current_totp_token, verify_totp_token

def test_haversine():
    print("--- Testing Haversine Geofencing ---")
    # พิกัด มจพ. (ประมาณ)
    lat1, lon1 = 13.8188, 100.5140 
    
    # ระยะห่างจากจุดเดียวกันต้องเป็น 0
    dist1 = calculate_gps_distance(lat1, lon1, lat1, lon1)
    print(f"Distance between same points: {dist1}m (Expected: 0m)")
    assert dist1 == 0, "Distance should be 0"

    # เลื่อนละติจูดไป 0.0003 องศา (ควรจะประมาณ ~33 เมตร)
    lat2, lon2 = lat1 + 0.0003, lon1
    dist2 = calculate_gps_distance(lat1, lon1, lat2, lon2)
    print(f"Distance between points ~30m apart: {dist2:.2f}m")
    assert 20 < dist2 < 40, "Distance should be around 33 meters"

    # เลื่อนละติจูดไป 1 องศาเต็ม (ควรจะประมาณ ~111 กิโลเมตร)
    dist3 = calculate_gps_distance(lat1, lon1, lat1 + 1, lon1)
    print(f"Distance between points 1 degree lat apart: {dist3:.2f}m")
    assert 110000 < dist3 < 112000, "Distance should be ~111km"
    
    print("✓ Haversine GPS Tests Passed!\n")

def test_totp():
    print("--- Testing TOTP Generation and Verification ---")
    secret = generate_totp_secret()
    print(f"Generated Secret: {secret}")
    
    token = generate_current_totp_token(secret)
    print(f"Generated Token: {token}")
    
    # การยืนยันตัวตนทันทีต้องสำเร็จ
    is_valid = verify_totp_token(secret, token)
    print(f"Immediate verification: {is_valid} (Expected: True)")
    assert is_valid is True, "Immediate verification failed"
    
    # การใส่รหัสมั่วต้องล้มเหลว
    is_invalid = verify_totp_token(secret, "000000")
    print(f"Invalid token verification: {is_invalid} (Expected: False)")
    assert is_invalid is False, "Invalid token verification passed"

    print("✓ TOTP Token Tests Passed!\n")

if __name__ == "__main__":
    test_haversine()
    test_totp()
