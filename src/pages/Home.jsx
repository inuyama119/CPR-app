import { Link } from 'react-router-dom';
import { Activity, Play, ClipboardCheck, Video, BookOpen } from 'lucide-react';
import { motion } from 'framer-motion';

const Home = () => {
  return (
    <div className="flex-center" style={{ flexDirection: 'column', padding: '40px 20px', minHeight: '100vh' }}>
      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', bounce: 0.5 }}
        className="text-center mb-8"
      >
        <div className="flex-center mb-4">
          <div className="animate-pulse flex-center" style={{ 
            background: 'var(--primary)', 
            width: '80px', height: '80px', 
            borderRadius: '50%',
            boxShadow: 'var(--shadow-md)'
          }}>
            <Activity color="white" size={48} />
          </div>
        </div>
        <h1 style={{ color: 'var(--primary)', fontSize: '2.5rem', marginBottom: '8px' }}>胸骨圧迫マスター</h1>
        <p className="en-text" style={{ color: 'var(--text-gray)', fontSize: '1.2rem', fontWeight: 600 }}>CPR EVALUATION</p>
      </motion.div>

      <motion.div 
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="glass-card text-center mb-8"
        style={{ width: '100%', maxWidth: '400px' }}
      >
        <h2 className="mb-4" style={{ fontSize: '1.4rem' }}>スマホで簡単！<br/>胸骨圧迫の練習</h2>
        <p style={{ fontSize: '1rem', color: 'var(--text-gray)', lineHeight: '1.6' }} className="mb-6">
          自宅のクッションを使用して、<br/>正しい姿勢とリズムを身につけ、<br/>大切な命を救うスキルを磨きましょう。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Link 
            to="/training?mode=practice"
            className="btn-pop" 
            style={{ width: '100%', textDecoration: 'none' }}
          >
            <Activity size={24} />
            姿勢復習モード
          </Link>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-gray)', marginTop: '-8px', marginBottom: '8px' }}>
            イラストとリズム音で直感的に姿勢を復習！
          </p>
          
          <Link 
            to="/video-eval"
            className="btn-pop tertiary" 
            style={{ width: '100%', textDecoration: 'none', background: 'var(--tertiary)' }}
          >
            <Video size={24} fill="currentColor" />
            ビデオで評価
          </Link>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-gray)', marginTop: '-8px', marginBottom: '8px' }}>
            撮影したビデオをAIが解析
          </p>

          <a 
            href="https://otetsuzuki.jp/inuyama-city/application-services/50388bb0-dd56-492a-bfca-221b7ed926e5" 
            target="_blank" 
            rel="noopener noreferrer"
            className="btn-pop"
            style={{ 
              width: '100%', 
              textDecoration: 'none', 
              background: 'white', 
              color: 'var(--text-dark)',
              border: '4px solid var(--text-dark)',
              marginTop: '12px'
            }}
          >
            <ClipboardCheck size={24} />
            アンケートに協力する
          </a>
        </div>
      </motion.div>

      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <p style={{ color: 'var(--text-gray)', opacity: 0.8, fontSize: '0.9rem', fontWeight: 'bold' }}>
          JRCガイドライン 2020 準拠
        </p>
      </motion.div>
    </div>
  );
};

export default Home;
