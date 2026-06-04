import io
from PIL import Image
from ocr_service import process_ocr

# Create a tiny dummy image
img = Image.new('RGB', (100, 30), color = (255, 255, 255))
img_byte_arr = io.BytesIO()
img.save(img_byte_arr, format='JPEG')
image_bytes = img_byte_arr.getvalue()

try:
    result = process_ocr(image_bytes)
    print("Success:", result)
except Exception as e:
    print("Error:", repr(e))
