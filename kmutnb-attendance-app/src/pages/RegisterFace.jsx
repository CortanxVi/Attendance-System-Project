import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Tesseract from 'tesseract.js';
import { FaceLandmarker, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";
import api from '../api';

const RegisterFace = () => {
  const [step, setStep] = useState(1);
  const [studentId, setStudentId] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [faceLoading, setFaceLoading] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const navigate = useNavigate();

  // Load face-api and MediaPipe models
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
        alert('ไม่สามารถโหลดโมเดล AI ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
      }
    };
    loadModels();
  }, []);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setOcrLoading(true);
    try {
      const result = await Tesseract.recognize(file, 'eng');
      const text = result.data.text;
      console.log("OCR Text Raw:", text); 
      
      let foundId = null;
      const lines = text.split('\n');
      for (const line of lines) {
        const cleanLine = line.replace(/[\s-]/g, '');
        const match = cleanLine.match(/(?:^|\D)(\d{13})(?:\D|$)/);
        if (match) {
          foundId = match[1];
          break;
        }
      }
      
      if (foundId) {
        setStudentId(foundId);
        setStep(2);
        startCamera();
      } else {
        const manualId = window.prompt("AI อ่านรูปบัตรไม่สำเร็จ (ไม่พบเลข 13 หลัก)\nข้อความที่ AI อ่านได้: " + text.replace(/\n/g, ' ').substring(0, 40) + "...\n\nกรุณากรอกรหัสนักศึกษา 13 หลักของคุณด้วยตนเอง:");
        if (manualId && manualId.replace(/[\s-]/g, '').length === 13) {
          setStudentId(manualId.replace(/[\s-]/g, ''));
          setStep(2);
          startCamera();
        } else if (manualId) {
          alert('รหัสนักศึกษาไม่ถูกต้อง (ต้องมี 13 หลัก)');
        }
      }
    } catch (err) {
      console.error('OCR Error:', err);
      alert('เกิดข้อผิดพลาดในการวิเคราะห์บัตร');
    } finally {
      setOcrLoading(false);
      e.target.value = null;
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera error:', err);
      alert('ไม่สามารถเข้าถึงกล้องได้ กรุณาอนุญาตการเข้าถึงกล้องถ่ายรูปในการตั้งค่าเบราว์เซอร์');
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const handleFaceScan = async () => {
    if (!modelsLoaded || !videoRef.current) return;
    
    setFaceLoading(true);
    try {
      // ใช้ faceapi เพื่อสกัดเวกเตอร์ 128 มิติสำหรับส่งไปหลังบ้าน
      const detection = await faceapi.detectSingleFace(videoRef.current)
        .withFaceLandmarks()
        .withFaceDescriptor();
        
      if (!detection) {
        alert('ไม่พบใบหน้า กรุณามองตรงไปที่กล้องในบริเวณที่มีแสงสว่างเพียงพอ');
        setFaceLoading(false);
        return;
      }

      const embedding = Array.from(detection.descriptor);
      stopCamera();

      const res = await api.post('/attendance/register-face', {
        student_id: studentId,
        embedding: embedding
      });

      if (res.data.status === 'success') {
        alert('ลงทะเบียนใบหน้าสำเร็จเรียบร้อย!');
        navigate('/');
      }
    } catch (err) {
      console.error('API Error:', err);
      alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง');
      startCamera();
    } finally {
      setFaceLoading(false);
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
      if (videoRef.current && !videoRef.current.paused && !videoRef.current.ended) {
        let startTimeMs = performance.now();
        if (lastVideoTime !== videoRef.current.currentTime) {
          lastVideoTime = videoRef.current.currentTime;
          
          // ใช้ MediaPipe จับใบหน้าแบบ Real-time
          const results = faceLandmarkerRef.current.detectForVideo(videoRef.current, startTimeMs);
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          
          if (results.faceLandmarks) {
            for (const landmarks of results.faceLandmarks) {
              // วาดเส้นโครงข่ายใบหน้า 478 จุด
              drawingUtils.drawConnectors(
                landmarks,
                FaceLandmarker.FACE_LANDMARKS_TESSELATION,
                { color: "#F4502540", lineWidth: 1 } 
              );
              drawingUtils.drawConnectors(
                landmarks,
                FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
                { color: "#F45025" }
              );
              drawingUtils.drawConnectors(
                landmarks,
                FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
                { color: "#F45025" }
              );
              drawingUtils.drawConnectors(
                landmarks,
                FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
                { color: "#F45025" }
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
              
              ctx.strokeStyle = '#F45025'; // สีส้ม มจพ.
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

  return (
    <div className="container" style={{ padding: 'var(--space-6) 0' }}>
      <header style={{ marginBottom: 'var(--space-6)', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button onClick={() => { stopCamera(); navigate('/'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink-secondary)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5"></path>
            <path d="M12 19l-7-7 7-7"></path>
          </svg>
        </button>
        <h1 style={{ fontSize: '1.25rem' }}>ลงทะเบียนใบหน้า</h1>
      </header>

      {step === 1 && (
        <div className="card" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <h2>1. สแกนบัตรนักศึกษา</h2>
          <p style={{ color: 'var(--color-ink-secondary)', fontSize: '0.875rem' }}>
            ถ่ายรูปหรืออัปโหลดภาพบัตรนักศึกษาของคุณเพื่อดึงข้อมูลรหัสประจำตัว (13 หลัก)
            รูปภาพจะถูกประมวลผลบนเครื่องและลบทิ้งทันทีเพื่อความปลอดภัย
          </p>
          
          <input 
            type="file" 
            accept="image/*" 
            capture="environment" 
            ref={fileInputRef} 
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
          
          <button 
            className="btn btn-primary" 
            onClick={() => fileInputRef.current.click()}
            disabled={ocrLoading}
          >
            {ocrLoading ? 'กำลังวิเคราะห์รูปภาพด้วย OCR...' : 'ถ่ายรูปบัตรนักศึกษา'}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', alignItems: 'center' }}>
          <h2>2. ถ่ายภาพใบหน้า</h2>
          <p style={{ color: 'var(--color-ink-secondary)', fontSize: '0.875rem', textAlign: 'center' }}>
            รหัสนักศึกษาของคุณคือ: <strong style={{ color: 'var(--color-primary)' }}>{studentId}</strong>
            <br />
            กรุณามองตรงไปที่กล้องเพื่อให้กรอบเส้นประปรากฏ
          </p>
          
          <div style={{ position: 'relative', width: '100%', maxWidth: '300px', borderRadius: 'var(--radius-lg)', overflow: 'hidden', backgroundColor: '#000', aspectRatio: '3/4' }}>
            <video 
              ref={videoRef} 
              autoPlay 
              muted 
              playsInline 
              onPlay={handleVideoPlay}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <canvas 
              ref={canvasRef} 
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
            />
          </div>
          
          <button 
            className="btn btn-primary" 
            onClick={handleFaceScan}
            disabled={!modelsLoaded || faceLoading}
          >
            {faceLoading ? 'กำลังสกัดเวกเตอร์ข้อมูล...' : (!modelsLoaded ? 'กำลังเตรียม AI...' : 'บันทึกใบหน้าของฉัน')}
          </button>
        </div>
      )}
    </div>
  );
};

export default RegisterFace;
