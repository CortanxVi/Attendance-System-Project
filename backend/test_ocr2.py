import io
import cv2
import numpy as np
from PIL import Image
from ocr_service import process_ocr

# Create a large dummy image with some text
img = np.zeros((1000, 1000, 3), dtype=np.uint8)
cv2.putText(img, 'Hello World', (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)

# Convert to bytes
is_success, buffer = cv2.imencode(".jpg", img)
image_bytes = buffer.tobytes()

try:
    print("Running process_ocr...")
    result = process_ocr(image_bytes)
    print("Success!")
except Exception as e:
    import traceback
    traceback.print_exc()
