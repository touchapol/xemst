import React, { useState, useEffect } from 'react';
import { AppScreen } from './types';
import { Layout } from './components/Layout';
import { AccessScreen } from './components/AccessScreen';
import { MethodScreen } from './components/MethodScreen';
import { ProcessingScreen } from './components/ProcessingScreen';

const TOKEN_KEY = 'xemst_access_token';

const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>(AppScreen.ACCESS);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [workerEndpoint, setWorkerEndpoint] = useState<string | null>(null);
  const [workerToken, setWorkerToken] = useState<string | null>(null);
  const [activeService, setActiveService] = useState<string>('mp3stego');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) {
      setAccessToken(stored);
      setCurrentScreen(AppScreen.METHOD);
    }
    setLoading(false);
  }, []);

  const handleAccessGranted = (token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    setAccessToken(token);
    setCurrentScreen(AppScreen.METHOD);
  };

  const handleServiceSelected = (endpoint: string, wToken: string, serviceId: string) => {
    setWorkerEndpoint(endpoint);
    setWorkerToken(wToken);
    setActiveService(serviceId);
    setCurrentScreen(AppScreen.PROCESSING);
  };

  const handleBack = () => {
    setWorkerEndpoint(null);
    setWorkerToken(null);
    setCurrentScreen(AppScreen.METHOD);
  };

  const reset = () => {
    setAccessToken(null);
    setWorkerEndpoint(null);
    setWorkerToken(null);
    localStorage.removeItem(TOKEN_KEY);
    setCurrentScreen(AppScreen.ACCESS);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="material-symbols-outlined text-4xl text-white animate-spin">progress_activity</span>
      </div>
    );
  }

  const renderScreen = () => {
    switch (currentScreen) {
      case AppScreen.ACCESS:
        return <AccessScreen onAccessGranted={handleAccessGranted} />;

      case AppScreen.METHOD:
        return (
          <Layout status="Standby">
            <MethodScreen
              onServiceSelected={handleServiceSelected}
              onCancel={reset}
            />
          </Layout>
        );

      case AppScreen.PROCESSING:
        return (
          <Layout status="Active">
            <ProcessingScreen
              accessToken={accessToken!}
              workerEndpoint={workerEndpoint!}
              workerToken={workerToken!}
              activeService={activeService}
              onBack={handleBack}
              onCancel={reset}
            />
          </Layout>
        );

      default:
        return null;
    }
  };

  return (
    <>
      {renderScreen()}
    </>
  );
};

export default App;