import fs from 'fs';
import https from 'https';
import path from 'path';

const modelsUrl = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model/';
const files = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model-shard1',
  'ssd_mobilenetv1_model-shard2',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2'
];

const destDir = path.join(process.cwd(), 'public', 'models');
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

async function downloadFile(filename) {
  return new Promise((resolve, reject) => {
    const fileUrl = modelsUrl + filename;
    const filePath = path.join(destDir, filename);
    const file = fs.createWriteStream(filePath);
    
    https.get(fileUrl, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`Downloaded: ${filename}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filePath, () => {}); // Delete the file async
      reject(err);
    });
  });
}

async function downloadAll() {
  console.log('Downloading face-api models...');
  try {
    await Promise.all(files.map(downloadFile));
    console.log('All models downloaded successfully!');
  } catch (error) {
    console.error('Error downloading models:', error);
  }
}

downloadAll();
