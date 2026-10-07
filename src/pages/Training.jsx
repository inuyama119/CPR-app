import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Square, Heart, Activity, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import cprImg from '../assets/cpr_illustration.png';
import { MotionSignal, BeatDetector, median } from '../lib/cpr-rhythm-core.js';

// ── WAV Blob 生成 ──────────────────────────────────────────────────────────────
function createBeepBlobUrl() {
  const sampleRate = 8000;
  const duration   = 0.08;
  const freq       = 880;
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

// ── 定数 ──────────────────────────────────────────────────────────────────────
const BPM_TARGET     = 110;
const BEAT_INTERVAL  = 60 / BPM_TARGET;  // ~0.5454 秒
const SCHEDULE_AHEAD = 0.10;             // 100ms 先まで先読み
const LOOKAHEAD_MS   = 25;              // スケジューラのポーリング間隔

const CAM_W          = 160;
const CAM_H          = 120;
const SAMPLE_KEEP_MS = 6000;
const UI_UPDATE_MS   = 250;
const MAX_INTERVALS  = 8;
const WARMUP_MS      = 1500;
// ─────────────────────────────────────────────────────────────────────────────

const BPM_LOW  = 100;
const BPM_HIGH = 120;

const C_SLOW = '#F59E0B';
const C_GOOD = '#10B981';
const C_FAST = '#3B82F6';

function getBpmStatus(bpm) {
  if (!bpm) return null;
  if (bpm < BPM_LOW)  return { key: 'slow', text: 'もう少し速く',       color: C_SLOW };
  if (bpm > BPM_HIGH) return { key: 'fast', text: '少しゆっくり',       color: C_FAST };
  return                     { key: 'good', text: 'よい圧迫テンポです', color: C_GOOD };
}

// ── ゲージ ────────────────────────────────────────────────────────────────────
// 半円の弧（左端 = GAUGE_MIN、右端 = GAUGE_MAX）。
// 3ゾーンが同じ幅になるよう、緑帯(100〜120)の幅20を3つ並べた 80〜140 を範囲にする。
// → おそい 80-100 / よい 100-120 / はやい 120-140、中央がちょうど目標の110。
const GAUGE_MIN = BPM_LOW  - (BPM_HIGH - BPM_LOW);  // 80
const GAUGE_MAX = BPM_HIGH + (BPM_HIGH - BPM_LOW);  // 140
const GAUGE_R   = 72;

const gaugeT = (b) => Math.min(1, Math.max(0, (b - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)));

// t=0 が左端、t=1 が右端。SVG は y 軸が下向きなので sin を引く。
const polarPt = (r, t) => {
  const th = Math.PI - t * Math.PI;
  return [100 + r * Math.cos(th), 100 - r * Math.sin(th)];
};

const arcPath = (r, t0, t1) => {
  const [x0, y0] = polarPt(r, t0);
  const [x1, y1] = polarPt(r, t1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${t1 - t0 > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

const T_LOW  = gaugeT(BPM_LOW);   // 0.40
const T_HIGH = gaugeT(BPM_HIGH);  // 0.60
const GAP    = 0.012;             // ゾーン間のすき間

const Training = () => {
  const navigate = useNavigate();

  // ── メトロノーム refs ───────────────────────────────────────────────────────
  const beepUrlRef        = useRef(null);
  const audioCtxRef       = useRef(null);
  const nextBeatTimeRef   = useRef(0);
  const schedulerTimerRef = useRef(null);

  // ── カメラ・解析 refs ───────────────────────────────────────────────────────
  const videoRef          = useRef(null);   // <video> DOM要素
  const offscreenCanvas   = useRef(null);   // 160×120 オフスクリーン canvas
  const streamRef         = useRef(null);   // MediaStream
  const rafRef            = useRef(null);   // rAF ID（フォールバック時）
  const vfcIdRef          = useRef(null);   // requestVideoFrameCallback ID
  const runningRef        = useRef(false);  // フレームループ継続フラグ
  const runIdRef          = useRef(0);      // 開始世代。停止後に古い非同期処理を無効化する
  const beepTimersRef     = useRef([]);     // 予約済みビープの setTimeout ID
  const signalRef         = useRef(null);   // MotionSignal
  const detectorRef       = useRef(null);   // BeatDetector
  const samplesRef        = useRef([]);     // 直近 6 秒のサンプル
  const intervalsRef      = useRef([]);     // 直近 8 拍の間隔 (ms)
  const beatCountRef      = useRef(0);
  const startTimeRef      = useRef(0);
  const lastUiTimeRef     = useRef(0);

  // ── state ──────────────────────────────────────────────────────────────────
  const [isCounting,     setIsCounting]     = useState(false);
  const [bpm,            setBpm]            = useState(null);
  const [beatCount,      setBeatCount]      = useState(0);
  const [motionDetected, setMotionDetected] = useState(false);
  const [cameraError,    setCameraError]    = useState(null);

  // ── メトロノーム ────────────────────────────────────────────────────────────
  const playBeep = () => {
    const url = beepUrlRef.current;
    if (!url) return;
    new Audio(url).play().catch(() => {});
  };

  // 予約済みビープは stop 時に取り消せるよう ID を保持する。
  // 発火したものは自分で配列から外すので、配列には未発火分しか残らない。
  const scheduleBeep = (delayMs) => {
    const id = setTimeout(() => {
      beepTimersRef.current = beepTimersRef.current.filter(x => x !== id);
      playBeep();
    }, delayMs);
    beepTimersRef.current.push(id);
  };

  const scheduler = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    while (nextBeatTimeRef.current < ctx.currentTime + SCHEDULE_AHEAD) {
      const delayMs = Math.max(0, (nextBeatTimeRef.current - ctx.currentTime) * 1000);
      scheduleBeep(delayMs);
      nextBeatTimeRef.current += BEAT_INTERVAL;
    }
    schedulerTimerRef.current = setTimeout(scheduler, LOOKAHEAD_MS);
  };

  // ── 1コマ解析 ───────────────────────────────────────────────────────────────
  const grabFrame = () => {
    const video  = videoRef.current;
    const canvas = offscreenCanvas.current;
    if (!video || video.readyState < 2 || !canvas) return;

    const ctx2d = canvas.getContext('2d', { willReadFrequently: true });
    ctx2d.drawImage(video, 0, 0, CAM_W, CAM_H);
    const rgba = ctx2d.getImageData(0, 0, CAM_W, CAM_H).data;
    const t    = performance.now();

    const sample = signalRef.current.push(rgba, t);
    samplesRef.current.push(sample);
    while (samplesRef.current[0]?.t < t - SAMPLE_KEEP_MS) samplesRef.current.shift();

    const beat    = detectorRef.current.push(sample);
    const inWarmup = t - startTimeRef.current < WARMUP_MS;

    if (beat && !inWarmup) {
      beatCountRef.current += 1;
      if (beat.intervalMs !== null && beat.intervalMs < 2000) {
        intervalsRef.current.push(beat.intervalMs);
        if (intervalsRef.current.length > MAX_INTERVALS) intervalsRef.current.shift();
      }
    }

    // UI 更新を 250ms ごとに制限
    if (t - lastUiTimeRef.current >= UI_UPDATE_MS) {
      lastUiTimeRef.current = t;

      const m = median(intervalsRef.current);
      setBpm(m ? Math.round(60000 / m) : null);
      setBeatCount(beatCountRef.current);
      setMotionDetected(detectorRef.current.motionPresent);
    }
  };

  // ── フレームループ ──────────────────────────────────────────────────────────
  // requestVideoFrameCallback があれば必ず使う。
  // rAF はディスプレイのリフレッシュ（60Hz）で発火するのに対しカメラは30fps なので、
  // rAF だと同じコマを2回サンプリングしてしまう。同一コマは It=0 → raw=0・energy=0 に
  // なるため、energyAvg が minEnergy(0.6) を割って検出が止まる。
  const startFrameLoop = () => {
    const video = videoRef.current;
    if (!video) return;
    runningRef.current = true;

    if (typeof video.requestVideoFrameCallback === 'function') {
      const step = () => {
        grabFrame();
        if (runningRef.current) vfcIdRef.current = video.requestVideoFrameCallback(step);
      };
      vfcIdRef.current = video.requestVideoFrameCallback(step);
    } else {
      const step = () => {
        grabFrame();
        if (runningRef.current) rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    }
  };

  const stopFrameLoop = () => {
    runningRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const video = videoRef.current;
    if (vfcIdRef.current !== null && typeof video?.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(vfcIdRef.current);
    }
    vfcIdRef.current = null;
  };

  // ── 全停止 ─────────────────────────────────────────────────────────────────
  const stopEverything = () => {
    runIdRef.current += 1;            // 進行中の getUserMedia を無効化する
    stopFrameLoop();
    clearTimeout(schedulerTimerRef.current);
    beepTimersRef.current.forEach(clearTimeout);   // 先読み済みのビープを鳴らさない
    beepTimersRef.current = [];
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    streamRef.current   = null;
    samplesRef.current  = [];
    intervalsRef.current = [];
    beatCountRef.current = 0;
  };

  // ── マウント時: Blob URL と canvas を準備 ────────────────────────────────────
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width  = CAM_W;
    canvas.height = CAM_H;
    offscreenCanvas.current = canvas;

    const url = createBeepBlobUrl();
    beepUrlRef.current = url;

    return () => {
      stopEverything();
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
      URL.revokeObjectURL(url);
      beepUrlRef.current      = null;
      offscreenCanvas.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 開始 ───────────────────────────────────────────────────────────────────
  const startTraining = async () => {
    // ① メトロノーム（同期）: iOS の音声セッションを Playback に昇格させる
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    audioCtxRef.current.resume();
    playBeep();
    clearTimeout(schedulerTimerRef.current);
    nextBeatTimeRef.current = audioCtxRef.current.currentTime + BEAT_INTERVAL;
    scheduler();

    // ② state リセット
    const myRun = ++runIdRef.current;   // この開始処理の世代
    samplesRef.current   = [];
    intervalsRef.current = [];
    beatCountRef.current = 0;
    startTimeRef.current = performance.now();
    lastUiTimeRef.current  = 0;
    setBpm(null);
    setBeatCount(0);
    setMotionDetected(false);
    setCameraError(null);
    setIsCounting(true);

    // ③ カメラ（非同期）: getUserMedia は上記 playBeep() の後なので
    //    iOS の Playback セッション昇格には影響しない
    signalRef.current   = new MotionSignal(CAM_W, CAM_H);
    detectorRef.current = new BeatDetector();

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('カメラが利用できません（HTTPS 環境が必要です）');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width:     { ideal: 320 },
          height:    { ideal: 240 },
          frameRate: { ideal: 30  },
        },
        audio: false,
      });
      // 許可ダイアログ中に停止・離脱していたら、掴んだストリームを畳んで何もしない
      const video = videoRef.current;
      if (myRun !== runIdRef.current || !video) {
        stream.getTracks().forEach(tr => tr.stop());
        return;
      }

      streamRef.current = stream;
      video.srcObject = stream;

      try {
        await video.play();
      } catch {
        // 再生できなかったらカメラを掴んだままにしない
        stream.getTracks().forEach(tr => tr.stop());
        streamRef.current = null;
        video.srcObject = null;
        setCameraError('カメラ映像を再生できませんでした');
        return;
      }

      if (myRun !== runIdRef.current) {
        stream.getTracks().forEach(tr => tr.stop());
        streamRef.current = null;
        video.srcObject = null;
        return;
      }

      startFrameLoop();
    } catch {
      setCameraError('カメラを起動できませんでした');
    }
  };

  // ── 停止 ───────────────────────────────────────────────────────────────────
  const stopTraining = () => {
    stopEverything();
    setIsCounting(false);
  };

  const status = getBpmStatus(bpm);

  // ── レンダリング ────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100dvh', background: '#F8F9FA', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ヘッダー */}
      <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Heart size={18} color="#FF4B72" fill="#FF4B72" />
          <h2 style={{ fontSize: '1rem', fontWeight: 900, color: '#333', margin: 0 }}>姿勢復習</h2>
        </div>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>
          <ArrowLeft size={24} />
        </button>
      </div>

      {/* メインコンテンツ
          練習パネルは display で出し分ける（AnimatePresence で外すと <video> が
          アンマウントされ、startTraining 時に videoRef.current が null になるため） */}
      <main style={{
        flex: 1, minHeight: 0, overflow: 'hidden',
        display: 'flex', flexDirection: 'column', padding: '14px 16px', gap: '12px',
        justifyContent: 'center',
      }}>

        {/* ── イラスト（常時表示） ── */}
        <div style={{
          background: 'white', borderRadius: '24px', padding: isCounting ? '10px' : '16px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.05)', textAlign: 'center',
          minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          transition: 'padding 0.4s ease',
        }}>
          <img src={cprImg} alt="CPR" style={{
            width: '100%', maxWidth: isCounting ? '150px' : '240px',
            minHeight: 0, maxHeight: '100%', objectFit: 'contain',
            marginBottom: '6px', transition: 'max-width 0.4s ease',
          }} />
          <div style={{ fontSize: isCounting ? '0.85rem' : '1rem', fontWeight: 900, color: '#FF4B72', flexShrink: 0 }}>
            目標テンポ: {BPM_TARGET}回/分
          </div>
        </div>

        {/* ── 練習中: ステータス + ゲージ + プレビュー ── */}
        <div style={{ display: isCounting ? 'flex' : 'none', flexDirection: 'column', gap: '10px', flexShrink: 0 }}>

          {/* ステータス */}
          <div style={{ textAlign: 'center', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {status ? (
              <span style={{
                background: status.color + '1F', color: status.color,
                fontWeight: 900, fontSize: '1.05rem', padding: '8px 24px', borderRadius: '22px',
                transition: 'color 0.3s ease, background 0.3s ease',
              }}>
                {status.text}
              </span>
            ) : (
              <span style={{ color: cameraError ? '#F87171' : '#BBB', fontSize: '0.85rem', fontWeight: 700 }}>
                {cameraError ? `${cameraError}（メトロノームは継続中）`
                  : motionDetected ? '計測中…' : 'カメラに上半身を映してください'}
              </span>
            )}
          </div>

          {/* ゲージ + カメラプレビュー */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

            {/* ゲージ */}
            <div style={{ background: 'white', borderRadius: '18px', padding: '14px 10px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <svg viewBox="0 0 200 116" style={{ width: '100%', height: 'auto', display: 'block' }}>
                {/* ゾーン: おそい / ちょうどよい / はやい */}
                <path d={arcPath(GAUGE_R, GAP, T_LOW - GAP)} stroke={C_SLOW} strokeWidth="16" fill="none"
                      strokeLinecap="round" opacity={status?.key === 'slow' ? 1 : 0.22}
                      style={{ transition: 'opacity 0.3s ease' }} />
                <path d={arcPath(GAUGE_R, T_LOW + GAP, T_HIGH - GAP)} stroke={C_GOOD} strokeWidth="16" fill="none"
                      strokeLinecap="round" opacity={status?.key === 'good' ? 1 : 0.22}
                      style={{ transition: 'opacity 0.3s ease' }} />
                <path d={arcPath(GAUGE_R, T_HIGH + GAP, 1 - GAP)} stroke={C_FAST} strokeWidth="16" fill="none"
                      strokeLinecap="round" opacity={status?.key === 'fast' ? 1 : 0.22}
                      style={{ transition: 'opacity 0.3s ease' }} />

                {/* 針（左向きに描いて t×180° 回転） */}
                <g style={{
                  transform: `rotate(${(bpm ? gaugeT(bpm) : 0.5) * 180}deg)`,
                  transformOrigin: '100px 100px',
                  transformBox: 'view-box',
                  transition: 'transform 0.45s cubic-bezier(0.34, 1.15, 0.64, 1)',
                  opacity: bpm ? 1 : 0.22,
                }}>
                  <polygon points="40,100 100,94.5 100,105.5" fill="#334155" />
                </g>
                <circle cx="100" cy="100" r="8.5" fill="#fff" stroke="#334155" strokeWidth="3.5" />
              </svg>

              <div style={{
                fontSize: '2.1rem', fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
                color: status?.color ?? '#DDD', transition: 'color 0.3s ease',
              }}>
                {bpm ?? '—'}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#BBB', fontWeight: 700 }}>回/分</div>
            </div>

            {/* カメラプレビュー */}
            <div style={{ background: '#1B1B1B', borderRadius: '18px', overflow: 'hidden', position: 'relative', aspectRatio: '1 / 1' }}>
              <video ref={videoRef} playsInline muted style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'cover', transform: 'scaleX(-1)',
              }} />
              {cameraError && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: '0.72rem', textAlign: 'center', padding: '10px' }}>
                  カメラを使用できません
                </div>
              )}
            </div>
          </div>

          {/* 回数・動き インジケータ */}
          <div style={{ background: 'white', borderRadius: '14px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.04)' }}>
            <Activity size={15} color={motionDetected ? C_GOOD : '#CCC'} />
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: motionDetected ? C_GOOD : '#CCC', flex: 1 }}>
              {motionDetected ? '動きを検出中' : '動きを待っています…'}
            </span>
            <Camera size={13} color={cameraError ? '#F87171' : '#AAA'} />
            <span style={{ fontSize: '0.75rem', color: '#888', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {beatCount} 回
            </span>
          </div>
        </div>
      </main>


      {/* フッター */}
      <div style={{ flexShrink: 0, padding: '20px', background: 'white', borderTop: '2px solid #EEE', textAlign: 'center' }}>
        <AnimatePresence mode="wait">
          {!isCounting ? (
            <motion.button key="start"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              onClick={startTraining}
              className="btn-pop"
              style={{ width: '100%', fontSize: '1.2rem', padding: '16px' }}
            >
              <Play size={24} fill="white" /> 練習を開始する
            </motion.button>
          ) : (
            <motion.button key="stop"
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
