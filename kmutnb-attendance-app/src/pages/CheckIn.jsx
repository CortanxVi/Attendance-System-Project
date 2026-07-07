import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { FaceLandmarker, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";
import api from '../api';

const CheckIn = () => {
  const [step, setStep] = useState('qr');
  const [qrData, setQrData] = useState(null);
  const [location, setLocation] = useState(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const scannerRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const loadModels = async () => {
      try {
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
          faceapi.nets.faceRecognitionNet.loadFromUri('/models')
        ]);
        
        // Load MediaPipe Vision
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
          },
          outputFaceBlendshapes: true,
          runningMode: "VIDEO",
          numFaces: 1
        });

        setModelsLoaded(true);
      } catch (err) {
        console.error('Failed to load AI models', err);
      }
    };
    loadModels();
  }, []);

  useEffect(() => {
    if (step === 'qr') {
      const scanner = new Html5QrcodeScanner(
        "qr-reader",
        { fps: 10, qrbox: { width: 250, height: 250 } },
        false
      );
      
      scannerRef.current = scanner;

      scanner.render((decodedText) => {
        try {
          const payload = JSON.parse(decodedText);
          if (payload.s && payload.t) {
            scanner.clear();
            setQrData({ sessionId: payload.s, token: payload.t });
            setStep('gps');
            getGeolocation();
          }
        } catch (e) {
          console.warn("Invalid QR code format");
        }
      }, (error) => {});

      return () => {
        scanner.clear().catch(e => console.error(e));
      };
    }
  }, [step]);

  const getGeolocation = () => {
    if (!navigator.geolocation) {
      alert("อุปกรณ์ของคุณไม่รองรับการส่งพิกัด GPS");
      setStep('qr');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        setStep('face');
        startFaceCamera();
      },
      (error) => {
        console.error("GPS Error", error);
        alert("ไม่สามารถดึงตำแหน่งพิกัดได้ กรุณาอนุญาตให้แอปเข้าถึงตำแหน่งที่ตั้ง (Location) ของคุณ");
        setStep('qr');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const startFaceCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      alert('ไม่สามารถเข้าถึงกล้องถ่ายรูปได้');
    }
  };

  const stopFaceCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
  };

  const handleFaceScanAndSubmit = async () => {
    if (!modelsLoaded || !videoRef.current) return;
    
    setStep('submitting');
    try {
      const detection = await faceapi.detectSingleFace(videoRef.current)
        .withFaceLandmarks()
        .withFaceDescriptor();
        
      if (!detection) {
        alert('ไม่พบใบหน้า กรุณามองที่กล้องในบริเวณที่มีแสงเพียงพอและลองใหม่อีกครั้ง');
        setStep('face');
        return;
      }

      const embedding = Array.from(detection.descriptor);
      stopFaceCamera();

      const res = await api.post('/attendance/check-in', {
        session_id: qrData.sessionId,
        qr_token: qrData.token,
        latitude: location.lat,
        longitude: location.lng,
        embedding: embedding
      });

      if (res.data.status === 'success') {
        setStep('success');
      }
    } catch (err) {
      const errMsg = err.response?.data?.detail || 'เกิดข้อผิดพลาดในการเช็คชื่อ กรุณาลองใหม่อีกครั้ง';
      alert(errMsg);
      setStep('qr');
      stopFaceCamera();
    }
  };

  const handleVideoPlay = () => {
    if (!videoRef.current || !canvasRef.current || !modelsLoaded || !faceLandmarkerRef.current) return;
    
    const displaySize = { width: videoRef.current.videoWidth, height: videoRef.current.videoHeight };
    canvasRef.current.width = displaySize.width;
    canvasRef.current.height = displaySize.height;

    const ctx = canvasRef.current.getContext('2d');
    const drawingUtils = new DrawingUtils(ctx);
    let lastVideoTime = -1;

    const drawLoop = async () => {
      if (videoRef.current && !videoRef.current.paused && !videoRef.current.ended && step === 'face') {
        let startTimeMs = performance.now();
        if (lastVideoTime !== videoRef.current.currentTime) {
          lastVideoTime = videoRef.current.currentTime;
          
          const results = faceLandmarkerRef.current.detectForVideo(videoRef.current, startTimeMs);
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          
          if (results.faceLandmarks) {
            for (const landmarks of results.faceLandmarks) {
              // วาดโครงหน้าเป็นสีเขียว (Success Green) แทนสีส้ม เพื่อให้เข้ากับการเช็คชื่อ
              drawingUtils.drawConnectors(
                landmarks,
                FaceLandmarker.FACE_LANDMARKS_TESSELATION,
                { color: "#10B98140", lineWidth: 1 } 
              );
              drawingUtils.drawConnectors(
                landmarks,
                FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
                { color: "#10B981" }
              );
              drawingUtils.drawConnectors(
                landmarks,
                FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
                { color: "#10B981" }
              );
              drawingUtils.drawConnectors(
                landmarks,
                FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
                { color: "#10B981" }
              );

              // คำนวณหาขอบเขตใบหน้าทั้งหมด (Bounding Box) จากจุด 478 จุด
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const pt of landmarks) {
                if (pt.x < minX) minX = pt.x;
                if (pt.y < minY) minY = pt.y;
                if (pt.x > maxX) maxX = pt.x;
                if (pt.y > maxY) maxY = pt.y;
              }
              
              // แปลงเป็นพิกัดหน้าจอ
              const box = {
                x: minX * canvasRef.current.width,
                y: minY * canvasRef.current.height,
                width: (maxX - minX) * canvasRef.current.width,
                height: (maxY - minY) * canvasRef.current.height
              };

              // ขยายขนาดกรอบให้ออกไปครอบคลุมถึงทรงผมและหู (เพิ่ม Padding เยอะขึ้น)
              const padX = box.width * 0.4; // ขยายด้านข้าง 40% (เผื่อหูและกราม)
              const padY = box.height * 0.3; // ขยายด้านบน/ล่าง 30% (เผื่อทรงผม)
              
              ctx.strokeStyle = '#10B981'; // สีเขียว Success
              ctx.lineWidth = 3;
              ctx.setLineDash([15, 10]);
              ctx.strokeRect(
                box.x - padX, 
                box.y - (padY * 1.3), // เผื่อด้านบนทรงผมเยอะกว่าคางนิดหน่อย
                box.width + (padX * 2), 
                box.height + (padY * 2.3)
              );
            }
          }
        }
        requestAnimationFrame(drawLoop);
      }
    };
    
    drawLoop();
  };

  useEffect(() => {
    return () => stopFaceCamera();
  }, []);

  return (
    <div className="container" style={{ padding: 'var(--space-6) 0' }}>
      <header style={{ marginBottom: 'var(--space-6)', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button onClick={() => { stopFaceCamera(); navigate('/'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink-secondary)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path></svg>
        </button>
        <h1 style={{ fontSize: '1.25rem' }}>เช็คชื่อเข้าเรียน</h1>
      </header>

      {step === 'qr' && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', alignItems: 'center' }}>
          <h2>1. สแกน QR Code</h2>
          <p style={{ color: 'var(--color-ink-secondary)', fontSize: '0.875rem', textAlign: 'center' }}>
            ใช้กล้องเพื่อสแกน QR Code บนหน้าจอของอาจารย์
          </p>
          <div id="qr-reader" style={{ width: '100%', maxWidth: '400px', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}></div>
        </div>
      )}

      {step === 'gps' && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)' }}>
          <h2 style={{ color: 'var(--color-primary)' }}>กำลังระบุพิกัด...</h2>
          <p style={{ color: 'var(--color-ink-secondary)', marginTop: 'var(--space-2)' }}>ระบบกำลังคำนวณพิกัด GPS เพื่อยืนยันว่าคุณอยู่ในระยะ 50 เมตรจากห้องเรียน</p>
        </div>
      )}

      {(step === 'face' || step === 'submitting') && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', alignItems: 'center' }}>
          <h2>2. ยืนยันด้วยใบหน้า</h2>
          <p style={{ color: 'var(--color-ink-secondary)', fontSize: '0.875rem', textAlign: 'center' }}>
            ยืนยันตัวตนด้วยใบหน้าของคุณเพื่อเสร็จสิ้นการบันทึกข้อมูล
          </p>
          
          <div style={{ position: 'relative', width: '100%', maxWidth: '300px', borderRadius: 'var(--radius-lg)', overflow: 'hidden', backgroundColor: '#000', aspectRatio: '3/4' }}>
            <video ref={videoRef} autoPlay muted playsInline onPlay={handleVideoPlay} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
          </div>
          
          <button className="btn btn-primary" onClick={handleFaceScanAndSubmit} disabled={!modelsLoaded || step === 'submitting'}>
            {step === 'submitting' ? 'กำลังประมวลผลเซิร์ฟเวอร์...' : 'เช็คชื่อเข้าเรียนเลย'}
          </button>
        </div>
      )}

      {step === 'success' && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)', backgroundColor: 'var(--color-success-bg)', border: '1px solid var(--color-success)' }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto var(--space-4) auto', display: 'block' }}>
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <h2 style={{ color: 'var(--color-success-ink)' }}>เช็คชื่อสำเร็จแล้ว!</h2>
          <p style={{ color: 'var(--color-success-ink)', marginTop: 'var(--space-2)', opacity: 0.9 }}>
            ข้อมูลภาพถ่ายและพิกัดของคุณถูกต้อง ระบบได้ทำการบันทึกประวัติการเข้าเรียนของคุณแล้ว
          </p>
          <button className="btn btn-primary" style={{ marginTop: 'var(--space-6)', backgroundColor: 'var(--color-success)' }} onClick={() => navigate('/')}>
            กลับสู่หน้าหลัก
          </button>
        </div>
      )}
    </div>
  );
};

export default CheckIn;
