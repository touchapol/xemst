import React, { useCallback, useRef } from 'react';
import { FileData } from '../types';

interface UploadScreenProps {
  onFileSelected: (file: FileData) => void;
}

export const UploadScreen: React.FC<UploadScreenProps> = ({ onFileSelected }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onFileSelected({
        name: file.name,
        size: file.size,
        type: file.type
      });
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFileSelected({
        name: file.name,
        size: file.size,
        type: file.type
      });
    }
  }, [onFileSelected]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[500px] w-full max-w-2xl mx-auto px-4 animate-fade-in relative z-10">
      
      {/* Decorative corners */}
      <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-white opacity-50"></div>
      <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-white opacity-50"></div>
      <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-white opacity-50"></div>
      <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-white opacity-50"></div>

      <div className="w-full bg-surface border border-border p-8 md:p-12 relative z-10 flex flex-col items-center">
        
        <div 
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className="w-full max-w-lg border border-dashed border-border hover:border-white hover:bg-white/5 transition-all duration-300 group cursor-pointer bg-black/40 p-12 mb-8 flex flex-col items-center justify-center text-center min-h-[250px]"
        >
          <input 
            type="file" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileChange}
          />
          <span className="material-symbols-outlined text-6xl text-gray-600 group-hover:text-white transition-colors mb-6">
            note_add
          </span>
          <h3 className="text-xl font-bold uppercase tracking-widest text-white mb-3 group-hover:scale-105 transition-transform">
            Drag & Drop File to Crack
          </h3>
          <p className="text-xs text-primary-dim uppercase tracking-wider font-mono">
            or click to browse system
          </p>
        </div>

        <div className="w-full max-w-lg mb-10">
          <div className="flex flex-col gap-4">
            <div className="relative">
              <label className="block text-xs uppercase tracking-widest text-primary-dim mb-2 font-mono">
                Wordlist (Optional)
              </label>
              <div className="flex gap-2">
                <input 
                  readOnly
                  className="w-full bg-black border border-border text-white px-4 py-3 focus:outline-none focus:border-white placeholder-gray-700 text-sm font-mono transition-colors"
                  placeholder="Default: RockYou.txt"
                  type="text"
                />
                <button 
                  className="bg-border hover:bg-white hover:text-black text-white border border-border px-4 transition-colors flex items-center justify-center" 
                  title="Upload Custom Wordlist"
                >
                  <span className="material-symbols-outlined text-sm">upload_file</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <button 
          onClick={() => fileInputRef.current?.click()}
          className="w-full max-w-xs bg-white text-black font-bold uppercase tracking-widest py-4 hover:bg-gray-200 transition-colors text-sm"
        >
          Select File manually
        </button>
      </div>
    </div>
  );
};