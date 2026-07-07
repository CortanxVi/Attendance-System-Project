import urllib.request
import os
import ssl

ssl._create_default_https_context = ssl._create_unverified_context

base_url = "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/"
files = [
    "face_landmark_68_model-shard1",
    "face_landmark_68_model-weights_manifest.json",
    "face_recognition_model-shard1",
    "face_recognition_model-shard2",
    "face_recognition_model-weights_manifest.json",
    "ssd_mobilenetv1_model-shard1",
    "ssd_mobilenetv1_model-shard2",
    "ssd_mobilenetv1_model-weights_manifest.json"
]

target_dir = "public/models"
os.makedirs(target_dir, exist_ok=True)

for file_name in files:
    url = base_url + file_name
    file_path = os.path.join(target_dir, file_name)
    print(f"Downloading {file_name}...")
    try:
        urllib.request.urlretrieve(url, file_path)
        print(f"Success: {file_name}")
    except Exception as e:
        print(f"Failed to download {file_name}: {e}")

print("All downloads completed.")
