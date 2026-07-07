import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaceLandmarker, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";
import api from '../api';

const FaceTester = () => {
  const [modelsLoaded, setModelsLoaded] = useState(false);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const matchedUserRef = useRef(null);
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
        startCamera();
      } catch (err) {
        console.error('Failed to load AI models', err);
      }
    };
    loadModels();
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      alert('ไม่สามารถเข้าถึงกล้องถ่ายรูปได้');
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  // วงจรยิง API ไปถามหลังบ้านทุก 1.5 วินาที
  useEffect(() => {
    let interval;
    if (modelsLoaded) {
      interval = setInterval(async () => {
        if (!videoRef.current || videoRef.current.paused || !videoRef.current.videoWidth) return;
        
        try {
          const detection = await faceapi.detectSingleFace(videoRef.current)
            .withFaceLandmarks()
            .withFaceDescriptor();
          
          if (detection) {
            const embedding = Array.from(detection.descriptor);
            const res = await api.post('/attendance/test-match', { embedding });
            
            if (res.data.match) {
              matchedUserRef.current = res.data.user;
            } else {
              matchedUserRef.current = { full_name: "Unknown", similarity: 0 };
            }
          } else {
            matchedUserRef.current = null;
          }
        } catch (e) {
          console.error("Identify error:", e);
          // แจ้งเตือนบนหัวเมื่อเกิด Error (เช่น ลืมรัน SQL)
          matchedUserRef.current = { full_name: "Error", isError: true };
        }
      }, 1500);
    }
    return () => clearInterval(interval);
  }, [modelsLoaded]);

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
          
          const results = faceLandmarkerRef.current.detectForVideo(videoRef.current, startTimeMs);
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          
          if (results.faceLandmarks) {
            for (const landmarks of results.faceLandmarks) {
              
              drawingUtils.drawConnectors(
                landmarks,
                FaceLandmarker.FACE_LANDMARKS_TESSELATION,
                { color: "#3B82F640", lineWidth: 1 } // สีฟ้า สำหรับโหมดทดสอบ
              );
              drawingUtils.drawConnectors(
                landmarks,
                FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
                { color: "#3B82F6" }
              );

              // คำนวณขอบเขตใบหน้า
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const pt of landmarks) {
                if (pt.x < minX) minX = pt.x;
                if (pt.y < minY) minY = pt.y;
                if (pt.x > maxX) maxX = pt.x;
                if (pt.y > maxY) maxY = pt.y;
              }
              
              const box = {
                x: minX * canvasRef.current.width,
                y: minY * canvasRef.current.height,
                width: (maxX - minX) * canvasRef.current.width,
                height: (maxY - minY) * canvasRef.current.height
              };

              const padX = box.width * 0.4; 
              const padY = box.height * 0.3; 
              const finalX = box.x - padX;
              const finalY = box.y - (padY * 1.3);
              const finalWidth = box.width + (padX * 2);
              const finalHeight = box.height + (padY * 2.3);
              
              ctx.strokeStyle = '#3B82F6';
              ctx.lineWidth = 3;
              ctx.setLineDash([15, 10]);
              ctx.strokeRect(finalX, finalY, finalWidth, finalHeight);

              // วาดชื่อบนหัว
              if (matchedUserRef.current) {
                ctx.setLineDash([]);
                let text = "";
                let isUnknown = false;
                let isError = false;

                if (matchedUserRef.current.isError) {
                   text = "⚠️ DB Error: ลืมรันคำสั่ง SQL หรือเปล่า?";
                   isError = true;
                } else if (matchedUserRef.current.full_name === "Unknown") {
                   text = "❌ ไม่รู้จัก";
                   isUnknown = true;
                } else {
                   text = `✅ ${matchedUserRef.current.full_name} (${(matchedUserRef.current.similarity * 100).toFixed(1)}%)`;
                }
                
                ctx.font = 'bold 20px "Inter", sans-serif';
                if (isError) {
                  ctx.fillStyle = '#EAB308'; // Yellow for error
                } else if (isUnknown) {
                  ctx.fillStyle = '#EF4444'; // Red for unknown
                } else {
                  ctx.fillStyle = '#10B981'; // Green for match
                }
                
                const textWidth = ctx.measureText(text).width;
                const textX = finalX + (finalWidth / 2) - (textWidth / 2);
                const textY = finalY - 15;

                // พื้นหลังข้อความ
                ctx.fillRect(textX - 10, textY - 25, textWidth + 20, 35);
                ctx.fillStyle = isError ? '#000000' : '#FFFFFF'; // อักษรดำบนพื้นเหลือง
                ctx.fillText(text, textX, textY);
              }
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
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path></svg>
        </button>
        <h1 style={{ fontSize: '1.25rem', color: '#3B82F6' }}>ระบบทดสอบ AI ค้นหาใบหน้า</h1>
      </header>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', alignItems: 'center' }}>
        <p style={{ color: 'var(--color-ink-secondary)', fontSize: '0.875rem', textAlign: 'center' }}>
          นำใบหน้าเข้าใกล้กล้อง ระบบจะประมวลผลเทียบกับฐานข้อมูลทุกคนแบบอัตโนมัติ (1-to-N)
        </p>
        
        <div style={{ position: 'relative', width: '100%', maxWidth: '400px', borderRadius: 'var(--radius-lg)', overflow: 'hidden', backgroundColor: '#000', aspectRatio: '3/4' }}>
          <video ref={videoRef} autoPlay muted playsInline onPlay={handleVideoPlay} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
        </div>
      </div>
    </div>
  );
};

export default FaceTester;
