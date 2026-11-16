import { useState } from 'react';
import { CodeLab } from './CodeLab';
import { Library } from './Library';

export default function App() {
  const [mode, setMode] = useState<'code' | 'library'>('code');

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="mark">A3</div>
          <div className="brand-text">
            <h1>Algo3D</h1>
            <p>Java, Python, JavaScript and C++, stepped through in three dimensions</p>
          </div>
        </div>

        <nav className="modes">
          <button className={`mode ${mode === 'code' ? 'on' : ''}`} onClick={() => setMode('code')}>
            Your code
          </button>
          <button className={`mode ${mode === 'library' ? 'on' : ''}`} onClick={() => setMode('library')}>
            Algorithm library
          </button>
        </nav>
      </header>

      {mode === 'code' ? <CodeLab /> : <Library />}
    </div>
  );
}
