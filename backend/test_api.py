import uuid
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_check_in():
    fake_session_id = str(uuid.uuid4())
    fake_student_id = str(uuid.uuid4())
    
    payload = {
        "session_id": fake_session_id,
        "student_uuid": fake_student_id,
        "status": "present",
        "method": "nfc",
        "similarity_score": 0.95
    }
    
    print("Testing /attendance/check-in")
    print(f"Payload: {payload}")
    
    try:
        response = client.post("/attendance/check-in", json=payload)
        print("Result:")
        print(f"Status Code: {response.status_code}")
        print(f"Response Body: {response.json()}")
    except Exception as e:
        print(f"Error during request: {str(e)}")

if __name__ == "__main__":
    test_check_in()
