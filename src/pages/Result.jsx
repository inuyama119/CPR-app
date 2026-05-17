import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Trophy, RotateCcw, Home, AlertTriangle, Activity, Target, Zap, MessageCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';

const Result = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { mode, scoreData, bpm, isFinished, isAborted } = location.state || { 
    mode: 'practice', 
    scoreData: { compressions: 0, isBpmOk: false, isTiltOk: false, medianBpm: 0, medianTilt: 0 }, 
    bpm: 0,
    isFinished: false,
    isAborted: false
  };

  const isRhythmOk = scoreData.isBpmOk;
  const isTiltOk = scoreData.isTiltOk;

  // 1. リズムの評価
  const rhythmEval = isRhythmOk
    ? { char: '◎', label: '合格', color: 'var(--tertiary)' } 
    : { char: '△', label: 'あと少し', color: 'var(--primary)' };

  // 2. 姿勢の評価
  const postureEval = isTiltOk
    ? { char: '◎', label: '合格', color: 'var(--tertiary)' } 
    : { char: '△', label: 'あと少し', color: 'var(--primary)' };

  // 3. 総合判定 (文言軟化 v3.86)
  let overallEval;
  const passCount = (isRhythmOk ? 1 : 0) + (isTiltOk ? 1 : 0);

  if (passCount === 2) {
    overallEval = { 
      char: '◎', 
      title: 'エキスパート級', 
      color: 'var(--tertiary)', 
      desc: '完璧な技術です！全ての基準をクリアしています。自信を持ってこの技術を維持してください。' 
    };
  } else if (passCount === 1) {
    overallEval = { 
      char: '○', 
      title: 'スタンダード級', 
      color: 'var(--success)', 
      desc: '素晴らしい技術をお持ちです。あと一歩で完璧です！アドバイスを参考に精度を高めていきましょう。' 
    };
  } else {
    overallEval = { 
      char: '△', 
      title: 'あと一歩！', 
      color: 'var(--primary)', 
      desc: 'まずは練習に挑戦したことが素晴らしい一歩です。繰り返し挑戦することで、必ず正しい技術が身につきます！' 
    };
  }

  // 4. アドバイスの簡略化 (中央値などの専門用語を排除)
  const advices = [];
  if (!isRhythmOk) {
    advices.push(`【リズム】1分間に100〜120回の一定のリズムに達していません。復習モードの音をよく聞いて、テンポを合わせる練習をしましょう。`);
  }
  if (!isTiltOk) {
    advices.push(`【姿勢】腕が少し斜めになっています。肩の真下に手を置き、真上から真っ直ぐに体重を乗せて押すことを意識しましょう。`);
  }

  useEffect(() => {
    if (isFinished && passCount === 2) {
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#FF4B72', '#3EE0C2', '#FFC03D']
      });
    }
  }, [isFinished, passCount]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface)', padding: '24px' }}>
      <div style={{ maxWidth: '500px', margin: '0 auto' }}>
        
        <header style={{ textAlign: 'center', marginBottom: '24px', marginTop: '8px' }}>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--text-dark)', marginBottom: '4px' }}>診断レポート</h1>
          <p style={{ color: 'var(--text-gray)', fontWeight: 'bold', fontSize: '0.8rem' }}>解析モデル：Standard Edition</p>
        </header>

        <AnimatePresence mode="wait">
          {isAborted ? (
            <motion.div
              key="aborted"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              style={{ background: 'white', padding: '40px 24px', borderRadius: '32px', textAlign: 'center', marginBottom: '24px', boxShadow: 'var(--shadow-md)', border: '4px solid var(--primary)' }}
            >
              <AlertTriangle size={64} color="var(--primary)" style={{ margin: '0 auto 20px' }} />
              <h2 style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--text-dark)', marginBottom: '12px' }}>計測を中断しました</h2>
              <p style={{ fontSize: '0.95rem', color: 'var(--text-gray)', fontWeight: 'bold', lineHeight: 1.6 }}>撮影状況によりデータが取得できませんでした。撮影のコツを確認して再度挑戦してみましょう。</p>
            </motion.div>
          ) : (
            <motion.div key="normal">
              {/* 総合評価エリア */}
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                style={{ background: 'white', padding: '32px 24px', borderRadius: '32px', textAlign: 'center', marginBottom: '24px', boxShadow: 'var(--shadow-md)', border: '4px solid ' + overallEval.color, position: 'relative', overflow: 'hidden' }}
              >
                <div style={{ fontSize: '6rem', fontWeight: 900, color: overallEval.color, lineHeight: 1, marginBottom: '8px', fontFamily: 'serif' }}>
                  {overallEval.char}
                </div>
                <h2 style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--text-dark)', marginBottom: '8px' }}>{overallEval.title}</h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-gray)', fontWeight: 'bold', lineHeight: 1.5 }}>{overallEval.desc}</p>
              </motion.div>

              {/* 詳細評価セクション */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <div style={{ background: 'white', padding: '20px', borderRadius: '24px', textAlign: 'center', border: '3px solid var(--text-dark)', boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', color: 'var(--text-gray)', marginBottom: '8px' }}>
                    <Activity size={16} /> <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>リズム</span>
                  </div>
                  <div style={{ fontSize: '3rem', fontWeight: 900, color: rhythmEval.color, fontFamily: 'serif', lineHeight: 1 }}>{rhythmEval.char}</div>
                  <p style={{ fontSize: '0.7rem', fontWeight: 900, color: rhythmEval.color, marginTop: '4px' }}>{rhythmEval.label}</p>
                </div>
                <div style={{ background: 'white', padding: '20px', borderRadius: '24px', textAlign: 'center', border: '3px solid var(--text-dark)', boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', color: 'var(--text-gray)', marginBottom: '8px' }}>
                    <Zap size={16} /> <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>姿勢</span>
                  </div>
                  <div style={{ fontSize: '3rem', fontWeight: 900, color: postureEval.color, fontFamily: 'serif', lineHeight: 1 }}>{postureEval.char}</div>
                  <p style={{ fontSize: '0.7rem', fontWeight: 900, color: postureEval.color, marginTop: '4px' }}>{postureEval.label}</p>
                </div>
              </div>

              {/* アドバイスエリア */}
              {advices.length > 0 && (
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} style={{ background: 'white', color: 'var(--text-dark)', padding: '24px', borderRadius: '28px', marginBottom: '24px', border: '3px solid var(--primary)', boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                    <MessageCircle size={24} color="var(--primary)" fill="var(--primary)" />
                    <h3 style={{ fontWeight: 900, fontSize: '1.1rem' }}>上達のヒント</h3>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {advices.map((text, i) => (
                      <div key={i} style={{ background: '#FFF0F3', padding: '16px', borderRadius: '16px', fontSize: '0.85rem', fontWeight: 'bold', lineHeight: 1.5, color: '#333' }}>
                        {text}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>



        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button className="btn-pop" style={{ width: '100%' }} onClick={() => navigate('/video-eval')}>
            <RotateCcw size={20} /> もう一度解析する
          </button>
          <button className="btn-pop secondary" style={{ width: '100%' }} onClick={() => navigate('/')}>
            <Home size={20} /> ホームに戻る
          </button>
        </div>

      </div>
    </div>
  );
};

export default Result;
