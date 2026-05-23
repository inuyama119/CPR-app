import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Square, Heart, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import cprImg from '../assets/cpr_illustration.png';

// ── WAV Blob 生成 ──────────────────────────────────────────────────────────────
function createBeepBlobUrl() {
  const sampleRate = 8000;
  const duration   = 0.08;   // 80ms
  const freq       = 880;    // A5
  const numSamples = Math.floor(sampleRate * duration);
  const dataBytes  = numSamples * 2;

  const buffer = new ArrayBuffer(44 + dataBytes);
  const view   = new DataView(buffer);
  const ws = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  ws(0,  'RIFF'); view.setUint32(4,  36 + dataBytes, true); ws(8, 'WAVE');
  ws(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ws(36, 'data'); view.setUint32(40, dataBytes, true);

  for (let i = 0; i < numSamples; i++) {
    const t        = i / sampleRate;
    const envelope = 1 - i / numSamples;
    const sample   = Math.sin(2 * Math.PI * freq * t) * envelope;
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}
// ─────────────────────────────────────────────────────────────────────────────

// ── タイミング設計 ────────────────────────────────────────────────────────────
// ❌ setInterval: JSイベントループ依存 → 各ビートの誤差が累積してズレる
// ✅ ルックアヘッドスケジューラ:
//      - AudioContext.currentTime（ハードウェアクロック）で絶対時刻を管理
//      - 25ms ごとに scheduler() を呼び出し
//      - 今後 100ms 以内のビートを setTimeout でキューイング
//      - 各ビートは独立した絶対時刻を持つ → 累積誤差なし
// ✅ iOS 消音モード:
//      - ユーザージェスチャー内で HTMLAudioElement.play() を呼ぶと
//        iOS の音声セッションが "Playback" カテゴリに昇格し、消音スイッチを無視
//      - 1ビート目だけ startTraining() 内で同期再生してセッションを昇格
//      - 以降の setTimeout からの play() も Playback セッション内で動作
// ─────────────────────────────────────────────────────────────────────────────
const BPM            = 110;
const BEAT_INTERVAL  = 60 / BPM;  // ~0.5454 秒
const SCHEDULE_AHEAD = 0.10;      // 100ms 先まで先読み
const LOOKAHEAD_MS   = 25;        // スケジューラのポーリング間隔

const Training = () => {
  const navigate = useNavigate();
  const beepUrlRef        = useRef(null); // WAV Blob URL
  const audioCtxRef       = useRef(null); // AudioContext（クロック用）
  const nextBeatTimeRef   = useRef(0);    // 次のビートの絶対時刻（秒）
  const schedulerTimerRef = useRef(null); // ルックアヘッドループの setTimeout ID
  const [isCounting, setIsCounting] = useState(false);

  useEffect(() => {
    const url = createBeepBlobUrl();
    beepUrlRef.current = url;

    return () => {
      clearTimeout(schedulerTimerRef.current);
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
      URL.revokeObjectURL(url);
      beepUrlRef.current = null;
    };
  }, []);

  // 1ビート再生
  // 毎回フレッシュな Audio 要素を生成することで、要素の状態（ended / seeking）に
  // 依存しない確実な再生を保証する。Blob URL は共有なので実データのコピーなし。
  const playBeep = () => {
    const url = beepUrlRef.current;
    if (!url) return;
    new Audio(url).play().catch(() => {});
  };

  // ルックアヘッドスケジューラ
  // nextBeatTimeRef が示す絶対時刻を基点に、SCHEDULE_AHEAD 秒先までのビートを
  // setTimeout でキューイング。setInterval と異なり誤差が累積しない。
  const scheduler = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    while (nextBeatTimeRef.current < ctx.currentTime + SCHEDULE_AHEAD) {
      const delayMs = Math.max(0, (nextBeatTimeRef.current - ctx.currentTime) * 1000);
      setTimeout(playBeep, delayMs);
      nextBeatTimeRef.current += BEAT_INTERVAL;
    }

    schedulerTimerRef.current = setTimeout(scheduler, LOOKAHEAD_MS);
  };

  const startTraining = () => {
    setIsCounting(true);

    // AudioContext 生成・再開（ユーザージェスチャー内、同期）
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    audioCtxRef.current.resume();

    // 1ビート目: ユーザージェスチャーの同期スタック内で即時再生
    // → iOS セッションを "Playback" に昇格させ、消音スイッチを無視させる
    playBeep();

    // 2ビート目以降: ルックアヘッドスケジューラで精密タイミング
    clearTimeout(schedulerTimerRef.current);
    nextBeatTimeRef.current = audioCtxRef.current.currentTime + BEAT_INTERVAL;
    scheduler();
  };

  const stopTraining = () => {
    setIsCounting(false);
    clearTimeout(schedulerTimerRef.current);
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
        {/* イラストカード */}
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
