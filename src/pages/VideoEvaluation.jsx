import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ArrowLeft, RotateCcw, AlertCircle, Play, Loader2, CheckCircle2, Activity, Zap, Target, Smartphone, User2, Clock } from 'lucide-react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { motion, AnimatePresence } from 'framer-motion';

let globalPoseLandmarker = null;

const VideoEvaluation = () => {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const inputRef = useRef(null);
  const requestRef = useRef(null);
  
  const [videoSrc, setVideoSrc] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [debugLog, setDebugLog] = useState('READY');
  const [debugData, setDebugData] = useState({ tilt: 0, compressions: 0 });
  const [showInstructions, setShowInstructions] = useState(true);
  
  const statsRef = useRef({
    totalFrames: 0, tiltValues: [], bpmValues: [], lastY: 0,
    isMovingDown: false, peakY: 0, lastCompTime: 0, compressions: 0, recentBpms: []
  });
  const isAnalyzingRef = useRef(false);

  useEffect(() => {
    const initModel = async () => {
      if (globalPoseLandmarker) { setIsModelLoaded(true); return; }
      try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        globalPoseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5
        });
        setIsModelLoaded(true);
      } catch (e) { setDebugLog('MODEL LOAD ERROR'); }
    };
    initModel();
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, []);

  useEffect(() => {
    if (showInstructions) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [showInstructions]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setVideoSrc(URL.createObjectURL(file));
      resetStats();
      setProgress(0);
    }
  };

  const resetStats = () => {
    statsRef.current = { totalFrames: 0, tiltValues: [], bpmValues: [], lastY: 0, isMovingDown: false, peakY: 0, lastCompTime: 0, compressions: 0, recentBpms: [] };
    setDebugData({ tilt: 0, compressions: 0 });
    isAnalyzingRef.current = false;
  };

  const startAnalysis = async () => {
    if (!videoRef.current || !globalPoseLandmarker) return;
    setIsProcessing(true);
    isAnalyzingRef.current = true;
    videoRef.current.currentTime = 0;
    try {
      await videoRef.current.play();
      requestRef.current = requestAnimationFrame(predictLoop);
    } catch (e) { 
      setDebugLog('PLAY BLOCKED'); 
      isAnalyzingRef.current = false;
      setIsProcessing(false);
    }
  };

  const predictLoop = () => {
    const video = videoRef.current;
    if (!video || !globalPoseLandmarker || !isAnalyzingRef.current) return;
    
    // 同期精度の向上: 100%に確実に到達させる
    const p = Math.min(100, (video.currentTime / video.duration) * 100);
    setProgress(isNaN(p) ? 0 : p);

    if (video.paused || video.ended) { 
      setProgress(100); // 確実に100%にする
      finalizeAnalysis(); 
      return; 
    }
    
    try {
      const results = globalPoseLandmarker.detectForVideo(video, performance.now());
      if (results.landmarks && results.landmarks.length > 0) {
        processFrame(results.landmarks[0], video.currentTime);
      }
    } catch (e) {}
    requestRef.current = requestAnimationFrame(predictLoop);
  };

  const processFrame = (landmarks, videoTime) => {
    const stats = statsRef.current;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 8; ctx.strokeStyle = "#3EE0C2"; ctx.lineCap = "round";
    [[11,13], [13,15], [12,14], [14,16], [11,12]].forEach(([i, j]) => {
      if (landmarks[i].visibility > 0.3 && landmarks[j].visibility > 0.3) {
        ctx.beginPath(); ctx.moveTo(landmarks[i].x * canvas.width, landmarks[i].y * canvas.height); ctx.lineTo(landmarks[j].x * canvas.width, landmarks[j].y * canvas.height); ctx.stroke();
      }
    });

    const wrist = landmarks[15].visibility > landmarks[16].visibility ? landmarks[15] : landmarks[16];
    const shoulder = landmarks[15].visibility > landmarks[16].visibility ? landmarks[11] : landmarks[12];

    const smoothedY = 0.4 * wrist.y + 0.6 * stats.lastY;
    const diff = smoothedY - stats.lastY;
    stats.lastY = smoothedY;

    const dx = wrist.x - shoulder.x;
    const dy = wrist.y - shoulder.y;
    const currentTilt = Math.abs(Math.atan2(dx, dy) * 180 / Math.PI);
    
    setDebugData(prev => ({ ...prev, tilt: Math.round(currentTilt) }));

    if (videoTime < 3 || videoTime > video.duration - 3) return;

    stats.totalFrames++;

    if (diff > 0.003) {
      stats.isMovingDown = true;
    } else if (stats.isMovingDown && diff < -0.001) {
      const now = performance.now();
      const interval = now - stats.lastCompTime;
      
      if (interval > 400) {
        stats.compressions++;
        stats.tiltValues.push(currentTilt);
        if (stats.lastCompTime > 0) stats.bpmValues.push(60000 / interval);
        stats.lastCompTime = now;
        
        setDebugData(prev => ({ ...prev, compressions: stats.compressions }));
      }
      stats.isMovingDown = false;
    }
  };

  const getMedian = (arr) => {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  const finalizeAnalysis = () => {
    isAnalyzingRef.current = false;
    setIsProcessing(false);
    const s = statsRef.current;
    const medianBpm = getMedian(s.bpmValues);
    const medianTilt = getMedian(s.tiltValues);
    
    const scoreData = {
      compressions: s.compressions,
      medianBpm: Math.round(medianBpm),
      medianTilt: Math.round(medianTilt),
      isBpmOk: medianBpm >= 100 && medianBpm <= 120,
      isTiltOk: medianTilt <= 20
    };
    navigate('/result', { state: { mode: 'video_eval', scoreData, bpm: Math.round(medianBpm), isFinished: true } });
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '16px 20px', background: 'white', borderBottom: '2px solid #EEE', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button onClick={() => navigate('/')} className="circle-btn-std" style={{ width: '40px', height: '40px', background: '#F0F0F0', border: 'none' }}><ArrowLeft size={20} /></button>
        <h1 style={{ fontSize: '1.2rem', fontWeight: 900, margin: 0, color: 'var(--text-dark)' }}>ビデオ精密評価</h1>
      </header>

      <AnimatePresence>
        {showInstructions && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'fixed', inset: 0, background: 'white', zIndex: 2000, overflowY: 'auto', padding: '40px 24px 80px 24px', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'none' }}>
            <div style={{ maxWidth: '500px', margin: '0 auto' }}>
              <header style={{ textAlign: 'center', marginBottom: '40px' }}>
                <div style={{ width: '64px', height: '64px', background: 'var(--secondary)', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}><Camera size={32} color="var(--primary)" /></div>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 900 }}>解析のコツ</h1>
              </header>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '40px' }}>
                <div style={{ background: '#F8F9FA', padding: '24px', borderRadius: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '12px' }}>
                    <User2 color="var(--primary)" size={28} />
                    <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 900 }}>① 真横から全身を写してください</h4>
                  </div>
                  <div style={{
                    position: 'relative',
                    width: '180px',
                    margin: '0 auto',
                    aspectRatio: '9/19.5',
                    background: '#1a1a1a',
                    borderRadius: '30px',
                    boxShadow: '0 20px 40px rgba(0,0,0,0.2), inset 0 0 0 2px #444, inset 0 0 0 4px #111',
                    boxSizing: 'border-box'
                  }}>
                    <div style={{
                      position: 'absolute',
                      top: '8px',
                      left: '8px',
                      right: '8px',
                      bottom: '8px',
                      background: '#000',
                      borderRadius: '22px',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      isolation: 'isolate',
                      transform: 'translateZ(0)',
                      WebkitMaskImage: '-webkit-radial-gradient(white, black)'
                    }}>
                      {/* ダイナミックアイランド */}
                      <div style={{
                        position: 'absolute',
                        top: '8px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: '32%',
                        height: '16px',
                        background: '#000',
                        borderRadius: '12px',
                        zIndex: 10
                      }}></div>
                      {/* カメラUI 上部 */}
                      <div style={{ flexShrink: 0, height: '44px', background: 'rgba(0,0,0,0.4)', zIndex: 5, display: 'flex', justifyContent: 'center', alignItems: 'flex-end', paddingBottom: '6px', boxSizing: 'border-box' }}>
                         <div style={{ color: 'white', fontSize: '10px', fontWeight: 'bold' }}>00:00:00</div>
                      </div>
                      {/* プレビュー画面 */}
                      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#fff' }}>
                        <img src="/images/cpr_illustration_v3.png" alt="真横からの撮影例" style={{ 
                          width: '100%', 
                          height: '100%', 
                          objectFit: 'cover',
                          objectPosition: 'center 45%',
                          transform: 'scale(1.3)'
                        }} />
                        {/* ピント枠 */}
                        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '80px', height: '80px', border: '1px solid rgba(255,204,0,0.8)', boxSizing: 'border-box' }}>
                          <div style={{ position: 'absolute', top: '-5px', left: '50%', transform: 'translateX(-50%)', width: '2px', height: '10px', background: 'rgba(255,204,0,0.8)' }}></div>
                          <div style={{ position: 'absolute', bottom: '-5px', left: '50%', transform: 'translateX(-50%)', width: '2px', height: '10px', background: 'rgba(255,204,0,0.8)' }}></div>
                          <div style={{ position: 'absolute', left: '-5px', top: '50%', transform: 'translateY(-50%)', width: '10px', height: '2px', background: 'rgba(255,204,0,0.8)' }}></div>
                          <div style={{ position: 'absolute', right: '-5px', top: '50%', transform: 'translateY(-50%)', width: '10px', height: '2px', background: 'rgba(255,204,0,0.8)' }}></div>
                        </div>
                      </div>
                      {/* カメラUI 下部 */}
                      <div style={{ flexShrink: 0, height: '60px', background: 'rgba(0,0,0,0.8)', zIndex: 5, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        {/* シャッターボタン */}
                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', border: '2px solid white', display: 'flex', justifyContent: 'center', alignItems: 'center', boxSizing: 'border-box' }}>
                          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'white' }}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ background: '#F8F9FA', padding: '24px', borderRadius: '24px', display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <Clock color="var(--primary)" size={28} />
                  <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 900 }}>② 動画は20秒程度が推奨です</h4>
                </div>
                <div style={{ background: '#FFF0F3', padding: '24px', borderRadius: '24px', display: 'flex', gap: '16px', border: '2px solid #FFD1DC' }}>
                  <AlertCircle color="var(--primary)" size={28} style={{ flexShrink: 0 }} />
                  <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 'bold', color: '#333', lineHeight: 1.5 }}>
                    撮影環境（距離など）によっては正しく測定出来ない場合があります。その場合はもう一度撮影してみてください。
                  </p>
                </div>
              </div>

              <button onClick={() => setShowInstructions(false)} className="btn-pop" style={{ width: '100%', padding: '18px', fontSize: '1.1rem' }}>
                確認しました
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: '800px', aspectRatio: '16/9', background: '#000', borderRadius: '24px', overflow: 'hidden' }}>
          {videoSrc ? (
            <>
              <video ref={videoRef} src={videoSrc} style={{ width: '100%', height: '100%', objectFit: 'contain' }} playsInline muted />
              <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
              {isProcessing && (
                <div style={{ position: 'absolute', bottom: '20px', left: '20px', right: '20px' }}>
                  <div style={{ height: '8px', background: 'rgba(255,255,255,0.2)', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
                    <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} style={{ height: '100%', background: 'var(--secondary)' }} />
                  </div>
                  <div style={{ color: 'white', fontSize: '0.75rem', fontWeight: 900, textAlign: 'center' }}>解析中: {Math.round(progress)}%</div>
                </div>
              )}
            </>
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
              <Activity size={40} color="var(--secondary)" style={{ marginBottom: '16px' }} />
              <p style={{ fontWeight: 900 }}>動画を選択してください</p>
            </div>
          )}
        </div>

        <div style={{ width: '100%', maxWidth: '800px', marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <input type="file" accept="video/*" ref={inputRef} onChange={handleFileChange} style={{ display: 'none' }} />
          <button className="btn-pop secondary" onClick={() => inputRef.current.click()}>動画を選択</button>
          {videoSrc && !isProcessing && <button className="btn-pop" onClick={startAnalysis}>解析を開始</button>}
        </div>

        <div style={{ width: '100%', maxWidth: '800px', marginTop: '20px', background: 'white', padding: '16px', borderRadius: '16px', border: '2px solid #EEE', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 900 }}>現在の傾き: {debugData.tilt}°</div>
          <div style={{ fontSize: '0.8rem', fontWeight: 900 }}>圧迫回数: {debugData.compressions}回</div>
        </div>
      </main>
    </div>
  );
};

export default VideoEvaluation;
