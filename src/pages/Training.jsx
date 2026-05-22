import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Square, Heart, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import cprImg from '../assets/cpr_illustration.png';

// ── WAV Blob生成ユーティリティ ──────────────────────────────────────────────
// Web Audio API（AudioContext）はiOSの"Ambient"カテゴリに割り当てられ、
// 消音スイッチをオフにしても音が出ない。
// HTMLAudioElement はユーザージェスチャー内で play() を呼ぶと
// iOSが"Playback"カテゴリに昇格し、消音スイッチを無視して再生される。
// そのため音声を WAV Blob URL として生成し、<Audio> 要素で再生する。
function createBeepBlobUrl() {
  const sampleRate = 8000;       // Hz
  const duration   = 0.08;       // 80ms
  const freq       = 880;        // Hz (A5)
  const numSamples = Math.floor(sampleRate * duration);
  const dataBytes  = numSamples * 2; // 16-bit PCM = 2 bytes/sample

  const buffer = new ArrayBuffer(44 + dataBytes);
  const view   = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  // RIFFヘッダー
  writeStr(0,  'RIFF');
  view.setUint32(4,  36 + dataBytes, true); // ファイルサイズ - 8
  writeStr(8,  'WAVE');
  // fmtチャンク
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);             // チャンクサイズ (PCM=16)
  view.setUint16(20,  1, true);             // フォーマット (1=PCM)
  view.setUint16(22,  1, true);             // チャンネル数 (1=mono)
  view.setUint32(24, sampleRate, true);     // サンプルレート
  view.setUint32(28, sampleRate * 2, true); // バイトレート (rate×ch×bits/8)
  view.setUint16(32,  2, true);             // ブロックアライン (ch×bits/8)
  view.setUint16(34, 16, true);             // ビット深度
  // dataチャンク
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  // サイン波 + リニア減衰エンベロープ
  for (let i = 0; i < numSamples; i++) {
    const t        = i / sampleRate;
    const envelope = 1 - i / numSamples;   // 1.0 → 0.0 で急速減衰
    const sample   = Math.sin(2 * Math.PI * freq * t) * envelope * 0.8;
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}
// ───────────────────────────────────────────────────────────────────────────

const Training = () => {
  const navigate = useNavigate();
  const audioRef            = useRef(null); // HTMLAudioElement
  const beepUrlRef          = useRef(null); // Blob URL (解放用)
  const metronomeIntervalRef = useRef(null);
  const [isCounting, setIsCounting] = useState(false);

  // マウント時に WAV Blob を生成し Audio 要素を準備
  useEffect(() => {
    const url   = createBeepBlobUrl();
    beepUrlRef.current = url;

    const audio   = new Audio(url);
    audio.preload = 'auto';
    audioRef.current = audio;

    // アンマウント時にリソースを解放
    return () => {
      if (metronomeIntervalRef.current) clearInterval(metronomeIntervalRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (beepUrlRef.current) {
        URL.revokeObjectURL(beepUrlRef.current);
        beepUrlRef.current = null;
      }
    };
  }, []);

  // 1ビート再生（currentTime をリセットして即再生）
  const playBeep = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {}); // 自動再生ブロックは無視（初回はユーザージェスチャー内で呼ぶため問題なし）
  };

  const startTraining = () => {
    setIsCounting(true);
    // ユーザージェスチャーの同期コールスタック内で即時再生
    // → iOSが音声セッションを "Ambient"→"Playback" に昇格し、消音スイッチを無視する
    playBeep();
    if (metronomeIntervalRef.current) clearInterval(metronomeIntervalRef.current);
    metronomeIntervalRef.current = setInterval(playBeep, 60000 / 110);
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
          <h2 style={{ fontSize: '1rem', fontWeight: 900, color: '#333', margin: 0 }}>姿勢復習</h2>
        </div>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#666' }}><ArrowLeft size={24} /></button>
      </div>

      <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '16px', gap: '16px', justifyContent: 'center' }}>
        {/* イラストカード（1画面に収めるためサイズ調整） */}
        <div style={{ background: 'white', borderRadius: '24px', padding: '16px', boxShadow: '0 8px 24px rgba(0,0,0,0.05)', textAlign: 'center' }}>
          <img src={cprImg} alt="CPR" style={{ width: '100%', maxWidth: '240px', height: 'auto', marginBottom: '8px' }} />
          <div style={{ fontSize: '1rem', fontWeight: 900, color: '#FF4B72' }}>目標テンポ: 110回/分</div>
        </div>

        {/* 姿勢ポイント */}
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
      <div style={{ flexShrink: 0, padding: '20px', background: 'white', borderTop: '2px solid #EEE', textAlign: 'center' }}>
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
