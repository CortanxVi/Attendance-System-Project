import easyocr
import cv2
import numpy as np

# Create image with rotated text (90 deg)
img = np.zeros((300, 300, 3), dtype=np.uint8)
# Create a horizontal text image first
text_img = np.zeros((100, 300, 3), dtype=np.uint8)
cv2.putText(text_img, 'Hello World', (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
# Rotate it 90 degrees CW
rotated = cv2.rotate(text_img, cv2.ROTATE_90_CLOCKWISE)

reader = easyocr.Reader(['en'], gpu=False, verbose=False)
results = reader.readtext(rotated, rotation_info=[90, 180, 270])

for bbox, text, prob in results:
    print(f"Text: {text}")
    print(f"BBox: {bbox}")
    tl, tr, br, bl = bbox
    dx = tr[0] - tl[0]
    dy = tr[1] - tl[1]
    print(f"dx: {dx}, dy: {dy}")
    is_normal = dx > 0 and abs(dx) > abs(dy)
    print(f"Is normal: {is_normal}")
