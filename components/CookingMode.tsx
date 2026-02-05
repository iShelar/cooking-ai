
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Recipe, AppSettings, DEFAULT_APP_SETTINGS, VOICE_LANGUAGE_OPTIONS } from '../types';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { decode, encode, decodeAudioData } from '../services/geminiService';

interface CookingModeProps {
  recipe: Recipe;
  onExit: () => void;
  appSettings?: AppSettings | null;
}

/** Parse MM:SS or M:SS to seconds for YouTube t= param */
function timestampToSeconds(mmss: string): number {
  const parts = mmss.trim().split(':').map(Number);
  if (parts.length >= 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}

function youtubeUrlAtTime(videoUrl: string, mmss: string): string {
  const sep = videoUrl.includes('?') ? '&' : '?';
  return `${videoUrl}${sep}t=${timestampToSeconds(mmss)}`;
}

/** Get YouTube video ID from watch or youtu.be URL. */
function getYouTubeVideoId(videoUrl: string): string {
  if (videoUrl.includes('v=')) return videoUrl.split('v=')[1]?.split('&')[0] ?? '';
  if (videoUrl.includes('youtu.be/')) return videoUrl.split('youtu.be/')[1]?.split('?')[0] ?? '';
  return '';
}

/** Get YouTube embed URL with optional start time in seconds (for iframe src). */
function getYouTubeEmbedUrl(videoUrl: string, startSeconds?: number): string {
  const videoId = getYouTubeVideoId(videoUrl);
  if (!videoId) return '';
  const params = new URLSearchParams();
  if (startSeconds > 0) params.set('start', String(startSeconds));
  const q = params.toString();
  return `https://www.youtube.com/embed/${videoId}${q ? `?${q}` : ''}`;
}

/** Minimal YT.Player interface for seek, play, pause, stop, mute, destroy. */
interface YTPlayerHandle {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo?: () => void;
  pauseVideo?: () => void;
  stopVideo?: () => void;
  mute?: () => void;
  unMute?: () => void;
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: { Player: new (el: string | HTMLElement, opts: Record<string, unknown>) => YTPlayerHandle };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const celsiusToFahrenheit = (c: number) => Math.round(c * (9 / 5) + 32);
const formatTempForDisplay = (suggestion: string, units: 'metric' | 'imperial'): string => {
  if (units !== 'imperial') return suggestion;
  const match = suggestion.match(/^(\d+)/);
  if (match) {
    const f = celsiusToFahrenheit(Number(match[1]));
    return `${f}°F`;
  }
  return suggestion;
};

const CookingMode: React.FC<CookingModeProps> = ({ recipe, onExit, appSettings: settings }) => {
  const appSettings = settings ?? DEFAULT_APP_SETTINGS;
  const [currentStep, setCurrentStep] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [aiResponse, setAiResponse] = useState('');
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null);
  const [timerIsPaused, setTimerIsPaused] = useState(false);
  const [activeTemperature, setActiveTemperature] = useState<string>('Off');
  const [suggestedTemp, setSuggestedTemp] = useState<string>('');
  const [toolNotification, setToolNotification] = useState<string | null>(null);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [inputVolume, setInputVolume] = useState(0);
  /** When true, show embedded YouTube video that seeks to current step. */
  const [showEmbeddedVideo, setShowEmbeddedVideo] = useState(false);
  /** 'agent' = play assistant TTS; 'video' = mute assistant, user hears iframe. */
  const [audioSource, setAudioSource] = useState<'agent' | 'video'>('agent');

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<'agent' | 'video'>('agent');
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const timerDoneNotifiedRef = useRef(false);
  const currentStepRef = useRef(0);
  const ytPlayerRef = useRef<YTPlayerHandle | null>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const [ytApiReady, setYtApiReady] = useState(false);

  const stepsCount = recipe.steps.length;
  const videoId = recipe.videoUrl ? getYouTubeVideoId(recipe.videoUrl) : '';
  const currentStepSeconds = recipe.stepTimestamps?.[currentStep]
    ? timestampToSeconds(recipe.stepTimestamps[currentStep])
    : 0;

  // Keep refs in sync for callbacks/effects.
  useEffect(() => {
    currentStepRef.current = currentStep;
  }, [currentStep]);
  useEffect(() => {
    audioSourceRef.current = audioSource;
  }, [audioSource]);

  // Load YouTube IFrame API once.
  useEffect(() => {
    if (typeof window === 'undefined' || window.YT) return;
    const existing = document.querySelector('script[src*="youtube.com/iframe_api"]');
    if (existing) return;
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      setYtApiReady(true);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    document.head.appendChild(script);
    return () => {
      window.onYouTubeIframeAPIReady = prev;
    };
  }, []);

  // Create YT player when video is shown; seek when step changes; destroy when hidden.
  useEffect(() => {
    if (!showEmbeddedVideo || !videoId || !ytContainerRef.current) {
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch (_) {}
        ytPlayerRef.current = null;
      }
      return;
    }
    if (!window.YT?.Player) return;

    const el = ytContainerRef.current;
    if (!ytPlayerRef.current) {
      try {
        ytPlayerRef.current = new window.YT!.Player(el, {
          videoId,
          width: '100%',
          height: '200',
          playerVars: { start: currentStepSeconds },
        }) as YTPlayerHandle;
      } catch (_) {
        ytPlayerRef.current = null;
      }
      return;
    }
    try {
      ytPlayerRef.current.seekTo(currentStepSeconds, true);
    } catch (_) {}
  }, [showEmbeddedVideo, videoId, ytApiReady, currentStep, currentStepSeconds]);

  // When leaving cooking mode (e.g. back button) without turning off the assistant, stop voice recording.
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.close();
        sessionRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const getCurrentStepContext = useCallback((stepIndex: number) => {
    const oneBased = stepIndex + 1;
    const instruction = recipe.steps[stepIndex] ?? '';
    const ts = recipe.stepTimestamps?.[stepIndex];
    return `[Context: User is on Step ${oneBased} of ${stepsCount}${ts ? ` (video ${ts})` : ''}. Instruction: "${instruction}". If they say "next" or "next step", you MUST call nextStep(). If they say "previous" or "go back", you MUST call previousStep(). If they ask to go to another step by number, scenario, or time, you MUST call goToStep(index) with the 0-based index from the step list.]`;
  }, [recipe.steps, recipe.stepTimestamps, stepsCount]);

  const playConfirmationSound = useCallback(() => {
    if (!audioContextRef.current) return;
    const ctx = audioContextRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  }, []);

  const notify = (msg: string, silent = false) => {
    setToolNotification(msg);
    if (!silent) playConfirmationSound();
    if (appSettings.hapticFeedback && typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(50);
    }
    setTimeout(() => setToolNotification(null), 2000);
  };

  const syncStepContextToAssistant = useCallback((stepIndex: number) => {
    if (sessionRef.current && isListening) {
      sessionRef.current.sendClientContent({
        turns: getCurrentStepContext(stepIndex),
        turnComplete: false
      });
    }
  }, [isListening, getCurrentStepContext]);

  const triggerNextStep = useCallback(() => {
    const prev = currentStepRef.current;
    const newStep = Math.min(prev + 1, stepsCount - 1);
    currentStepRef.current = newStep;
    setCurrentStep(newStep);
    notify("Next step");
    syncStepContextToAssistant(newStep);
  }, [stepsCount, playConfirmationSound, syncStepContextToAssistant]);

  const triggerPrevStep = useCallback(() => {
    const prev = currentStepRef.current;
    const newStep = Math.max(prev - 1, 0);
    currentStepRef.current = newStep;
    setCurrentStep(newStep);
    notify("Previous step");
    syncStepContextToAssistant(newStep);
  }, [playConfirmationSound, syncStepContextToAssistant]);

  const triggerGoToStep = useCallback((index: number) => {
    const safeIndex = Math.max(0, Math.min(index, stepsCount - 1));
    currentStepRef.current = safeIndex;
    setCurrentStep(safeIndex);
    notify(`Step ${safeIndex + 1}`);
    syncStepContextToAssistant(safeIndex);
  }, [stepsCount, playConfirmationSound, syncStepContextToAssistant]);

  const triggerStartTimer = useCallback((totalSeconds: number) => {
    timerDoneNotifiedRef.current = false;
    const clamped = Math.max(1, Math.floor(totalSeconds));
    setTimerSeconds(clamped);
    setTimerIsPaused(false);
    const m = Math.floor(clamped / 60);
    const s = clamped % 60;
    const label = m > 0 && s > 0 ? `${m}m ${s}s` : m > 0 ? `${m}m` : `${s}s`;
    notify(`Timer: ${label}`);
  }, [playConfirmationSound]);

  const triggerPauseTimer = useCallback(() => {
    setTimerIsPaused(true);
    notify("Timer paused");
  }, [playConfirmationSound]);

  const triggerResumeTimer = useCallback(() => {
    setTimerIsPaused(false);
    notify("Timer resumed");
  }, [playConfirmationSound]);

  const triggerStopTimer = useCallback(() => {
    timerDoneNotifiedRef.current = false;
    setTimerSeconds(null);
    setTimerIsPaused(false);
    notify("Timer stopped");
  }, [playConfirmationSound]);

  const triggerSetTemperature = useCallback((temp: string) => {
    setActiveTemperature(temp);
    notify(`Heat: ${temp}`);
  }, [playConfirmationSound]);

  useEffect(() => {
    const stepText = recipe.steps[currentStep].toLowerCase();
    let suggestion = 'Low';
    if (stepText.includes('boil') || stepText.includes('high heat') || stepText.includes('rolling')) suggestion = 'High';
    else if (stepText.includes('sauté') || stepText.includes('brown') || stepText.includes('sear')) suggestion = 'Med-High';
    else if (stepText.includes('simmer') || stepText.includes('medium heat') || stepText.includes('cook through')) suggestion = 'Medium';
    else if (stepText.includes('oven') || stepText.includes('roast') || stepText.includes('bake')) {
      const matches = stepText.match(/\d{3}/);
      suggestion = matches ? `${matches[0]}°C` : '200°C';
    }
    setSuggestedTemp(suggestion);
  }, [currentStep, recipe.steps]);

  useEffect(() => {
    if (timerSeconds !== null && timerSeconds > 0 && !timerIsPaused) {
      timerIntervalRef.current = window.setInterval(() => {
        setTimerSeconds(prev => (prev !== null && prev > 0 ? prev - 1 : 0));
      }, 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }

    if (timerSeconds === 0 && !timerDoneNotifiedRef.current) {
      timerDoneNotifiedRef.current = true;
      setToolNotification("Timer done!");
      setTimeout(() => setToolNotification(null), 2000);
      if (appSettings.timerSound && audioContextRef.current) {
        const ctx = audioContextRef.current;
        const freq = 880;
        const gainVal = 0.12;
        const ringDur = 0.35;
        const gap = 0.2;
        [0, 1, 2].forEach((i) => {
          const t = ctx.currentTime + i * (ringDur + gap);
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.setValueAtTime(freq, t);
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(gainVal, t + 0.02);
          gain.gain.setValueAtTime(gainVal, t + ringDur - 0.02);
          gain.gain.linearRampToValueAtTime(0, t + ringDur);
          osc.start(t);
          osc.stop(t + ringDur);
        });
      }
      if (appSettings.hapticFeedback && typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([100, 50, 100]);
      }
    }

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [timerSeconds, timerIsPaused]);

  const stopAudio = useCallback(() => {
    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsAssistantSpeaking(false);
  }, []);

  const tools: FunctionDeclaration[] = [
    {
      name: 'startTimer',
      parameters: {
        type: Type.OBJECT,
        description: 'Start a kitchen timer. Pass minutes (use 0 for seconds-only) and optionally seconds (e.g. 5 min, or 0 min + 30 sec).',
        properties: {
          minutes: { type: Type.NUMBER, description: 'Minutes (use 0 for under a minute)' },
          seconds: { type: Type.NUMBER, description: 'Seconds (optional, e.g. 30 for 30 seconds)' }
        },
        required: ['minutes']
      }
    },
    { name: 'pauseTimer', parameters: { type: Type.OBJECT, properties: {} } },
    { name: 'resumeTimer', parameters: { type: Type.OBJECT, properties: {} } },
    { name: 'stopTimer', parameters: { type: Type.OBJECT, properties: {} } },
    {
      name: 'setTemperature',
      parameters: {
        type: Type.OBJECT,
        properties: { level: { type: Type.STRING } },
        required: ['level']
      }
    },
    { name: 'nextStep', parameters: { type: Type.OBJECT, properties: {} } },
    { name: 'previousStep', parameters: { type: Type.OBJECT, properties: {} } },
    {
      name: 'goToStep',
      parameters: {
        type: Type.OBJECT,
        description: 'Jumps the UI to a specific step.',
        properties: { index: { type: Type.NUMBER, description: '0-indexed step number' } },
        required: ['index']
      }
    },
    {
      name: 'setAudioSource',
      parameters: {
        type: Type.OBJECT,
        description: 'Switch whether the user hears the assistant (agent) or the recipe video. Use when they say "use video audio", "I want to hear the video", "switch to agent", etc.',
        properties: {
          source: { type: Type.STRING, enum: ['agent', 'video'], description: 'agent = assistant speaks; video = mute assistant so user hears embedded video' }
        },
        required: ['source']
      }
    },
    {
      name: 'setVideoPlayback',
      parameters: {
        type: Type.OBJECT,
        description: 'Pause, stop, or play the embedded recipe video. Use when the user says "pause the video", "stop the video", "pause video", "play the video", "resume the video", etc.',
        properties: {
          action: { type: Type.STRING, enum: ['play', 'pause', 'stop'], description: 'play = start/resume playback; pause = pause playback; stop = stop and reset to start' }
        },
        required: ['action']
      }
    },
    {
      name: 'setVideoMute',
      parameters: {
        type: Type.OBJECT,
        description: 'Mute or unmute the embedded recipe video. Use when the user says "mute the video", "mute video", "unmute the video", "turn off video sound", etc.',
        properties: {
          muted: { type: Type.BOOLEAN, description: 'true = mute the video; false = unmute the video' }
        },
        required: ['muted']
      }
    }
  ];

  const handleLiveMessage = useCallback(async (message: LiveServerMessage) => {
    const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
    if (audioData && audioContextRef.current) {
      if (audioSourceRef.current === 'video') {
        // User chose to listen to video; don't play agent TTS.
        return;
      }
      setIsAssistantSpeaking(true);
      const ctx = audioContextRef.current;
      nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
      const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = appSettings.voiceSpeed;
      source.connect(ctx.destination);
      source.addEventListener('ended', () => {
        sourcesRef.current.delete(source);
        if (sourcesRef.current.size === 0) setIsAssistantSpeaking(false);
      });
      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += buffer.duration / appSettings.voiceSpeed;
      sourcesRef.current.add(source);
    }

    if (message.toolCall) {
      for (const fc of message.toolCall.functionCalls) {
        if (fc.name === 'startTimer') {
          const mins = typeof fc.args?.minutes === 'number' ? fc.args.minutes : 0;
          const secs = typeof fc.args?.seconds === 'number' ? fc.args.seconds : 0;
          const total = mins * 60 + secs;
          triggerStartTimer(Math.max(1, total));
        }
        else if (fc.name === 'pauseTimer') triggerPauseTimer();
        else if (fc.name === 'resumeTimer') triggerResumeTimer();
        else if (fc.name === 'stopTimer') triggerStopTimer();
        else if (fc.name === 'setTemperature') triggerSetTemperature(fc.args.level as string);
        else if (fc.name === 'nextStep') triggerNextStep();
        else if (fc.name === 'previousStep') triggerPrevStep();
        else if (fc.name === 'goToStep') triggerGoToStep(fc.args.index as number);
        else if (fc.name === 'setAudioSource') setAudioSource((fc.args.source === 'video' ? 'video' : 'agent') as 'agent' | 'video');
        else if (fc.name === 'setVideoPlayback') {
          const action = (fc.args?.action === 'play' || fc.args?.action === 'stop' ? fc.args.action : 'pause') as 'play' | 'pause' | 'stop';
          const player = ytPlayerRef.current;
          if (player) {
            try {
              if (action === 'play') player.playVideo?.();
              else if (action === 'pause') player.pauseVideo?.();
              else player.stopVideo?.();
            } catch (_) {}
          }
        }
        else if (fc.name === 'setVideoMute') {
          const muted = fc.args?.muted === true;
          const player = ytPlayerRef.current;
          if (player) {
            try {
              if (muted) player.mute?.();
              else player.unMute?.();
            } catch (_) {}
          }
        }

        sessionRef.current?.sendToolResponse({
          functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } }
        });
      }
    }

    if (message.serverContent?.outputTranscription) {
      setAiResponse(prev => prev + message.serverContent!.outputTranscription!.text);
    }
    if (message.serverContent?.turnComplete) setAiResponse('');
    if (message.serverContent?.interrupted) stopAudio();
  }, [appSettings.voiceSpeed, triggerNextStep, triggerPrevStep, triggerGoToStep, triggerStartTimer, triggerPauseTimer, triggerResumeTimer, triggerStopTimer, triggerSetTemperature, stopAudio]);

  const toggleVoiceAssistant = async () => {
    if (isListening) {
      if (sessionRef.current) sessionRef.current.close();
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      setIsListening(false);
      setIsAssistantSpeaking(false);
      setInputVolume(0);
      return;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        notify("Voice not supported");
        return;
      }
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      if (!audioContextRef.current) audioContextRef.current = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
      if (!inputAudioContextRef.current) inputAudioContextRef.current = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
      streamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsListening(true);
            // Inject current step context as soon as connection opens (user may have manually navigated before opening mic).
            sessionPromise.then(session => {
              session.sendClientContent({
                turns: getCurrentStepContext(currentStepRef.current),
                turnComplete: false
              });
            });
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const processor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);

            // Tuned for kitchen environments: frying, fans, clinking.
            const NOISE_GATE_THRESHOLD = 0.007;
            const HYSTERESIS_SAMPLES = 15;
            let quietCounter = 0;

            processor.onaudioprocess = (e) => {
              const input = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
              const rms = Math.sqrt(sum / input.length);
              setInputVolume(rms);

              if (rms > NOISE_GATE_THRESHOLD) {
                quietCounter = 0;
                const int16 = new Int16Array(input.length);
                for (let i = 0; i < input.length; i++) int16[i] = input[i] * 32768;
                const pcmBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
                sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
              } else if (quietCounter < HYSTERESIS_SAMPLES) {
                quietCounter++;
                const int16 = new Int16Array(input.length);
                for (let i = 0; i < input.length; i++) int16[i] = input[i] * 32768;
                const pcmBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
                sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
              }
            };
            source.connect(processor);
            processor.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: handleLiveMessage,
          onerror: (e) => console.error(e),
          onclose: () => {
            setIsListening(false);
            setIsAssistantSpeaking(false);
            setInputVolume(0);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: tools }],
          systemInstruction: `You are the CookAI Assistant for "${recipe.title}". 
          
          LANGUAGE: The user may ask or give commands in any language (e.g. Hindi, Spanish). Always understand their intent and carry out the action (next step, pause video, go to step, etc.). Your responses and all speech must be ONLY in ${VOICE_LANGUAGE_OPTIONS.find((o) => o.code === appSettings.voiceLanguage)?.label ?? 'English'}. Do not reply in the user's language—always use ${VOICE_LANGUAGE_OPTIONS.find((o) => o.code === appSettings.voiceLanguage)?.label ?? 'English'} for your output. Recipe steps and UI are in English.
          
          STEP LIST (use the [index] in goToStep(index)—ALWAYS call the tool when changing steps):
          ${recipe.steps.map((s, i) => `[${i}] ${(recipe.stepTimestamps?.[i] ?? '') ? `(${recipe.stepTimestamps[i]}) ` : ''}${s}`).join('\n')}
          
          STEP NAVIGATION (MANDATORY—you MUST call the tool, not only describe):
          - "next", "next step", "go forward" → call nextStep(), then say the new step instruction briefly.
          - "previous", "previous step", "go back", "last step" → call previousStep(), then say the step instruction briefly.
          - "go to step N", "step N", "what's step N" → call goToStep(N-1) (step numbers are 1-based; goToStep uses 0-based index).
          - "when do we [X]", "go to [X]", "the part where we [X]", "what about [ingredient/time]" → find the step whose instruction or timestamp matches [X], then call goToStep(index) with that step's index from the list above. Example: "go to when we add spinach" → find the step that mentions adding spinach, get its [index], call goToStep(index).
          - "at 2 minutes", "at 1:30", "what happens at [time]" → find the step with that timestamp (or closest) in the list, call goToStep(index).
          Never only describe a step without calling nextStep, previousStep, or goToStep—the screen and video only update when you call the tool.
          ${recipe.videoUrl ? `\nVIDEO: Embedded video seeks to the step's timestamp when you call goToStep/nextStep/previousStep. Playback: "pause/stop the video" → setVideoPlayback "pause" or "stop"; "play/resume the video" → setVideoPlayback "play". Volume: "mute the video", "mute video", "turn off video sound" → setVideoMute muted true; "unmute the video", "turn on video sound" → setVideoMute muted false. Audio source: "use video audio" → setAudioSource "video"; "use your voice" → setAudioSource "agent".` : ''}
          
          CRITICAL SYNC & AUDITORY FEEDBACK RULES:
          1. YOU MUST VERBALLY ANNOUNCE EVERY ACTION. Confirmations are required for starting, pausing, stopping timers, setting temperatures, and moving steps.
          2. For step changes: call the tool (nextStep/previousStep/goToStep) first, then say "Okay, next step" or "Previous step" or "Going to [that step]" ONCE and state only what to do (the instruction). Do NOT say the step number (e.g. "Step 2") in that same reply.
          3. WHENEVER the user asks to go to any step (by number, by scenario, or by time), call goToStep(index) with the correct 0-based index from the STEP LIST above.
          4. NEVER repeat the step number twice. After calling a step tool, give one short confirmation and only the instruction, e.g. "Okay. Chop the onions."
          5. NEVER say technical indices like "Index 0" to the user. Say "Step 1" only when they ask which step (and say it once).
          6. Respond instantly and concisely.
          7. If noise is high, keep your verbal confirmations short but clear.`,
          outputAudioTranscription: {},
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error(err);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-stone-50 z-50 flex flex-col overflow-hidden">
      {toolNotification && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] animate-in slide-in-from-top-4 fade-in duration-300">
          <div className="bg-stone-900 text-white px-5 py-2.5 rounded-full shadow-2xl font-bold text-xs flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
            {toolNotification}
          </div>
        </div>
      )}

      <div className="bg-white border-b border-stone-200 px-4 py-4 flex items-center justify-between">
        <button onClick={onExit} className="p-2 -ml-2 text-stone-500">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
        <div className="text-center">
          <h2 className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Step {currentStep + 1} of {stepsCount}</h2>
        </div>
        {recipe.videoUrl ? (
          <button
            onClick={() => setShowEmbeddedVideo((v) => !v)}
            className={`p-2 rounded-xl transition-colors ${showEmbeddedVideo ? 'bg-red-100 text-red-600' : 'text-stone-400 hover:bg-stone-100'}`}
            title={showEmbeddedVideo ? 'Hide video' : 'Show video'}
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
          </button>
        ) : (
          <div className="w-10" />
        )}
      </div>

      <div className="w-full h-1.5 bg-stone-100">
        <div
          className="h-full bg-emerald-500 transition-[width] duration-200 ease-out"
          style={{ width: `${((currentStep + 1) / stepsCount) * 100}%` }}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
        {showEmbeddedVideo && recipe.videoUrl && videoId && (
          <div className="w-full h-[200px] rounded-2xl overflow-hidden border border-stone-200 shadow-lg bg-black flex-shrink-0 relative">
            <div ref={ytContainerRef} className="w-full h-full" />
          </div>
        )}
        <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-stone-100 min-h-[160px] flex flex-col justify-center text-center relative overflow-hidden">
          <span className="text-emerald-500 font-black text-[10px] mb-4 uppercase tracking-[0.3em]">Kitchen Guidance</span>
          <h1 className="text-xl md:text-2xl font-bold text-stone-800 leading-snug">
            {recipe.steps[currentStep]}
          </h1>
          {recipe.videoUrl && recipe.stepTimestamps?.[currentStep] && (
            <a
              href={youtubeUrlAtTime(recipe.videoUrl, recipe.stepTimestamps[currentStep])}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-red-600 hover:text-red-700"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
              Watch at {recipe.stepTimestamps[currentStep]}
            </a>
          )}
        </div>

        {aiResponse && (
          <div className="bg-stone-900 text-white p-4 rounded-2xl shadow-2xl border border-stone-800 flex items-start gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="bg-emerald-500 p-1.5 rounded-lg flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 100-2 1 1 0 000 2zm7-1a1 1 0 11-2 0 1 1 0 012 0zm-7.535 4h5.07a1 1 0 010 2h-5.07a1 1 0 010-2z" /></svg>
            </div>
            <p className="text-sm font-medium leading-relaxed pt-0.5">{aiResponse}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className={`p-5 rounded-[2rem] border transition-all h-36 flex flex-col justify-between ${timerSeconds !== null ? 'bg-emerald-600 text-white shadow-lg border-emerald-500' : 'bg-white border-stone-100 shadow-sm'}`}>
            <p className="text-[9px] uppercase font-black tracking-widest opacity-60">Step Timer</p>
            <p className="text-2xl font-mono font-black">{timerSeconds !== null ? formatTime(timerSeconds) : '0:00'}</p>
            <button onClick={() => triggerStartTimer(5 * 60)} className="w-full h-10 rounded-xl bg-white/20 text-[10px] font-black uppercase tracking-widest backdrop-blur-sm active:scale-95 transition-transform">5m Start</button>
          </div>

          <div className={`p-5 rounded-[2rem] border transition-all h-36 flex flex-col justify-between ${activeTemperature !== 'Off' ? 'bg-orange-500 text-white shadow-lg border-orange-400' : 'bg-white border-stone-100 shadow-sm'}`}>
            <p className="text-[9px] uppercase font-black tracking-widest opacity-60">Heat Level</p>
            <p className="text-2xl font-black">{formatTempForDisplay(activeTemperature, appSettings.units)}</p>
            <button onClick={() => triggerSetTemperature(suggestedTemp)} className="w-full h-10 rounded-xl bg-white/20 text-[10px] font-black uppercase tracking-widest backdrop-blur-sm active:scale-95 transition-transform">{formatTempForDisplay(suggestedTemp, appSettings.units)}</button>
          </div>
        </div>
      </div>

      <div className="bg-white border-t border-stone-200 px-6 py-6 pb-12 space-y-4">
        <div className="flex items-center justify-center gap-8">
          <button onClick={triggerPrevStep} disabled={currentStep === 0} className="w-12 h-12 rounded-2xl bg-stone-50 text-stone-400 disabled:opacity-30 border border-stone-100 active:scale-90 transition-all">
            <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
          </button>

          <div className="relative">
            {isListening && (
              <div
                className="absolute inset-0 bg-emerald-400/20 rounded-full animate-ping transition-transform duration-75 ease-out"
                style={{ transform: `scale(${2 + inputVolume * 10})` }}
              ></div>
            )}
            <button
              onClick={toggleVoiceAssistant}
              className={`w-20 h-20 rounded-full flex items-center justify-center shadow-2xl relative z-10 transition-all active:scale-95 ${isListening ? 'bg-emerald-600 scale-105' : 'bg-emerald-500'}`}
            >
              {isListening ? (
                <div className="flex items-center gap-1 h-8">
                  {[1, 2, 3, 4].map(i => (
                    <div
                      key={i}
                      className="w-1.5 bg-white rounded-full"
                      style={{
                        height: isAssistantSpeaking ? '100%' : `${25 + inputVolume * 1200}%`,
                        maxHeight: '28px',
                        animation: isAssistantSpeaking ? 'wave 0.4s ease-in-out infinite' : 'none',
                        animationDelay: `${i * 0.1}s`
                      }}
                    />
                  ))}
                </div>
              ) : (
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
              )}
            </button>
          </div>

          <button onClick={triggerNextStep} disabled={currentStep === stepsCount - 1} className="w-12 h-12 rounded-2xl bg-stone-50 text-stone-400 disabled:opacity-30 border border-stone-100 active:scale-90 transition-all">
            <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
        <div className="text-center text-stone-400 text-[10px] font-black uppercase tracking-widest h-4">
          {isListening ? (isAssistantSpeaking ? "Assistant Speaking" : "Listening...") : "Tap for Hands-Free Mode"}
        </div>
        {recipe.videoUrl && (
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className="text-stone-400 text-[10px] font-bold uppercase">Listen to:</span>
            <button
              onClick={() => setAudioSource('agent')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${audioSource === 'agent' ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-500'}`}
            >
              Agent
            </button>
            <button
              onClick={() => setAudioSource('video')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${audioSource === 'video' ? 'bg-red-600 text-white' : 'bg-stone-100 text-stone-500'}`}
            >
              Video
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes wave { 0%, 100% { height: 40%; } 50% { height: 100%; } }
      `}</style>
    </div>
  );
};

export default CookingMode;
