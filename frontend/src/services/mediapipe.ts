import faceMeshScriptUrl from '@mediapipe/face_mesh/face_mesh.js?url';
import binaryGraphUrl from '@mediapipe/face_mesh/face_mesh.binarypb?url';
import packedAssetsUrl from '@mediapipe/face_mesh/face_mesh_solution_packed_assets.data?url';
import packedAssetsLoaderUrl from '@mediapipe/face_mesh/face_mesh_solution_packed_assets_loader.js?url';
import simdDataUrl from '@mediapipe/face_mesh/face_mesh_solution_simd_wasm_bin.data?url';
import simdScriptUrl from '@mediapipe/face_mesh/face_mesh_solution_simd_wasm_bin.js?url';
import simdWasmUrl from '@mediapipe/face_mesh/face_mesh_solution_simd_wasm_bin.wasm?url';
import wasmScriptUrl from '@mediapipe/face_mesh/face_mesh_solution_wasm_bin.js?url';
import wasmUrl from '@mediapipe/face_mesh/face_mesh_solution_wasm_bin.wasm?url';

export interface FaceMeshResults {
  multiFaceLandmarks?: Array<Array<{ x: number; y: number; z?: number }>>;
}

export interface FaceMeshInstance {
  setOptions(options: Record<string, boolean | number>): void;
  onResults(callback: (results: FaceMeshResults) => void): void;
  send(input: { image: HTMLVideoElement }): Promise<void>;
  close(): void;
}

type FaceMeshConstructor = new (options: { locateFile: (file: string) => string }) => FaceMeshInstance;

declare global {
  interface Window {
    FaceMesh?: FaceMeshConstructor;
  }
}

const localAssets: Record<string, string> = {
  'face_mesh.binarypb': binaryGraphUrl,
  'face_mesh_solution_packed_assets.data': packedAssetsUrl,
  'face_mesh_solution_packed_assets_loader.js': packedAssetsLoaderUrl,
  'face_mesh_solution_simd_wasm_bin.data': simdDataUrl,
  'face_mesh_solution_simd_wasm_bin.js': simdScriptUrl,
  'face_mesh_solution_simd_wasm_bin.wasm': simdWasmUrl,
  'face_mesh_solution_wasm_bin.js': wasmScriptUrl,
  'face_mesh_solution_wasm_bin.wasm': wasmUrl,
};

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const id = 'mediapipe-face-mesh';
    const loadedScript = document.getElementById(id) as HTMLScriptElement | null;
    if (loadedScript?.dataset.loaded === 'true') {
      resolve();
      return;
    }
    const script = loadedScript ?? document.createElement('script');
    script.id = id;
    script.src = faceMeshScriptUrl;
    script.async = true;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('โหลดโมเดลตรวจจับใบหน้าไม่สำเร็จ')), { once: true });
    if (!loadedScript) document.head.appendChild(script);
  });
  return scriptPromise;
}

export async function loadMediapipe(): Promise<{ FaceMesh: FaceMeshConstructor }> {
  await loadScript();
  if (!window.FaceMesh) throw new Error('โหลดโมเดลแล้วแต่ไม่พบ FaceMesh');
  return { FaceMesh: window.FaceMesh };
}

export function locateFaceMeshAsset(file: string): string {
  const asset = localAssets[file];
  if (!asset) throw new Error(`ไม่พบไฟล์โมเดลในเครื่อง: ${file}`);
  return asset;
}
