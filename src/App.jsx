import { HashRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Training from './pages/Training';
import Result from './pages/Result';
import VideoEvaluation, { preloadAIModel } from './pages/VideoEvaluation';

// アプリ起動時にAIモデルを事前読み込み
preloadAIModel();

function App() {
  return (
    <>
      {/* イラスト画像の事前読み込み (非表示) */}
      <img src={`${import.meta.env.BASE_URL}images/cpr_illustration_v3.png`} style={{ display: 'none' }} alt="preload" fetchPriority="high" />
      
      <HashRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/training" element={<Training />} />
          <Route path="/result" element={<Result />} />
          <Route path="/video-eval" element={<VideoEvaluation />} />
        </Routes>
      </HashRouter>
    </>
  );
}

export default App;
