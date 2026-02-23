import React, { useState, useRef, useCallback } from 'react';


interface AccessScreenProps {
  onAccessGranted: (token: string) => void;
}

const PIN_LENGTH = 8;

export const AccessScreen: React.FC<AccessScreenProps> = ({ onAccessGranted }) => {
  const [pins, setPins] = useState<string[]>(Array(PIN_LENGTH).fill(''));
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const focusInput = useCallback((index: number) => {
    if (index >= 0 && index < PIN_LENGTH) {
      inputRefs.current[index]?.focus();
    }
  }, []);

  const handleChange = useCallback((index: number, value: string) => {
    const char = value.slice(-1);
    if (char && !/^[a-zA-Z0-9]$/.test(char)) return;

    setPins(prev => {
      const next = [...prev];
      next[index] = char.toUpperCase();
      return next;
    });

    if (char && index < PIN_LENGTH - 1) {
      focusInput(index + 1);
    }
  }, [focusInput]);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      setPins(prev => {
        const next = [...prev];
        if (next[index]) {
          next[index] = '';
        } else if (index > 0) {
          next[index - 1] = '';
          focusInput(index - 1);
        }
        return next;
      });
    } else if (e.key === 'ArrowLeft') {
      focusInput(index - 1);
    } else if (e.key === 'ArrowRight') {
      focusInput(index + 1);
    } else if (e.key === 'Enter') {
      handleSubmit();
    }
  }, [focusInput]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, PIN_LENGTH);
    if (!pasted) return;

    setPins(prev => {
      const next = [...prev];
      for (let i = 0; i < pasted.length; i++) {
        next[i] = pasted[i];
      }
      return next;
    });
    focusInput(Math.min(pasted.length, PIN_LENGTH - 1));
  }, [focusInput]);

  const showError = useCallback((msg: string) => {
    setError(true);
    setErrorMsg(msg);
    setPins(Array(PIN_LENGTH).fill(''));
    setTimeout(() => {
      setError(false);
      setErrorMsg('');
      focusInput(0);
    }, 3000);
  }, [focusInput]);

  const handleSubmit = useCallback(async () => {
    const code = pins.join('');
    if (code.length !== PIN_LENGTH) {
      showError('⚠ Incomplete PIN — Fill all 8 characters');
      return;
    }

    setLoading(true);
    try {
      // Slight delay for processing effect
      await new Promise(r => setTimeout(r, 600));

      const msgBuffer = new TextEncoder().encode(code);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Check against VITE_PIN_HASH or fallback to SHA-256 of "12345678"
      const env = (import.meta as any).env || {};
      const expectedHash = (env.VITE_PIN_HASH || 'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f').toLowerCase();

      if (hashHex !== expectedHash) {
        // Obscure remaining attempts since it's local
        showError('⚠ Invalid PIN — Access Denied');
        return;
      }

      onAccessGranted(`local-token-${Date.now()}`);
    } catch {
      showError('⚠ Connection failed — System Error');
    } finally {
      setLoading(false);
    }
  }, [pins, onAccessGranted, showError]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen relative z-10 px-6 animate-fade-in">
      <div className="w-full max-w-lg flex flex-col items-center gap-8">
        <div className="w-16 h-16 rounded flex items-center justify-center bg-black border border-white shadow-[0_0_20px_-5px_rgba(255,255,255,0.3)] mb-4">
          <span className="material-symbols-outlined text-4xl text-white">encrypted</span>
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-white text-4xl md:text-5xl font-bold tracking-tighter uppercase leading-tight select-none">
            Access Restricted
          </h1>
          <p className="text-primary-dim text-sm tracking-[0.2em] font-medium uppercase">
            System Locked • Authorization Required
          </p>
        </div>

        <div className="w-full flex flex-col gap-6 mt-4">
          <div className="flex items-center justify-center gap-2 md:gap-3" onPaste={handlePaste}>
            {pins.map((pin, i) => (
              <React.Fragment key={i}>
                {i === 4 && <div className="w-3 md:w-4 flex items-center justify-center text-gray-600 select-none">—</div>}
                <div className="relative">
                  <input
                    ref={el => { inputRefs.current[i] = el; }}
                    autoFocus={i === 0}
                    type="text"
                    inputMode="text"
                    maxLength={1}
                    value={pin}
                    disabled={loading}
                    onChange={e => handleChange(i, e.target.value)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    className={`
                      w-10 h-14 md:w-12 md:h-16
                      bg-black border-2 rounded-sm
                      text-transparent text-center text-xl md:text-2xl font-mono font-bold uppercase
                      focus:ring-0 outline-none caret-transparent
                      transition-all duration-200
                      ${loading ? 'opacity-50 cursor-not-allowed' : ''}
                      ${error
                        ? 'border-red-500 animate-pulse'
                        : pin
                          ? 'border-white shadow-[0_0_10px_-3px_rgba(255,255,255,0.4)]'
                          : 'border-border focus:border-white'
                      }
                    `}
                  />
                  {pin && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-3 h-3 rounded-full bg-white" />
                    </div>
                  )}
                </div>
              </React.Fragment>
            ))}
          </div>

          {errorMsg && (
            <p className="text-red-500 text-xs font-mono tracking-widest text-center uppercase animate-fade-in">
              {errorMsg}
            </p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className={`
              relative w-full overflow-hidden transition-all duration-200 h-14 rounded-sm font-bold text-base tracking-[0.1em] uppercase flex items-center justify-center gap-2 group shadow-lg
              ${loading
                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                : 'bg-white hover:bg-gray-200 text-black hover:shadow-white/20'
              }
            `}
          >
            {loading ? (
              <>
                <span className="material-symbols-outlined text-[20px] animate-spin">progress_activity</span>
                <span>Verifying...</span>
              </>
            ) : (
              <>
                <span className="relative z-10">Verify Key</span>
                <span className="material-symbols-outlined text-[20px] relative z-10 group-hover:translate-x-1 transition-transform">
                  arrow_forward
                </span>
              </>
            )}
          </button>
        </div>

        <div className="absolute bottom-12 left-0 right-0 text-center px-4">
          <div className="flex flex-col items-center gap-3 opacity-60">
            <div className="h-px w-24 bg-gradient-to-r from-transparent via-gray-500 to-transparent"></div>
            <p className="text-gray-500 text-xs font-mono tracking-widest uppercase flex items-center justify-center">
              <span className="material-symbols-outlined text-[12px] align-middle mr-2">gpp_maybe</span>
              Unauthorized Access Prohibited // IP Logged
            </p>
            <p className="text-gray-600 text-[10px] font-mono tracking-wider mt-1">
              This website is for educational purposes only.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};