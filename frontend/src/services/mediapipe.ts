import faceMeshScriptUrl from '@mediapipe/face_mesh/face_mesh.js?url';
import cameraScriptUrl from '@mediapipe/camera_utils/camera_utils.js?url';

export interface FaceMeshResults {
  multiFaceLandmarks?: Array<Array<{ x: number; y: number; z?: number }>>;
}

export interface FaceMeshInstance {
  setOptions(options: Record<string, boolean | number>): void;
  onResults(callback: (results: FaceMeshResults) => void): void;
  send(input: { image: HTMLVideoElement }): Promise<void>;
  close(): void;
}

export interface CameraInstance {
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
}

type FaceMeshConstructor = new (options: { locateFile: (file: string) => string }) => FaceMeshInstance;
type CameraConstructor = new (
  video: HTMLVideoElement,
  options: { onFrame: () => Promise<void>; width: number; height: number },
) => CameraInstance;

declare global {
  interface Window {
    FaceMesh?: FaceMeshConstructor;
    Camera?: CameraConstructor;
  }
}

const scriptPromises = new Map<string, Promise<void>>();

function loadScript(url: string, id: string): Promise<void> {
  const existing = scriptPromises.get(id);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const loadedScript = document.getElementById(id) as HTMLScriptElement | null;
    if (loadedScript?.dataset.loaded === 'true') {
      resolve();
      return;
    }

    const script = loadedScript ?? document.createElement('script');
    script.id = id;
    script.src = url;
    script.async = true;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`โหลด MediaPipe ไม่สำเร็จ: ${id}`)), { once: true });
    if (!loadedScript) document.head.appendChild(script);
  });

  scriptPromises.set(id, promise);
  return promise;
}

export async function loadMediapipe(): Promise<{
  FaceMesh: FaceMeshConstructor;
  Camera: CameraConstructor;
}> {
  await Promise.all([
    loadScript(faceMeshScriptUrl, 'mediapipe-face-mesh'),
    loadScript(cameraScriptUrl, 'mediapipe-camera-utils'),
  ]);

  if (!window.FaceMesh || !window.Camera) {
    throw new Error('MediaPipe ถูกโหลดแล้วแต่ไม่พบ FaceMesh หรือ Camera');
  }

  return { FaceMesh: window.FaceMesh, Camera: window.Camera };
}
