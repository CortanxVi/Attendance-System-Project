/// <reference lib="webworker" />

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import {
  observationFromLandmarker,
  type FaceBlendshapeCategory,
  type FaceLandmarkerPoint,
} from '../utils/liveness';

type InitMessage = {
  type: 'init';
  wasmRoot: string;
  modelUrl: string;
};

type FrameMessage = {
  type: 'frame';
  clientId: number;
  frame: ImageBitmap;
  timestampMs: number;
};

type WorkerMessage = InitMessage | FrameMessage;

let landmarker: FaceLandmarker | null = null;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (message.type === 'init') {
    try {
      // This worker is an ES module, so the Emscripten module loader must also
      // be selected. The classic loader cannot install ModuleFactory here.
      const fileset = await FilesetResolver.forVisionTasks(message.wasmRoot, true);
      const modelResponse = await fetch(message.modelUrl, { cache: 'force-cache' });
      if (!modelResponse.ok) {
        throw new Error(`Face Landmarker model request failed (${modelResponse.status})`);
      }
      const modelAssetBuffer = new Uint8Array(await modelResponse.arrayBuffer());
      landmarker = await FaceLandmarker.createFromOptions(fileset, {
        // Supplying the already downloaded bytes avoids a second SDK-owned
        // request and follows MediaPipe's worker-safe model loading pattern.
        baseOptions: { modelAssetBuffer },
        runningMode: 'VIDEO',
        numFaces: 2,
        minFaceDetectionConfidence: 0.65,
        minFacePresenceConfidence: 0.65,
        minTrackingConfidence: 0.65,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
      });
      // Warm up the graph before the user receives a short-lived QR challenge.
      // Older browsers without OffscreenCanvas simply skip this optimization.
      if (typeof OffscreenCanvas !== 'undefined') {
        try {
          const warmup = new OffscreenCanvas(64, 64);
          landmarker.detectForVideo(warmup, performance.now());
        } catch {
          // Initialization succeeded; unsupported warm-up input is non-fatal.
        }
      }
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'โหลดโมเดลตรวจจับใบหน้าไม่สำเร็จ',
      });
    }
    return;
  }

  if (!landmarker) {
    message.frame.close();
    self.postMessage({
      type: 'error',
      clientId: message.clientId,
      message: 'ระบบตรวจจับใบหน้ายังไม่พร้อมใช้งาน',
    });
    return;
  }

  try {
    const result = landmarker.detectForVideo(message.frame, message.timestampMs);
    const faces = result.faceLandmarks as FaceLandmarkerPoint[][];
    const blendshapes = result.faceBlendshapes.map((item) => (
      item.categories.map((category) => ({
        categoryName: category.categoryName,
        score: category.score,
      }))
    )) as FaceBlendshapeCategory[][];
    const observation = observationFromLandmarker(faces, blendshapes, message.timestampMs);
    self.postMessage(
      { type: 'result', clientId: message.clientId, observation, frame: message.frame },
      { transfer: [message.frame] },
    );
  } catch (error) {
    message.frame.close();
    self.postMessage({
      type: 'error',
      clientId: message.clientId,
      message: error instanceof Error ? error.message : 'ประมวลผลภาพจากกล้องไม่สำเร็จ',
    });
  }
};
