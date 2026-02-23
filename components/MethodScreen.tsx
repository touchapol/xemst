import React, { useState } from 'react';

interface MethodScreenProps {
  onServiceSelected: (endpoint: string, workerToken: string, serviceId: string) => void;
  onCancel: () => void;
}

const services = [
  {
    id: 'mp3stego',
    icon: 'api',
    title: 'MP3Stego Worker',
    tag: 'Standalone API',
    desc: 'Connect directly to your local MP3Stego (.mp3) Worker via SSH tunnel.',
  },
  {
    id: 'stegcracker',
    icon: 'terminal',
    title: 'StegCracker Worker',
    tag: 'Kali Linux API',
    desc: 'Connect to your Go-based Steghide Worker (.jpeg, .bmp, .wav, .au).',
  },
];

export const MethodScreen: React.FC<MethodScreenProps> = ({ onServiceSelected, onCancel }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [workerEndpoint, setWorkerEndpoint] = useState('');
  const [workerToken, setWorkerToken] = useState('');
  const [rememberConnection, setRememberConnection] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (selected) {
      setWorkerEndpoint(localStorage.getItem(`xemst_${selected}_endpoint`) || '');
      setWorkerToken(localStorage.getItem(`xemst_${selected}_token`) || '');
      const rem = localStorage.getItem(`xemst_${selected}_remember`);
      setRememberConnection(rem !== 'false');
      setError('');
    }
  }, [selected]);

  const canContinue = selected !== null && workerEndpoint.trim().length > 0 && workerToken.trim().length > 0;

  const handleContinue = async () => {
    if (!canContinue) return;

    setLoading(true);
    setError('');

    let cleanEndpoint = workerEndpoint.trim();
    if (cleanEndpoint.startsWith('http://')) {
      cleanEndpoint = cleanEndpoint.replace('http://', 'https://');
    }
    if (!cleanEndpoint.startsWith('https://')) {
      cleanEndpoint = `https://${cleanEndpoint}`;
    }

    try {
      const res = await fetch(`${cleanEndpoint}/api/health`, {
        headers: {
          Authorization: `Bearer ${workerToken.trim()}`
        }
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.error || 'Worker unauthorized or not found');
        return;
      }

      if (rememberConnection) {
        localStorage.setItem(`xemst_${selected}_endpoint`, cleanEndpoint);
        localStorage.setItem(`xemst_${selected}_token`, workerToken.trim());
        localStorage.setItem(`xemst_${selected}_remember`, 'true');
      } else {
        localStorage.removeItem(`xemst_${selected}_endpoint`);
        localStorage.removeItem(`xemst_${selected}_token`);
        localStorage.setItem(`xemst_${selected}_remember`, 'false');
      }

      onServiceSelected(cleanEndpoint, workerToken.trim(), selected!);
    } catch {
      setError('Worker API unreachable (is tunnel running?)');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-5xl mx-auto px-4 animate-fade-in z-10 relative">
      <div className="flex flex-col gap-2 p-4 mb-4 text-center items-center">
        <div className="inline-flex items-center gap-2 mb-2 opacity-50">
          <span className="material-symbols-outlined text-sm">lock_open</span>
          <span className="text-xs tracking-widest uppercase font-mono">XEMST</span>
        </div>
        <h1 className="text-white text-3xl md:text-5xl font-bold leading-tight tracking-tight uppercase">
          Connect Worker
        </h1>
        <p className="text-primary-dim text-base md:text-lg font-normal leading-normal max-w-xl mt-2">
          Paste the Endpoint URL and Token from your terminal.
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-6 w-full mb-8">
        {services.map((s) => (
          <div
            key={s.id}
            onClick={() => setSelected(s.id)}
            className={`
              group relative flex flex-col items-start justify-between rounded-sm border-2 p-6 cursor-pointer transition-all duration-300 w-full max-w-md
              ${selected === s.id
                ? 'border-white bg-white/10 shadow-[0_0_20px_rgba(255,255,255,0.15)]'
                : 'border-border bg-surface hover:border-primary-dim hover:bg-white/5'}
            `}
          >
            <div className="absolute top-3 right-3 transition-opacity duration-200">
              <span className={`material-symbols-outlined ${selected === s.id ? 'text-white' : 'text-gray-600'}`}>
                {selected === s.id ? 'radio_button_checked' : 'radio_button_unchecked'}
              </span>
            </div>

            <div className={`
              mb-6 flex h-12 w-12 items-center justify-center rounded-sm transition-colors duration-300
              ${selected === s.id ? 'bg-white text-black' : 'bg-border text-gray-400 group-hover:bg-gray-700 group-hover:text-white'}
            `}>
              <span className="material-symbols-outlined text-2xl">{s.icon}</span>
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="text-white text-xl font-bold tracking-wide uppercase">{s.title}</h3>
              <p className="text-primary-dim/80 text-sm font-medium">{s.tag}</p>
              <p className="text-gray-400 text-sm leading-relaxed mt-2">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <div className="w-full max-w-md mb-8 flex flex-col gap-4 animate-fade-in">
          <div>
            <label className="block text-xs text-gray-500 font-mono uppercase tracking-widest mb-3">
              <span className="material-symbols-outlined text-[14px] align-middle mr-1">link</span>
              Endpoint URL (Domain)
            </label>
            <input
              autoFocus
              type="text"
              value={workerEndpoint}
              onChange={(e) => setWorkerEndpoint(e.target.value)}
              placeholder="e.g. xemunel-xxxxx.cheeph.com"
              className="block w-full bg-black border-2 border-border focus:border-white text-white text-base font-mono tracking-wide rounded-sm h-14 px-4 placeholder:text-gray-700 focus:ring-0 transition-all duration-300 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 font-mono uppercase tracking-widest mb-3">
              <span className="material-symbols-outlined text-[14px] align-middle mr-1">vpn_key</span>
              Worker Token
            </label>
            <input
              type="password"
              value={workerToken}
              onChange={(e) => setWorkerToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canContinue && handleContinue()}
              placeholder="Enter the randomly generated token"
              className="block w-full bg-black border-2 border-border focus:border-white text-white text-base font-mono tracking-wide rounded-sm h-14 px-4 placeholder:text-gray-700 focus:ring-0 transition-all duration-300 outline-none"
            />
          </div>

          <div className="flex items-center gap-3 mt-1 mb-2">
            <input
              type="checkbox"
              id="remember"
              checked={rememberConnection}
              onChange={(e) => setRememberConnection(e.target.checked)}
              className="w-5 h-5 bg-black border-2 border-border rounded-sm text-white focus:ring-0 cursor-pointer accent-white"
            />
            <label htmlFor="remember" className="text-sm text-gray-400 font-mono cursor-pointer select-none">
              Remember Endpoint & Token
            </label>
          </div>

          {error && (
            <p className="text-red-500 text-xs font-mono tracking-widest mt-2 text-center uppercase animate-fade-in">
              ⚠ {error}
            </p>
          )}

          <div className="flex flex-col items-center gap-4 w-full mt-4">
            <button
              onClick={handleContinue}
              disabled={!canContinue || loading}
              className={`
                group flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-sm h-14 px-8 text-lg font-bold tracking-widest transition-all
                ${canContinue && !loading
                  ? 'bg-white hover:bg-gray-200 text-black shadow-[0_0_15px_rgba(255,255,255,0.2)] hover:shadow-[0_0_25px_rgba(255,255,255,0.4)]'
                  : 'bg-gray-800 text-gray-600 cursor-not-allowed shadow-none'
                }
              `}
            >
              {loading ? (
                <>
                  <span className="material-symbols-outlined text-xl animate-spin mr-2">progress_activity</span>
                  CONNECTING...
                </>
              ) : (
                <>
                  <span className="truncate mr-2">CONNECT API</span>
                  <span className="material-symbols-outlined text-xl group-hover:translate-x-1 transition-transform">chevron_right</span>
                </>
              )}
            </button>

            <button
              onClick={onCancel}
              className="flex items-center gap-2 text-gray-500 hover:text-red-400 text-sm font-mono uppercase tracking-widest transition-all"
            >
              <span className="material-symbols-outlined text-[16px]">logout</span>
              Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
};