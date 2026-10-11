import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Square, Heart, Activity, Camera, ShieldCheck, Volume2, VolumeX, CircleAlert } from 'lucide-react';
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

// リズム音の ON/OFF は端末ごとに覚えておく（保存できない環境では毎回 ON から）
const SOUND_KEY = 'cpr-training.rhythmSound';
const readSoundPref = () => {
  try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
};

const Training = () => {
  const navigate = useNavigate();

  // ── メトロノーム refs ───────────────────────────────────────────────────────
  const beepUrlRef        = useRef(null);
  const audioCtxRef       = useRef(null);
  const nextBeatTimeRef   = useRef(0);
  const schedulerTimerRef = useRef(null);
  const beepTimersRef     = useRef([]);     // 予約済みビープの setTimeout ID

  // ── カメラ・解析 refs ───────────────────────────────────────────────────────
  // <video> は1つだけ。待機中は大きなプレビュー、練習中はゲージ横の小窓になる。
  // （iOS では同じストリームを複数の <video> で再生すると片方が止まることがあるため）
  const videoRef          = useRef(null);
  const offscreenCanvas   = useRef(null);   // 160×120 オフスクリーン canvas
  const streamRef         = useRef(null);   // MediaStream
  const cameraPromiseRef  = useRef(null);   // 取得中の getUserMedia（二重要求を防ぐ）
  const cameraGrantedRef  = useRef(false);  // カメラ許可済みと分かっているか
  const unmountedRef      = useRef(false);
  const rafRef            = useRef(null);   // rAF ID（フォールバック時）
  const vfcIdRef          = useRef(null);   // requestVideoFrameCallback ID
  const runningRef        = useRef(false);  // フレームループ継続フラグ
  const runIdRef          = useRef(0);      // 練習の世代。停止後に古い非同期処理を無効化する
  const signalRef         = useRef(null);   // MotionSignal
  const detectorRef       = useRef(null);   // BeatDetector
  const samplesRef        = useRef([]);     // 直近 6 秒のサンプル
  const intervalsRef      = useRef([]);     // 直近 8 拍の間隔 (ms)
  const beatCountRef      = useRef(0);
  const startTimeRef      = useRef(0);
  const lastUiTimeRef     = useRef(0);

  // ── state ──────────────────────────────────────────────────────────────────
  const [isCounting,     setIsCounting]     = useState(false);
  // カメラの状態: off / requesting（許可ダイアログ中）/ on / denied（拒否）/ error / unavailable
  const [camState,       setCamState]       = useState('off');
  const [cameraGranted,  setCameraGranted]  = useState(false);
  const [soundOn,        setSoundOn]        = useState(readSoundPref);
  const soundOnRef = useRef(soundOn);
  const [bpm,            setBpm]            = useState(null);
  const [beatCount,      setBeatCount]      = useState(0);
  const [motionDetected, setMotionDetected] = useState(false);
  const [cameraError,    setCameraError]    = useState(null);

  // ── メトロノーム ────────────────────────────────────────────────────────────
  // リズム音 OFF のあいだもスケジューラは回し続け、鳴らす瞬間に判定する。
  // こうすると練習中に ON/OFF を切り替えても拍の位置がずれない。
  const playBeep = () => {
    const url = beepUrlRef.current;
    if (!url || !soundOnRef.current) return;
    new Audio(url).play().catch(() => {});
  };

  // 予約済みビープは停止時に取り消せるよう ID を保持する。
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

  const toggleSound = () => {
    const next = !soundOnRef.current;
    soundOnRef.current = next;
    setSoundOn(next);
    try { localStorage.setItem(SOUND_KEY, next ? 'on' : 'off'); } catch { /* 保存できなくても動作には影響しない */ }
    // ON にしたらタップの中で1回鳴らす。確認音を兼ね、iOS の音声セッションを
    // Playback に上げる（OFF で開始した練習の途中で ON にした場合もマナーモードで鳴るように）
    if (next) playBeep();
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

    const beat     = detectorRef.current.push(sample);
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

  // ── カメラ ─────────────────────────────────────────────────────────────────
  // カメラは練習とは独立に開いておく。待機画面で許可して映り方を確かめ、
  // 練習を停止してもプレビューは残す。画面を離れたときに解放する。
  const hasLiveStream = () =>
    !!streamRef.current?.getVideoTracks().some(tr => tr.readyState === 'live');

  const ensureCamera = () => {
    if (hasLiveStream()) return Promise.resolve(streamRef.current);
    if (cameraPromiseRef.current) return cameraPromiseRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamState('unavailable');
      return Promise.resolve(null);
    }

    setCamState('requesting');
    const p = navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width:     { ideal: 320 },
        height:    { ideal: 240 },
        frameRate: { ideal: 30  },
      },
      audio: false,
    })
      .then((stream) => {
        // 許可ダイアログ中に画面を離れていたら、掴んだカメラをすぐ手放す
        if (unmountedRef.current) {
          stream.getTracks().forEach(tr => tr.stop());
          return null;
        }
        streamRef.current = stream;
        cameraGrantedRef.current = true;
        setCameraGranted(true);
        // iOS はアプリを裏に回すとカメラを止める。止まったら「オフ」に戻して再度オンにできるようにする
        stream.getVideoTracks().forEach((tr) => {
          tr.onended = () => {
            if (streamRef.current !== stream) return;
            streamRef.current = null;
            setCamState('off');
          };
        });
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.play().catch(() => {});
        }
        setCamState('on');
        return stream;
      })
      .catch((err) => {
        if (!unmountedRef.current) {
          setCamState(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'error');
        }
        return null;
      })
      .finally(() => { cameraPromiseRef.current = null; });

    cameraPromiseRef.current = p;
    return p;
  };

  const releaseCamera = () => {
    streamRef.current?.getTracks().forEach(tr => tr.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  // ── 練習の停止（カメラは止めない）──────────────────────────────────────────
  const stopPractice = () => {
    runIdRef.current += 1;            // 進行中の開始処理を無効化する
    stopFrameLoop();
    clearTimeout(schedulerTimerRef.current);
    beepTimersRef.current.forEach(clearTimeout);   // 先読み済みのビープを鳴らさない
    beepTimersRef.current = [];
    samplesRef.current   = [];
    intervalsRef.current = [];
    beatCountRef.current = 0;
  };

  // ── マウント時: Blob URL・canvas・許可状態 ──────────────────────────────────
  useEffect(() => {
    unmountedRef.current = false;

    const canvas = document.createElement('canvas');
    canvas.width  = CAM_W;
    canvas.height = CAM_H;
    offscreenCanvas.current = canvas;

    const url = createBeepBlobUrl();
    beepUrlRef.current = url;

    // Permissions API で許可済みか調べ、ボタンの文言を「許可する」「オンにする」で出し分ける。
    // 未対応のブラウザ（'camera' を受け付けない等）は例外になるので無視する。
    let permStatus = null;
    const applyPerm = (st) => {
      cameraGrantedRef.current = st.state === 'granted';
      setCameraGranted(st.state === 'granted');
    };
    navigator.permissions?.query({ name: 'camera' })
      .then((st) => {
        if (unmountedRef.current) return;
        permStatus = st;
        applyPerm(st);
        st.onchange = () => applyPerm(st);
      })
      .catch(() => {});

    return () => {
      unmountedRef.current = true;
      if (permStatus) permStatus.onchange = null;
      stopPractice();
      releaseCamera();
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
    // ① メトロノーム（同期）: タップの中で1拍目を鳴らし、iOS の音声セッションを
    //    Playback に昇格させる（マナーモードでも鳴る）。リズム音 OFF なら鳴らさない。
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
    lastUiTimeRef.current = 0;
    setBpm(null);
    setBeatCount(0);
    setMotionDetected(false);
    setCameraError(null);
    setIsCounting(true);

    signalRef.current   = new MotionSignal(CAM_W, CAM_H);
    detectorRef.current = new BeatDetector();

    // ③ カメラ: 待機画面で許可済みならそのまま使う。まだなら（許可ボタンを押さずに
    //    開始した場合）ここで要求する。getUserMedia は playBeep() の後なので
    //    iOS の Playback 昇格には影響しない。
    if (camState === 'denied') {
      setCameraError('カメラが許可されていないため、テンポは測れません');
      return;
    }
    if (camState === 'unavailable') {
      setCameraError('この端末ではカメラを使えません');
      return;
    }

    const stream = await ensureCamera();
    if (myRun !== runIdRef.current) return;   // 待っている間に停止した
    if (!stream) {
      setCameraError('カメラを起動できなかったため、テンポは測れません');
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    try {
      await video.play();
    } catch {
      setCameraError('カメラ映像を再生できませんでした');
      return;
    }
    if (myRun !== runIdRef.current) return;
    startFrameLoop();
  };

  // ── 停止 ───────────────────────────────────────────────────────────────────
  const stopTraining = () => {
    stopPractice();
    setIsCounting(false);
  };

  const status = getBpmStatus(bpm);

  // カメラ窓に重ねる表示
  const camMessage = {
    off:         cameraGranted ? 'カメラをオンにすると、ここに映ります' : '練習の前にカメラを許可してください',
    requesting:  '許可を待っています…',
    denied:      'カメラが許可されていません。設定アプリ › Safari › カメラ で許可できます',
    error:       'カメラを起動できませんでした',
    unavailable: 'この端末ではカメラを使えません',
  }[camState];
  const showCamButton = !isCounting && (camState === 'off' || camState === 'error');
  const camButtonLabel = camState === 'error' ? 'もう一度試す' : cameraGranted ? 'カメラをオンにする' : 'カメラを許可する';

  // ── レンダリング ────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100dvh', background: '#F8F9FA', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ヘッダー */}
      <div style={{ padding: '10px 16px 10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Heart size={18} color="#FF4B72" fill="#FF4B72" />
          <h2 style={{ fontSize: '1rem', fontWeight: 900, color: '#333', margin: 0 }}>姿勢復習</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={toggleSound}
            aria-pressed={soundOn}
            aria-label={soundOn ? 'リズム音を消す' : 'リズム音を鳴らす'}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: '999px',
              border: `2px solid ${soundOn ? '#FF4B72' : '#DDD'}`,
              background: soundOn ? '#FFF0F4' : '#F4F4F4',
              color: soundOn ? '#FF4B72' : '#999',
              fontWeight: 900, fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            リズム音 {soundOn ? 'ON' : 'OFF'}
          </button>
          <button onClick={() => navigate('/')} aria-label="ホームに戻る" style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '4px' }}>
            <ArrowLeft size={24} />
          </button>
        </div>
      </div>

      {/* メインコンテンツ
          カメラ窓（<video>）は待機中・練習中で同じ要素を使い続ける。
          兄弟要素は条件付きで外さず display で出し分け、DOM 上の位置を固定している。 */}
      <main style={{
        flex: 1, minHeight: 0, overflow: 'hidden',
        display: 'flex', flexDirection: 'column', padding: '14px 16px', gap: '12px',
        justifyContent: 'center',
      }}>

        {/* ── イラスト ── */}
        <div style={{
          display: 'flex', background: 'white', borderRadius: '24px', padding: isCounting ? '10px' : '12px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.05)', textAlign: 'center',
          minHeight: 0, flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          transition: 'padding 0.4s ease',
        }}>
          <img src={cprImg} alt="CPR" style={{
            width: '100%', maxWidth: isCounting ? '150px' : '170px',
            minHeight: 0, maxHeight: '100%', objectFit: 'contain',
            marginBottom: '6px', transition: 'max-width 0.4s ease',
          }} />
          <div style={{ fontSize: '0.9rem', fontWeight: 900, color: '#FF4B72', flexShrink: 0 }}>
            目標テンポ: {BPM_TARGET}回/分
          </div>
        </div>

        {/* ── 待機中: 置き方の注意 ── */}
        <div style={{
          display: isCounting ? 'none' : 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
          background: '#FFF7E6', border: '1.5px solid #FCD9A0', borderRadius: '14px', padding: '10px 14px',
          color: '#B45309', fontWeight: 900, fontSize: '0.88rem',
        }}>
          <CircleAlert size={18} style={{ flexShrink: 0 }} />
          カメラに頭が映るように端末を置いてください
        </div>

        {/* ── 練習中: ステータス ── */}
        <div style={{ display: isCounting ? 'flex' : 'none', textAlign: 'center', minHeight: '36px', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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
              {cameraError ? cameraError
                : camState === 'requesting' ? 'カメラの許可を待っています…'
                : motionDetected ? '計測中…' : 'カメラに頭が映るようにしてください'}
            </span>
          )}
        </div>

        {/* ── ゲージ（練習中のみ）＋ カメラ窓（常時）── */}
        <div style={{ display: 'grid', gridTemplateColumns: isCounting ? '1fr 1fr' : '1fr', gap: '12px', flexShrink: 0 }}>

          {/* ゲージ */}
          <div style={{ display: isCounting ? 'flex' : 'none', background: 'white', borderRadius: '18px', padding: '14px 10px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.04)', flexDirection: 'column', alignItems: 'center' }}>
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

          {/* カメラ窓 */}
          <div style={{
            background: '#1B1B1B', borderRadius: '18px', overflow: 'hidden', position: 'relative',
            aspectRatio: isCounting ? '1 / 1' : '4 / 3',
          }}>
            <video ref={videoRef} playsInline muted style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover', transform: 'scaleX(-1)',
              opacity: camState === 'on' ? 1 : 0,
            }} />

            {camState === 'on' ? (
              !isCounting && (
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '8px', background: 'linear-gradient(transparent, rgba(0,0,0,0.6))', color: 'white', fontSize: '0.8rem', fontWeight: 700, textAlign: 'center' }}>
                  頭が映っているか確認してください
                </div>
              )
            ) : (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: '10px', padding: '14px', textAlign: 'center', lineHeight: 1.6,
                color: camState === 'denied' || camState === 'error' ? '#FCA5A5' : '#999',
                fontSize: isCounting ? '0.7rem' : '0.82rem', fontWeight: 700,
              }}>
                <Camera size={isCounting ? 20 : 28} color={camState === 'denied' || camState === 'error' ? '#FCA5A5' : '#777'} />
                <span>{camMessage}</span>
                {showCamButton && (
                  <button onClick={() => { ensureCamera(); }} className="btn-pop"
                    style={{ fontSize: '1rem', padding: '10px 22px' }}>
                    <Camera size={18} /> {camButtonLabel}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── 待機中: プライバシー表記 ── */}
        <div style={{ display: isCounting ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.75rem', color: '#10B981', fontWeight: 700, flexShrink: 0 }}>
          <ShieldCheck size={14} />
          映像は端末の外に送信せず、保存もしません
        </div>

        {/* ── 練習中: 回数・動き インジケータ ── */}
        <div style={{ display: isCounting ? 'flex' : 'none', background: 'white', borderRadius: '14px', padding: '10px 16px', alignItems: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.04)', flexShrink: 0 }}>
          <Activity size={15} color={motionDetected ? C_GOOD : '#CCC'} />
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: motionDetected ? C_GOOD : '#CCC', flex: 1 }}>
            {motionDetected ? '動きを検出中' : '動きを待っています…'}
          </span>
          <Camera size={13} color={cameraError ? '#F87171' : '#AAA'} />
          <span style={{ fontSize: '0.75rem', color: '#888', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {beatCount} 回
          </span>
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
