import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Square, Heart, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import cprImg from '../assets/cpr_illustration.png';

const Training = () => {
  const navigate = useNavigate();
  const audioCtxRef = useRef(null);
  const metronomeIntervalRef = useRef(null);
  const [isCounting, setIsCounting] = useState(false);

  useEffect(() => {
    return () => {
      if (metronomeIntervalRef.current) clearInterval(metronomeIntervalRef.current);
    };
  }, []);

  const playMetronomeSound = () => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtxRef.current.createOscillator();
    const gain = audioCtxRef.current.createGain();
    osc.connect(gain); gain.connect(audioCtxRef.current.destination);
    osc.frequency.setValueAtTime(880, audioCtxRef.current.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtxRef.current.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtxRef.current.currentTime + 0.05);
    osc.start(); osc.stop(audioCtxRef.current.currentTime + 0.05);
  };

  const startTraining = () => {
    setIsCounting(true);
    if (metronomeIntervalRef.current) clearInterval(metronomeIntervalRef.current);
    metronomeIntervalRef.current = setInterval(playMetronomeSound, 60000 / 110);
  };

  const stopTraining = () => {
    setIsCounting(false);
    if (metronomeIntervalRef.current) clearInterval(metronomeIntervalRef.current);
  };

  return (
    <div style={{ height: '100dvh', background: '#F8F9FA', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* コンパクトなヘッダー */}
      <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Heart size={18} color="#FF4B72" fill="#FF4B72" />
          <h2 style={{ fontSize: '1rem', fontWeight: 900, color: '#333', margin: 0 }}>姿勢復習 (110BPM)</h2>
        </div>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#666' }}><ArrowLeft size={24} /></button>
      </div>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px', gap: '16px', justifyContent: 'center' }}>
        {/* イラストカード（1画面に収めるためサイズ調整） */}
        <div style={{ background: 'white', borderRadius: '24px', padding: '16px', boxShadow: '0 8px 24px rgba(0,0,0,0.05)', textAlign: 'center' }}>
          <img src={cprImg} alt="CPR" style={{ width: '100%', maxWidth: '240px', height: 'auto', marginBottom: '8px' }} />
          <div style={{ fontSize: '1rem', fontWeight: 900, color: '#FF4B72' }}>目標テンポ: 110回/分</div>
        </div>

        {/* 簡略化した姿勢ポイント */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
          <div style={{ background: 'white', padding: '12px 16px', borderRadius: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
            <CheckCircle2 color="#3EE0C2" size={20} />
            <p style={{ fontWeight: 900, fontSize: '0.9rem', margin: 0 }}>腕を垂直に伸ばし、肘を曲げない</p>
          </div>
          <div style={{ background: 'white', padding: '12px 16px', borderRadius: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
            <CheckCircle2 color="#3EE0C2" size={20} />
            <p style={{ fontWeight: 900, fontSize: '0.9rem', margin: 0 }}>手の付け根（手根部）で強く押す</p>
          </div>
          <div style={{ background: 'white', padding: '12px 16px', borderRadius: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
            <CheckCircle2 color="#3EE0C2" size={20} />
            <p style={{ fontWeight: 900, fontSize: '0.9rem', margin: 0 }}>5cm沈む強さで絶え間なく圧迫</p>
          </div>
        </div>
      </main>

      {/* フッター操作（常に下部に固定） */}
      <div style={{ padding: '20px', background: 'white', borderTop: '2px solid #EEE', textAlign: 'center' }}>
        <AnimatePresence mode="wait">
          {!isCounting ? (
            <motion.button 
              key="start"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              onClick={startTraining} 
              className="btn-pop" 
              style={{ width: '100%', fontSize: '1.2rem', padding: '16px' }}
            >
              <Play size={24} fill="white" /> 練習を開始する
            </motion.button>
          ) : (
            <motion.button 
              key="stop"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              onClick={stopTraining} 
              className="btn-pop secondary" 
              style={{ width: '100%', fontSize: '1.2rem', padding: '16px', background: '#333' }}
            >
              <Square size={24} fill="white" /> 停止する
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Training;
