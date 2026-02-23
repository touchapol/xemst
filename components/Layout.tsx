import React from 'react';

interface LayoutProps {
  children: React.ReactNode;
  status?: string;
}

export const Layout: React.FC<LayoutProps> = ({ children, status = 'Active' }) => {
  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Header */}
      <header className="absolute top-8 left-8 flex items-center gap-2 z-50">
        <span className="material-symbols-outlined text-white text-2xl">enhanced_encryption</span>
        <span className="font-bold text-lg tracking-tight uppercase text-gray-400 font-display">
          XEM<span className="text-white">ST</span>
        </span>
      </header>

      {/* Main Content */}
      <main className="flex-grow pt-20 pb-12 flex flex-col items-center justify-center relative">
        {children}
      </main>

      {/* Footer */}
      <footer className="w-full py-6 text-center z-50 relative flex flex-col items-center gap-2">
        <p className="text-gray-600 text-xs uppercase tracking-widest font-mono">
          Why u r here? The fk...
        </p>
        <p className="text-gray-600 text-[10px] font-mono tracking-wider">
          This website is for educational purposes only.
        </p>
      </footer>
    </div>
  );
};