import { useRef, useState, useEffect } from "react";
import Webcam from "react-webcam";
import { ShieldCheck, Loader2, Settings } from "lucide-react"; // ✅ จุดที่ 1
import { loadMediapipe, type CameraInstance, type FaceMeshInstance, type FaceMeshResults } from '../../services/mediapipe';

interface LandmarkPoint {
  x: number;
  y: number;
}

export default function LivenessScanner({
  onCaptureSuccess,
}: {
  onCaptureSuccess: (imageSrc: string) => void;
}) {
  const webcamRef = useRef<Webcam>(null);
  const [instruction, setInstruction] = useState("กำลังโหลดโมเดล AI...");
  const [isBlinked, setIsBlinked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const hasCapturedRef = useRef(false);

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [error, setError] = useState("");

  const calculateDistance = (p1: LandmarkPoint, p2: LandmarkPoint) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  };

  const getEAR = (landmarks: LandmarkPoint[], eyeIndices: number[]) => {
    const p1 = landmarks[eyeIndices[0]];
    const p2 = landmarks[eyeIndices[1]];
    const p3 = landmarks[eyeIndices[2]];
    const p4 = landmarks[eyeIndices[3]];
    const p5 = landmarks[eyeIndices[4]];
    const p6 = landmarks[eyeIndices[5]];

    const vertical1 = calculateDistance(p2, p6);
    const vertical2 = calculateDistance(p3, p5);
    const horizontal = calculateDistance(p1, p4);

    return (vertical1 + vertical2) / (2.0 * horizontal);
  };

  useEffect(() => {
    getCameras();
    let camera: CameraInstance | null = null;
    let faceMesh: FaceMeshInstance | null = null;
    let cancelled = false;
    let blinkDetectCount = 0;
    let warmUpFrames = 0;

    const waitForVideo = async () => {
      for (let frame = 0; frame < 180; frame += 1) {
        if (cancelled) return null;
        const video = webcamRef.current?.video;
        if (video && video.readyState >= HTMLMediaElement.HAVE_METADATA) return video;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      return null;
    };

    const initialize = async () => {
      try {
        const { FaceMesh, Camera } = await loadMediapipe();
        const video = await waitForVideo();
        if (cancelled || !video) throw new Error('กล้องไม่พร้อมใช้งาน');

        faceMesh = new FaceMesh({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        faceMesh.onResults((results: FaceMeshResults) => {
          setIsLoading(false);

          if (hasCapturedRef.current) return;
          setInstruction('กรุณามองตรงและ "กระพริบตา" 1 ครั้ง');

          if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            if (warmUpFrames < 10) {
              warmUpFrames++;
              return;
            }

            const landmarks = results.multiFaceLandmarks[0];
            const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
            const LEFT_EYE = [362, 385, 387, 263, 373, 380];
            const avgEAR = (getEAR(landmarks, RIGHT_EYE) + getEAR(landmarks, LEFT_EYE)) / 2.0;

            if (avgEAR < 0.22) {
              blinkDetectCount++;
            } else {
              if (blinkDetectCount > 1 && !hasCapturedRef.current) {
                hasCapturedRef.current = true;
                setIsBlinked(true);
                setInstruction("กระพริบตาถูกต้อง! กรุณาลืมตาค้างไว้...");

                setTimeout(() => {
                  const imageSrc = webcamRef.current?.getScreenshot();
                  if (imageSrc) onCaptureSuccess(imageSrc);
                }, 600);
              }
              blinkDetectCount = 0;
            }
          }
        });

        camera = new Camera(video, {
          onFrame: async () => {
            const currentVideo = webcamRef.current?.video;
            if (currentVideo && faceMesh) await faceMesh.send({ image: currentVideo });
          },
          width: 640,
          height: 480,
        });
        await camera.start();
      } catch (initializationError) {
        if (cancelled) return;
        console.error('Unable to initialize MediaPipe', initializationError);
        setError(initializationError instanceof Error ? initializationError.message : 'ไม่สามารถเริ่มระบบตรวจจับใบหน้าได้');
        setIsLoading(false);
      }
    };

    initialize();

    return () => {
      cancelled = true;
      camera?.stop();
      faceMesh?.close();
    };
  }, []);

  const getCameras = async () => {
    try {
      let devices = await navigator.mediaDevices.enumerateDevices();
      let videoDevices = devices.filter((device) => device.kind === "videoinput");

      if (videoDevices.length > 0 && !videoDevices[0].label) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((track) => track.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
        videoDevices = devices.filter((device) => device.kind === "videoinput");
      }

      setCameras(videoDevices);
      if (videoDevices.length > 0) {
        setSelectedCameraId(videoDevices[0].deviceId);
      }
    } catch (err) {
      console.error("Error fetching cameras:", err);
      setError("ไม่สามารถดึงข้อมูลกล้องได้ โปรดตรวจสอบการอนุญาต");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center bg-gray-900 rounded-2xl overflow-hidden relative min-h-[400px] w-full">
      
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/80 z-20 text-white">
          <Loader2 className="animate-spin mb-4" size={48} />
          <p className="font-semibold">กำลังเตรียมระบบตรวจสอบใบหน้า...</p>
        </div>
      )}

      {error && (
        <div role="alert" className="absolute left-4 right-4 top-4 z-30 rounded-lg bg-red-600 px-4 py-3 text-center text-sm font-semibold text-white">
          {error}
        </div>
      )}

      {/* ✅ จุดที่ 3 — Dropdown เลือกกล้อง (แสดงเฉพาะเมื่อมีกล้องมากกว่า 1 ตัว) */}
      {cameras.length > 1 && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2 bg-black/60 rounded-lg px-2 py-1 border border-white/10">
          <Settings className="h-4 w-4 text-gray-400 flex-shrink-0" />
          <select
            className="bg-transparent text-sm text-gray-200 py-1 pr-6 focus:outline-none cursor-pointer max-w-[180px] truncate"
            value={selectedCameraId}
            onChange={(e) => setSelectedCameraId(e.target.value)}
          >
            {cameras.map((cam, index) => (
              <option key={cam.deviceId} value={cam.deviceId} className="bg-gray-900 text-white">
                {cam.label || `กล้องตัวที่ ${index + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ✅ จุดที่ 2 — videoConstraints ใช้ deviceId ที่เลือก */}
      <Webcam
        ref={webcamRef}
        audio={false}
        screenshotFormat="image/jpeg"
        videoConstraints={
          selectedCameraId
            ? { deviceId: { exact: selectedCameraId } }
            : { facingMode: "user" }
        }
        className="w-full h-auto max-h-[500px] object-cover"
      />

      <div
        className={`absolute bottom-8 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-full shadow-xl z-10 flex items-center gap-3 transition-colors duration-300 ${isBlinked ? "bg-green-500 text-white" : "bg-white text-gray-800"}`}
      >
        {isBlinked ? (
          <ShieldCheck size={24} />
        ) : (
          <Loader2 className="animate-spin text-blue-500" size={24} />
        )}
        <span className="font-bold whitespace-nowrap">{instruction}</span>
      </div>
    </div>
  );
}
