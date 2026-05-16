import { HashRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Training from './pages/Training';
import Result from './pages/Result';
import VideoEvaluation from './pages/VideoEvaluation';

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/training" element={<Training />} />
        <Route path="/result" element={<Result />} />
        <Route path="/video-eval" element={<VideoEvaluation />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
