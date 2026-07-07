import math

def calculate_gps_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    คำนวณระยะห่างระหว่างจุดพิกัดละติจูดและลองจิจูดสองจุด
    ด้วยสูตร Haversine (คืนค่าเป็นเมตร)
    """
    # รัศมีของโลกเฉลี่ย (เมตร)
    R = 6371000.0
    
    # แปลงองศาเป็นเรเดียน
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    # คำนวณสูตร Haversine
    a = math.sin(delta_phi / 2.0) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * \
        math.sin(delta_lambda / 2.0) ** 2
        
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    
    distance = R * c
    return distance
