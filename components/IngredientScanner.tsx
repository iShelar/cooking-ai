
import React, { useState, useRef, useEffect } from 'react';
import { scanIngredientsFromImage, getRecipeRecommendations } from '../services/geminiService';

interface IngredientScannerProps {
  onClose: () => void;
  onSelectRecipe: (recipe: any) => void;
}

const IngredientScanner: React.FC<IngredientScannerProps> = ({ onClose, onSelectRecipe }) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [step, setStep] = useState<'camera' | 'identifying' | 'results'>('camera');
  const [error, setError] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const startCamera = async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 1080 }, height: { ideal: 1920 } },
        audio: false 
      });
      setStream(s);
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch (err) {
      const message = err instanceof Error ? err.message : "We need camera access to scan. Turn it on in your device settings!";
      setError(message);
    }
  };

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  const stopCamera = () => {
    stream?.getTracks().forEach(track => track.stop());
  };

  const captureAndScan = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    setIsProcessing(true);
    setStep('identifying');

    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    
    const base64Image = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    
    try {
      const foundIngredients = await scanIngredientsFromImage(base64Image);
      setIngredients(foundIngredients);
      
      const recs = await getRecipeRecommendations(foundIngredients);
      setRecommendations(recs);
      setStep('results');
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "We couldn't scan that. Check your connection and try again!";
      setError(message);
      setStep('camera');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-[100] flex flex-col">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-6 flex items-center justify-between z-10 bg-gradient-to-b from-black/60 to-transparent">
        <button onClick={onClose} className="p-2 bg-white/10 backdrop-blur-md rounded-full text-white">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
        <h2 className="text-white font-bold tracking-tight">AI Ingredient Scanner</h2>
        <div className="w-10"></div>
      </div>

      {/* Viewport */}
      <div className="relative flex-1 bg-stone-900 overflow-hidden">
        {error && step === 'camera' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-stone-900 z-20">
            <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <p className="text-white/90 text-sm text-center mb-6">{error}</p>
            <button
              onClick={() => { setError(null); startCamera(); }}
              className="px-5 py-2.5 bg-white text-stone-800 font-semibold rounded-xl"
            >
              Try again
            </button>
          </div>
        )}
        {step === 'camera' && !error && (
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            className="w-full h-full object-cover"
          />
        )}
        
        {step === 'identifying' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-emerald-900/40 backdrop-blur-sm animate-pulse">
            <div className="w-24 h-24 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin mb-6"></div>
            <p className="text-emerald-400 font-black text-xs uppercase tracking-[0.3em]">AI Identifying Ingredients...</p>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />

        {/* Camera UI Overlay */}
        {step === 'camera' && !error && (
          <div className="absolute bottom-12 left-0 right-0 flex flex-col items-center gap-8">
            <p className="text-white/70 text-sm font-medium">Point at your ingredients</p>
            <button 
              onClick={captureAndScan}
              className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center active:scale-90 transition-transform"
            >
              <div className="w-16 h-16 bg-white rounded-full"></div>
            </button>
          </div>
        )}
      </div>

      {/* Results Bottom Sheet */}
      {step === 'results' && (
        <div className="bg-white rounded-t-[3rem] p-8 space-y-8 animate-in slide-in-from-bottom-full duration-500 ease-out max-h-[70vh] overflow-y-auto shadow-2xl">
          <div className="w-12 h-1.5 bg-stone-200 rounded-full mx-auto -mt-2"></div>
          
          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Ingredients Detected</h3>
            <div className="flex flex-wrap gap-2">
              {ingredients.map((ing, i) => (
                <span key={i} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold border border-emerald-100">
                  {ing}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-bold text-stone-800">Suggested Recipes</h3>
            <div className="space-y-4">
              {recommendations.map((rec, i) => (
                <div 
                  key={i} 
                  onClick={() => onSelectRecipe(rec)}
                  className="p-4 rounded-2xl bg-stone-50 border border-stone-100 flex items-center justify-between group active:scale-[0.98] transition-all cursor-pointer"
                >
                  <div className="space-y-1">
                    <h4 className="font-bold text-stone-800 group-hover:text-emerald-600 transition-colors">{rec.title}</h4>
                    <p className="text-xs text-stone-500 line-clamp-1">{rec.description}</p>
                  </div>
                  <div className="p-2 bg-white rounded-xl shadow-sm">
                    <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button 
            onClick={() => setStep('camera')}
            className="w-full py-4 text-stone-400 font-bold text-sm uppercase tracking-widest"
          >
            Scan Again
          </button>
        </div>
      )}
    </div>
  );
};

export default IngredientScanner;
