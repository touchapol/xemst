import React, { useState, useRef, useEffect, useCallback } from 'react';


interface ProcessingScreenProps {
  accessToken: string;
  workerEndpoint: string;
  workerToken: string;
  activeService: string;
  onBack: () => void;
  onCancel: () => void;
}

type Tab = 'encode' | 'decode';
type DecodeMode = 'direct' | 'bruteforce';

interface LogEntry {
  time: string;
  msg: string;
  type: 'info' | 'success' | 'error' | 'brute_fail' | 'brute_success' | string;
}

export const ProcessingScreen: React.FC<ProcessingScreenProps> = ({ accessToken, workerEndpoint, workerToken, activeService, onBack, onCancel }) => {
  const [tab, setTab] = useState<Tab>('encode');

  const [encodeMp3, setEncodeMp3] = useState<File | null>(null);
  const [encodeSecret, setEncodeSecret] = useState('');
  const [encodeText, setEncodeText] = useState('');

  const [decodeMp3, setDecodeMp3] = useState<File | null>(null);
  const [decodeSecret, setDecodeSecret] = useState('');
  const [decodeMode, setDecodeMode] = useState<DecodeMode>('direct');
  const [wordlistFile, setWordlistFile] = useState<File | null>(null);

  const [bruteChunk, setBruteChunk] = useState('10');
  const [bruteGibberish, setBruteGibberish] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [commandId, setCommandId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<any>(null);
  const [hasResultFile, setHasResultFile] = useState(false);
  const [resultFile, setResultFile] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);
  const logBufferRef = useRef<LogEntry[]>([]);
  const rafRef = useRef<number | null>(null);

  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
    const time = new Date().toTimeString().split(' ')[0];
    logBufferRef.current.push({ time, msg, type });

    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        const batch = logBufferRef.current;
        logBufferRef.current = [];
        rafRef.current = null;

        setLogs(prev => {
          const newLogs = [...prev];
          batch.forEach(newLog => {
            const lastLog = newLogs[newLogs.length - 1];
            if (
              lastLog &&
              lastLog.msg.startsWith('[Frame ') &&
              newLog.msg.startsWith('[Frame ') &&
              lastLog.type === 'info' && newLog.type === 'info'
            ) {
              // Replace the last log if it's strictly a frame update
              newLogs[newLogs.length - 1] = newLog;
            } else {
              newLogs.push(newLog);
            }
          });
          return newLogs;
        });
      });
    }
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    return () => { if (sseRef.current) sseRef.current.close(); };
  }, []);

  const startSSE = useCallback((cmdId: string) => {
    if (sseRef.current) sseRef.current.close();

    const es = new EventSource(`${workerEndpoint}/api/commands/${cmdId}/stream?token=${workerToken}`);
    sseRef.current = es;

    es.addEventListener('log', (e) => {
      const data = JSON.parse(e.data);
      addLog(data.msg, (data.type as LogEntry['type']) || 'info');
    });

    es.addEventListener('done', (e) => {
      const data = JSON.parse(e.data);
      setResult(data.result);
      setHasResultFile(data.hasResultFile || false);
      setResultFile(data.resultFile || null);
      setProcessing(false);

      if (data.hasResultFile) {
        addLog('Result file ready for download', 'success');
      }

      if (data.status === 'failed') {
        const err = data.result?.error || 'Unknown error';
        err.split('\n').filter(Boolean).forEach((line: string) => {
          addLog(line, 'error');
        });
      } else {
        addLog('Done', 'success');
      }

      es.close();
      sseRef.current = null;
    });

    es.onerror = () => {
      es.close();
      sseRef.current = null;
    };
  }, [workerEndpoint, workerToken, addLog]);

  const submitCommand = async (type: string, formData: FormData) => {
    setProcessing(true);
    setResult(null);
    setHasResultFile(false);
    setLogs([]);
    addLog(`Submitting ${type} command...`, 'info');

    try {
      const res = await fetch(`${workerEndpoint}/api/commands`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${workerToken}` },
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        addLog(`Error: ${data.error}`, 'error');
        setProcessing(false);
        return;
      }

      setCommandId(data.commandId);
      addLog(`Command queued: ${data.commandId.slice(0, 8)}...`, 'info');
      startSSE(data.commandId);
    } catch {
      addLog('Failed to connect to worker endpoint', 'error');
      setProcessing(false);
    }
  };

  const handleEncode = () => {
    if (!encodeMp3 || !encodeText.trim()) return;
    const fd = new FormData();
    fd.append('type', 'encode');
    fd.append('file', encodeMp3);

    const params = { secret: encodeSecret, text: encodeText };
    fd.append('params', JSON.stringify(params));

    submitCommand('encode', fd);
  };

  const handleDecode = () => {
    if (!decodeMp3) return;
    if (decodeMode === 'direct') {
      const fd = new FormData();
      fd.append('type', 'decode');
      fd.append('file', decodeMp3);

      const params = { secret: decodeSecret };
      fd.append('params', JSON.stringify(params));

      submitCommand('decode', fd);
    } else {
      const fd = new FormData();
      fd.append('type', 'bruteforce');
      fd.append('file', decodeMp3);
      if (wordlistFile) fd.append('wordlist', wordlistFile);

      const params = {
        chunk_size: parseInt(bruteChunk) || 10,
        check_gibberish: bruteGibberish
      };
      fd.append('params', JSON.stringify(params));

      submitCommand('bruteforce', fd);
    }
  };

  const handleDownload = async () => {
    if (!commandId) return;
    try {
      // In flask the route is /uploads/<id>/<filename>
      const filename = resultFile ? resultFile.replace(/^.*[\\\/]/, '') : `stego_output.mp3`;
      const res = await fetch(`${workerEndpoint}/uploads/${commandId}/${encodeURIComponent(filename)}`, {
        headers: { Authorization: `Bearer ${workerToken}` }
      });
      if (!res.ok) {
        addLog('Download error', 'error');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      addLog('Download failed', 'error');
    }
  };

  const resetForm = () => {
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    setProcessing(false);
    setCommandId(null);
    setResult(null);
    setHasResultFile(false);
    setLogs([]);
  };

  return (
    <div className="flex flex-col items-center w-full max-w-3xl mx-auto px-4 animate-fade-in z-10 relative">
      <div className="flex flex-col gap-2 p-4 mb-6 text-center items-center">
        <h1 className="text-white text-3xl md:text-4xl font-bold tracking-tight uppercase">
          {activeService === 'stegcracker' ? 'StegCracker' : 'MP3Stego'}
        </h1>
        <p className="text-primary-dim text-sm">
          {activeService === 'stegcracker' ? 'Advanced Steghide bruteforce utility' : 'Steganography encoder & decoder'}
        </p>
      </div>

      {/* Tabs */}
      {!processing && !commandId && (
        <div className="flex w-full border-b-2 border-border mb-8">
          {(['encode', 'decode'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); resetForm(); }}
              className={`
                flex-1 py-4 text-sm font-bold uppercase tracking-widest transition-all
                ${tab === t
                  ? 'text-white border-b-2 border-white -mb-[2px]'
                  : 'text-gray-600 hover:text-gray-400'
                }
              `}
            >
              <span className="material-symbols-outlined text-[18px] align-middle mr-2">
                {t === 'encode' ? 'lock' : 'lock_open'}
              </span>
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Encode Tab */}
      {tab === 'encode' && !processing && !commandId && (
        <div className="w-full flex flex-col gap-5 animate-fade-in">
          <FileInput label="Cover File" accept={activeService === 'stegcracker' ? ".jpeg,.jpg,.bmp,.wav,.au" : ".mp3,.wav"} file={encodeMp3} onChange={setEncodeMp3} icon="audio_file" />
          <TextInput label="Secret Passphrase" value={encodeSecret} onChange={setEncodeSecret} placeholder="Enter passphrase for encoding" icon="key" />
          <div>
            <Label icon="edit_note" text="Hidden Message" />
            <textarea
              value={encodeText}
              onChange={(e) => setEncodeText(e.target.value)}
              placeholder="Enter the text to hide inside the file..."
              rows={4}
              className="block w-full bg-black border-2 border-border focus:border-white text-white text-sm font-mono rounded-sm px-4 py-3 placeholder:text-gray-700 focus:ring-0 transition-all outline-none resize-none"
            />
          </div>
          <ActionButton
            onClick={handleEncode}
            disabled={!encodeMp3 || !encodeText.trim()}
            label="ENCODE"
            icon="lock"
          />
        </div>
      )}

      {/* Decode Tab */}
      {tab === 'decode' && !processing && !commandId && (
        <div className="w-full flex flex-col gap-5 animate-fade-in">
          <div className="flex border-2 border-border rounded-sm overflow-hidden">
            {(['direct', 'bruteforce'] as DecodeMode[]).map(m => (
              <button
                key={m}
                onClick={() => setDecodeMode(m)}
                className={`
                  flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-all
                  ${decodeMode === m ? 'bg-white text-black' : 'bg-black text-gray-500 hover:text-white'}
                `}
              >
                {m === 'direct' ? '🔑 Direct Decode' : '💣 Brute Force'}
              </button>
            ))}
          </div>

          <FileInput label="Cover File" accept={activeService === 'stegcracker' ? ".jpeg,.jpg,.bmp,.wav,.au" : ".mp3,.wav"} file={decodeMp3} onChange={setDecodeMp3} icon="audio_file" />

          {decodeMode === 'direct' && (
            <TextInput label="Secret Passphrase" value={decodeSecret} onChange={setDecodeSecret} placeholder="Enter the passphrase" icon="key" />
          )}

          {decodeMode === 'bruteforce' && (
            <div className="flex flex-col gap-4 animate-fade-in border-t-2 border-border pt-4 mt-2">
              <FileInput
                label="Wordlist File (optional — default: rockyou.txt)"
                accept=".txt"
                file={wordlistFile}
                onChange={setWordlistFile}
                icon="dictionary"
              />
              <div className="grid grid-cols-2 gap-4">
                <TextInput label="Concurrency (Chunk)" type="number" min={1} max={50} value={bruteChunk} onChange={setBruteChunk} placeholder="e.g. 10" icon="speed" />
                <div className="flex flex-col justify-center">
                  <div className="flex items-center gap-3 h-14 mt-6">
                    <input
                      type="checkbox"
                      id="gibberish"
                      checked={bruteGibberish}
                      onChange={(e) => setBruteGibberish(e.target.checked)}
                      className="w-5 h-5 bg-black border-2 border-border rounded-sm text-white focus:ring-0 cursor-pointer accent-white"
                    />
                    <label htmlFor="gibberish" className="text-sm text-gray-400 font-mono cursor-pointer select-none">
                      Filter Gibberish Text
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          <ActionButton
            onClick={handleDecode}
            disabled={!decodeMp3}
            label={decodeMode === 'direct' ? 'DECODE' : 'START BRUTE FORCE'}
            icon={decodeMode === 'direct' ? 'lock_open' : 'bolt'}
          />
        </div>
      )}

      {/* Processing / Results */}
      {processing && (
        <div className="w-full flex flex-col gap-4 animate-fade-in">
          <div className="flex items-center gap-3 mb-2">
            <span className="material-symbols-outlined text-2xl text-white animate-spin">progress_activity</span>
            <span className="text-white font-bold uppercase tracking-widest">Processing...</span>
          </div>
          <LogViewer logs={logs} scrollRef={scrollRef} />
        </div>
      )}

      {!processing && logs.length > 0 && (
        <div className="w-full flex flex-col gap-4 animate-fade-in">
          {result?.success !== false ? (
            <div className="flex items-center gap-3 mb-2">
              <span className="material-symbols-outlined text-2xl text-green-500">check_circle</span>
              <span className="text-green-400 font-bold uppercase tracking-widest">Completed</span>
            </div>
          ) : (
            <div className="flex items-center gap-3 mb-2">
              <span className="material-symbols-outlined text-2xl text-red-500">error</span>
              <span className="text-red-400 font-bold uppercase tracking-widest">Failed</span>
            </div>
          )}
          <LogViewer logs={logs} scrollRef={scrollRef} />

          <div className="flex gap-3 mt-2">
            {hasResultFile && (
              <button
                onClick={handleDownload}
                className="flex-1 bg-white text-black font-bold uppercase tracking-widest py-3 rounded-sm hover:bg-gray-200 transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                Download Result
              </button>
            )}
            <button
              onClick={resetForm}
              className="flex-1 border-2 border-border text-white font-bold uppercase tracking-widest py-3 rounded-sm hover:border-white transition-all"
            >
              New Command
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 flex items-center gap-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-500 hover:text-white text-sm font-mono uppercase tracking-widest transition-all"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Back
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
  );
};

const Label: React.FC<{ icon: string; text: string }> = ({ icon, text }) => (
  <label className="block text-xs text-gray-500 font-mono uppercase tracking-widest mb-2">
    <span className="material-symbols-outlined text-[14px] align-middle mr-1">{icon}</span>
    {text}
  </label>
);

const FileInput: React.FC<{
  label: string;
  accept: string;
  file: File | null;
  onChange: (f: File | null) => void;
  icon: string;
}> = ({ label, accept, file, onChange, icon }) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <Label icon={icon} text={label} />
      <div
        onClick={() => ref.current?.click()}
        className={`
          flex items-center gap-3 w-full bg-black border-2 rounded-sm h-14 px-4 cursor-pointer transition-all
          ${file ? 'border-green-800 text-white' : 'border-border text-gray-600 hover:border-gray-500'}
        `}
      >
        <span className="material-symbols-outlined text-[20px]">{file ? 'check_circle' : 'upload_file'}</span>
        <span className="text-sm font-mono truncate">{file ? file.name : 'Click to select file...'}</span>
        <input ref={ref} type="file" accept={accept} className="hidden" onChange={e => onChange(e.target.files?.[0] || null)} />
      </div>
    </div>
  );
};

const TextInput: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon: string;
  type?: 'text' | 'number';
  min?: number;
  max?: number;
}> = ({ label, value, onChange, placeholder, icon, type = 'text', min, max }) => (
  <div>
    <Label icon={icon} text={label} />
    <input
      type={type}
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        let val = e.target.value;
        if (type === 'number' && max !== undefined && val !== '') {
          if (parseInt(val) > max) val = max.toString();
        }
        onChange(val);
      }}
      onBlur={() => {
        let val = value;
        if (type === 'number' && min !== undefined) {
          if (val === '' || parseInt(val) < min) val = min.toString();
        }
        onChange(val);
      }}
      placeholder={placeholder}
      className="block w-full bg-black border-2 border-border focus:border-white text-white text-sm font-mono rounded-sm h-14 px-4 placeholder:text-gray-700 focus:ring-0 transition-all outline-none"
    />
  </div>
);

const ActionButton: React.FC<{
  onClick: () => void;
  disabled: boolean;
  label: string;
  icon: string;
}> = ({ onClick, disabled, label, icon }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`
      group flex w-full items-center justify-center rounded-sm h-14 text-base font-bold tracking-widest uppercase transition-all
      ${!disabled
        ? 'bg-white text-black hover:bg-gray-200 shadow-[0_0_15px_rgba(255,255,255,0.2)] cursor-pointer'
        : 'bg-gray-800 text-gray-600 cursor-not-allowed'
      }
    `}
  >
    <span className="material-symbols-outlined text-xl mr-2">{icon}</span>
    {label}
  </button>
);

const LogViewer: React.FC<{
  logs: LogEntry[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
}> = ({ logs, scrollRef }) => (
  <div className="w-full border-2 border-border bg-black p-4 font-mono text-xs h-64 overflow-hidden rounded-sm">
    <div ref={scrollRef} className="flex flex-col gap-1 h-full overflow-y-auto scrollbar-hide pb-2">
      {logs.map((log, i) => (
        <div key={i} className={`flex gap-3 ${i === logs.length - 1 ? 'opacity-100' : 'opacity-60'}`}>
          <span className="text-gray-600 shrink-0">{log.time}</span>
          <span className="text-white font-bold">&gt;</span>
          <span className={`whitespace-pre-wrap flex-1 break-all ${log.type === 'success' || log.type === 'brute_success' ? 'text-green-400' :
            log.type === 'error' || log.type === 'brute_fail' ? 'text-red-400' : 'text-gray-300'
            }`}>
            {log.type === 'brute_fail' ? (
              <span className="flex items-center gap-2">
                {log.msg}
                <span className="material-symbols-outlined text-red-500 text-[16px] font-bold">close</span>
              </span>
            ) : log.type === 'brute_success' ? (
              <span className="flex flex-col gap-1">
                <span className="flex items-center gap-2">
                  {log.msg.split('|||')[0]}
                  <span className="material-symbols-outlined text-green-500 text-[16px] font-bold">check_circle</span>
                  <span className="text-gray-400">[{log.msg.split('|||')[1]}]</span>
                </span>
                <span className="text-white ml-2 border-l-2 border-green-500/50 pl-3 py-1 bg-white/5 rounded-r-sm break-all whitespace-pre-wrap">
                  {log.msg.split('|||').slice(2).join('|||')}
                </span>
              </span>
            ) : (
              log.msg
            )}
          </span>
        </div>
      ))}
      <div className="animate-blink text-white font-bold mt-1">_</div>
    </div>
  </div>
);