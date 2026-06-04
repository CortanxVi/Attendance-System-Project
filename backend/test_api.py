import urllib.request
import urllib.parse
import json
import numpy as np
import cv2

# Create a dummy image
img = np.zeros((1000, 1000, 3), dtype=np.uint8)
cv2.putText(img, 'Hello World', (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)

# Convert to bytes
is_success, buffer = cv2.imencode(".jpg", img)
image_bytes = buffer.tobytes()

boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
body = (
    f'--{boundary}\r\n'
    f'Content-Disposition: form-data; name="file"; filename="test.jpg"\r\n'
    f'Content-Type: image/jpeg\r\n\r\n'
).encode('utf-8') + image_bytes + f'\r\n--{boundary}--\r\n'.encode('utf-8')

req = urllib.request.Request('http://localhost:8000/api/ocr/', data=body)
req.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')

try:
    response = urllib.request.urlopen(req)
    print(response.status)
    print(response.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print("HTTPError:", e.code)
    print(e.read().decode('utf-8'))
except Exception as e:
    print("Request failed:", e)
