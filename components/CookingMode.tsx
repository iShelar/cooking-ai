
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Recipe, AppSettings, DEFAULT_APP_SETTINGS, VOICE_LANGUAGE_OPTIONS } from '../types';
import { decodeAudioData, getInventoryUpdatesForRecipeFromAPI } from '../services/geminiService';
import { getAuthToken } from '../services/apiClient';
import { getInventory, applyInventoryUpdates } from '../services/dbService';
import { getInventoryUpdatesForRecipe } from '../services/shoppingListService';
import { resampleTo16k, float32ToInt16Pcm, BATCH_SAMPLES_16K } from '../services/voiceAudioUtils';

interface CookingModeProps {
  recipe: Recipe;
  onExit: () => void;
  appSettings?: AppSettings | null;
  /** When set, finishing the recipe will subtract used ingredients from this user's inventory. */
  userId?: string;
}

/** Parse MM:SS or M:SS to seconds for YouTube t= param */
function timestampToSeconds(mmss: string): number {
  const parts = mmss.trim().split(':').map(Number);
  if (parts.length >= 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
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

/** Insert spaces in run-together Indic (e.g. Devanagari) text so words don't stick together. */
function formatIndicSpacing(text: string): string {
  if (!text || text.length < 2) return text;
  let out = text;
  // Space between letter and digit: "पायरी5" -> "पायरी 5", "2चमचे" -> "2 चमचे"
  out = out.replace(/(\D)(\d)/g, '$1 $2').replace(/(\d)(\D)/g, '$1 $2');
  // Space after punctuation when followed by a letter: ".एका" -> ". एका"
  out = out.replace(/([.।,!?])(\S)/g, '$1 $2');
  // Devanagari independent vowels (अ आ इ ई उ ऊ ए ऐ ओ औ) often start words: "जातआहे" -> "जात आहे"
  const devanagariIndependentVowel = /[\u0904-\u0914]/;
  const devanagariChar = /[\u0900-\u097F]/;
  const chars = [...out];
  const result: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const prev = i > 0 ? chars[i - 1] : ' ';
    const curr = chars[i];
    if (prev !== ' ' && curr !== ' ' && devanagariIndependentVowel.test(curr) && devanagariChar.test(prev)) {
      result.push(' ');
    }
    result.push(curr);
  }
  return result.join('').replace(/\s+/g, ' ').trim();
}
const formatTempForDisplay = (suggestion: string, units: 'metric' | 'imperial'): string => {
  if (units !== 'imperial') return suggestion;
  const match = suggestion.match(/^(\d+)/);
  if (match) {
    const f = celsiusToFahrenheit(Number(match[1]));
    return `${f}°F`;
  }
  return suggestion;
};

/** Human-readable label for a tool call (for "AI is deciding: ..." indicator). */
function getThinkingLabelForToolCall(fc: { name: string; args?: Record<string, unknown> }): string {
  const name = fc.name;
  const args = fc.args ?? {};
  switch (name) {
    case 'nextStep': return 'go to next step';
    case 'previousStep': return 'go to previous step';
    case 'goToStep': {
      const index = typeof args.index === 'number' ? args.index : 0;
      return `navigate to step ${index + 1}`;
    }
    case 'startTimer': {
      const mins = typeof args.minutes === 'number' ? args.minutes : 0;
      const secs = typeof args.seconds === 'number' ? args.seconds : 0;
      if (mins > 0 && secs > 0) return `set ${mins}m ${secs}s timer`;
      if (mins > 0) return `set ${mins} minute timer`;
      if (secs > 0) return `set ${secs} second timer`;
      return 'set timer';
    }
    case 'pauseTimer': return 'pause timer';
    case 'resumeTimer': return 'resume timer';
    case 'stopTimer': return 'stop timer';
    case 'setTemperature': return `set heat to ${args.level ?? '…'}`;
    case 'setAudioSource': return `switch to ${args.source === 'video' ? 'video' : 'agent'} audio`;
    case 'setVideoPlayback': return `${args.action ?? 'play'} video`;
    case 'setVideoMute': return (args.muted ? 'mute' : 'unmute') + ' video';
    case 'finishRecipe': return 'finish recipe and update inventory';
    default: return name;
  }
}

/** Set to true to show the Heat Level UI in cooking mode. */
const SHOW_HEAT_UI = false;

const CookingMode: React.FC<CookingModeProps> = ({ recipe, onExit, appSettings: settings, userId }) => {
  const appSettings = settings ?? DEFAULT_APP_SETTINGS;
  const [currentStep, setCurrentStep] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [aiResponse, setAiResponse] = useState('');
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null);
  const [timerIsPaused, setTimerIsPaused] = useState(false);
  const [activeTemperature, setActiveTemperature] = useState<string>('Off');
  const [suggestedTemp, setSuggestedTemp] = useState<string>('');
  const [toolNotification, setToolNotification] = useState<string | null>(null);
  /** Brief "AI is deciding: ..." label shown before executing a tool call (agentic reasoning visible to judges). */
  const [aiThinkingAction, setAiThinkingAction] = useState<string | null>(null);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [inputVolume, setInputVolume] = useState(0);
  /** When true, show embedded YouTube video that seeks to current step. Default on when recipe has video. */
  const [showEmbeddedVideo, setShowEmbeddedVideo] = useState(true);
  /** 'agent' = play assistant TTS, video muted; 'video' = mute assistant, user hears iframe. */
  const [audioSource, setAudioSource] = useState<'agent' | 'video'>('agent');
  /** Kitchen Guidance accordion: closed by default; user can open it. */
  const [kitchenGuidanceOpen, setKitchenGuidanceOpen] = useState(false);
  /** Ingredients accordion: closed by default; listed below timer. */
  const [ingredientsAccordionOpen, setIngredientsAccordionOpen] = useState(false);
  /** Assistant strip: open by default so full controls are visible on launch. */
  const [assistantExpanded, setAssistantExpanded] = useState(true);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<'agent' | 'video'>('agent');
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const audioQueueRef = useRef<Uint8Array[]>([]);
  const audioProcessingRef = useRef(false);
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const inputNodeRef = useRef<AudioNode | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const timerDoneNotifiedRef = useRef(false);
  const currentStepRef = useRef(0);
  const ytPlayerRef = useRef<YTPlayerHandle | null>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const captionsScrollRef = useRef<HTMLDivElement>(null);
  const newTurnStartedRef = useRef(true);
  const [ytApiReady, setYtApiReady] = useState(false);
  /** Increment to force video iframe to be destroyed and recreated (reload without full page refresh). */
  const [videoReloadKey, setVideoReloadKey] = useState(0);
  /** When on last step, user can dismiss the finish bar; we show it again after the 2.5 min reminder. */
  const [finishPromptDismissed, setFinishPromptDismissed] = useState(false);
  /** Shown briefly after voice "play video" so user can tap video if programmatic play was blocked (e.g. mobile). */
  const [showTapToPlayHint, setShowTapToPlayHint] = useState(false);

  const reachedLastStepAtRef = useRef<number | null>(null);
  const finishReminderTimeoutRef = useRef<number | null>(null);

  const stepsCount = recipe.steps.length;
  const videoId = recipe.videoUrl ? getYouTubeVideoId(recipe.videoUrl) : '';
  const currentStepSeconds = recipe.stepTimestamps?.[currentStep]
    ? timestampToSeconds(recipe.stepTimestamps[currentStep])
    : 0;

  // Keep refs in sync for callbacks/effects.
  useEffect(() => {
    currentStepRef.current = currentStep;
  }, [currentStep]);

  const isOnLastStep = stepsCount > 0 && currentStep === stepsCount - 1;
  // When user reaches last step: record time and set 2.5 min reminder. When they leave last step, clear.
  useEffect(() => {
    if (!isOnLastStep) {
      reachedLastStepAtRef.current = null;
      if (finishReminderTimeoutRef.current) {
        clearTimeout(finishReminderTimeoutRef.current);
        finishReminderTimeoutRef.current = null;
      }
      return;
    }
    if (reachedLastStepAtRef.current === null) reachedLastStepAtRef.current = Date.now();
    if (finishReminderTimeoutRef.current) return;
    finishReminderTimeoutRef.current = window.setTimeout(() => {
      finishReminderTimeoutRef.current = null;
      setFinishPromptDismissed(false);
      setToolNotification("Done cooking? Update your inventory below.");
      setTimeout(() => setToolNotification(null), 4000);
    }, 2.5 * 60 * 1000);
    return () => {
      if (finishReminderTimeoutRef.current) {
        clearTimeout(finishReminderTimeoutRef.current);
        finishReminderTimeoutRef.current = null;
      }
    };
  }, [isOnLastStep]);
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

  // Create YT player when video is shown; seek when step changes; destroy when hidden. videoReloadKey forces recreate.
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
      el.innerHTML = '';
      try {
        // Start muted so agent mode is default; user must ask agent to unmute or switch to Video.
        const player = new window.YT!.Player(el, {
          videoId,
          width: '100%',
          height: '200',
          playerVars: { start: currentStepSeconds, mute: 1 },
          events: {
            onReady: (event: { target: YTPlayerHandle }) => {
              if (audioSourceRef.current === 'agent') event.target.mute?.();
              else event.target.unMute?.();
            },
          },
        }) as YTPlayerHandle;
        ytPlayerRef.current = player;
        if (audioSourceRef.current === 'video') player.unMute?.();
      } catch (_) {
        ytPlayerRef.current = null;
      }
      return;
    }
    try {
      ytPlayerRef.current.seekTo(currentStepSeconds, true);
    } catch (_) {}
  }, [showEmbeddedVideo, videoId, ytApiReady, currentStep, currentStepSeconds, videoReloadKey]);

  const handleReloadVideo = useCallback(() => {
    if (!ytContainerRef.current) return;
    if (ytPlayerRef.current) {
      try {
        ytPlayerRef.current.destroy();
      } catch (_) {}
      ytPlayerRef.current = null;
    }
    ytContainerRef.current.innerHTML = '';
    setVideoReloadKey((k) => k + 1);
  }, []);

  // Keep video muted when agent is selected, unmuted when video is selected. Pause when switching to agent so video doesn't keep running.
  useEffect(() => {
    if (!showEmbeddedVideo || !ytPlayerRef.current) return;
    const p = ytPlayerRef.current;
    if (audioSource === 'agent') {
      p.mute?.();
      p.pauseVideo?.();
    } else {
      p.unMute?.();
    }
  }, [audioSource, showEmbeddedVideo]);

  // Scroll captions to bottom when new content is added (defer so DOM has updated).
  useEffect(() => {
    const el = captionsScrollRef.current;
    if (!el) return;
    const id = setTimeout(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, 0);
    return () => clearTimeout(id);
  }, [aiResponse]);

  const closeSessionAndCleanup = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      try {
        session.close();
      } catch (_) {}
    }
    if (inputNodeRef.current && inputSourceRef.current) {
      try {
        inputNodeRef.current.disconnect();
        inputSourceRef.current.disconnect();
      } catch (_) {}
      inputNodeRef.current = null;
      inputSourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // When leaving cooking mode (e.g. back button or screen change), stop voice and audio.
  const stopAudio = useCallback(() => {
    audioQueueRef.current = [];
    audioProcessingRef.current = false;
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (_) {}
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsAssistantSpeaking(false);
  }, []);

  useEffect(() => {
    return () => {
      closeSessionAndCleanup();
      stopAudio();
    };
  }, [closeSessionAndCleanup, stopAudio]);

  const getCurrentStepContext = useCallback((stepIndex: number) => {
    const oneBased = stepIndex + 1;
    const instruction = recipe.steps[stepIndex] ?? '';
    const ts = recipe.stepTimestamps?.[stepIndex];
    return `[Context: User is on Step ${oneBased} of ${stepsCount}${ts ? ` (video ${ts})` : ''}. Instruction: "${instruction}".

NEW STEP RULE: User just started this step. (1) TIMER: Only suggest a timer when the step actually has a clear duration that helps a beginner (e.g. "simmer for 10 minutes", "bake 20 min", "rest 5 minutes")—not just because the word "timer" appears. Do not suggest a timer on every step; only when the instruction clearly implies a specific cooking or resting time. Suggest once: "Want me to set a X minute timer?" Only call startTimer after the user confirms. (2) HEAT: If the step implies a heat level (sauté, boil, medium heat, sear, etc.), just say the suggestion once (e.g. "Use medium heat for this step" or "I'd suggest medium-high here"). Do NOT offer to set it or call setTemperature—only suggest the level; the user will set it themselves if they want.

DO NOT REPEAT: Say the step instruction and any timer or heat suggestion exactly ONCE. Never say the same sentence or phrase twice in a row.

If they say "next" or "next step", you MUST call nextStep(). If they say "previous" or "go back", you MUST call previousStep(). If they say a step number in any language (e.g. "7", "step 7", "payari saat", "7 vr chal"), call goToStep(that number minus 1). Always respond to every voice input; never stay silent.]`;
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
    const ws = sessionRef.current as WebSocket | null;
    if (ws && isListening && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          clientContent: {
            turns: getCurrentStepContext(stepIndex),
            turnComplete: false
          }
        }));
      } catch (_) {}
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

  // Update suggested heat only when this step implies a heat level. If the step doesn't mention heat
  // (e.g. "add parsley on top"), keep the previous suggestion. If the step says to turn off heat, clear it.
  useEffect(() => {
    const stepText = recipe.steps[currentStep].toLowerCase();
    const turnOffHeat = /remove from heat|turn off|take off (the )?heat|off the heat|stop cooking/.test(stepText);
    if (turnOffHeat) {
      setSuggestedTemp('');
      return;
    }
    let suggestion = '';
    if (stepText.includes('boil') || stepText.includes('high heat') || stepText.includes('rolling')) suggestion = 'High';
    else if (stepText.includes('sauté') || stepText.includes('brown') || stepText.includes('sear')) suggestion = 'Med-High';
    else if (stepText.includes('simmer') || stepText.includes('medium heat') || stepText.includes('cook through')) suggestion = 'Medium';
    else if (stepText.includes('low') || stepText.includes('gentle') || stepText.includes('melt') || stepText.includes('low heat')) suggestion = 'Low';
    else if (stepText.includes('oven') || stepText.includes('roast') || stepText.includes('bake')) {
      const matches = stepText.match(/\d{3}/);
      suggestion = matches ? `${matches[0]}°C` : '200°C';
    }
    if (suggestion !== '') setSuggestedTemp(suggestion);
  }, [currentStep, recipe.steps]);

  /** Tap timer: start 1 min if idle, else add 1 min. */
  const handleTimerTap = useCallback(() => {
    timerDoneNotifiedRef.current = false;
    if (timerSeconds === null || timerSeconds <= 0) {
      setTimerSeconds(60);
      setTimerIsPaused(false);
      notify('Timer: 1 min');
    } else {
      setTimerSeconds(prev => (prev !== null ? prev + 60 : 60));
      setTimerIsPaused(false);
      notify('Timer +1 min');
    }
  }, [timerSeconds]);

  /** Heat suggestion → background/text color (low=cool, medium=warm, high=hot). */
  const heatColorClasses = useCallback((label: string) => {
    const s = label.toLowerCase();
    if (s.includes('low') || s === 'gentle') return { bg: 'bg-sky-500', border: 'border-sky-400', btn: 'bg-white/20' };
    if (s.includes('medium') || s === 'medium') return { bg: 'bg-amber-500', border: 'border-amber-400', btn: 'bg-white/20' };
    if (s.includes('med-high') || s.includes('med high')) return { bg: 'bg-orange-500', border: 'border-orange-400', btn: 'bg-white/20' };
    if (s.includes('high') || s.includes('boil')) return { bg: 'bg-red-500', border: 'border-red-400', btn: 'bg-white/20' };
    if (/\d+°?c|°?f/i.test(label)) return { bg: 'bg-red-600', border: 'border-red-500', btn: 'bg-white/20' };
    return { bg: 'bg-stone-500', border: 'border-stone-400', btn: 'bg-white/20' };
  }, []);

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

  const processAudioQueue = useCallback(async () => {
    if (audioProcessingRef.current || audioQueueRef.current.length === 0 || !audioContextRef.current) return;
    if (audioSourceRef.current === 'video') return;
    const ctx = audioContextRef.current;
    const raw = audioQueueRef.current.shift();
    if (!raw) return;
    audioProcessingRef.current = true;
    try {
      const buffer = await decodeAudioData(raw, ctx, 24000, 1);
      nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = appSettings.voiceSpeed;
      source.connect(ctx.destination);
      source.addEventListener('ended', () => {
        sourcesRef.current.delete(source);
        if (sourcesRef.current.size === 0) setIsAssistantSpeaking(false);
      });
      sourcesRef.current.add(source);
      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += buffer.duration / appSettings.voiceSpeed;
    } catch (_) {}
    audioProcessingRef.current = false;
    processAudioQueue();
  }, [appSettings.voiceSpeed]);

  const tools = [
    {
      name: 'startTimer',
      parameters: {
        type: 'OBJECT',
        description: 'Start a kitchen timer. Pass minutes (use 0 for seconds-only) and optionally seconds (e.g. 5 min, or 0 min + 30 sec).',
        properties: {
          minutes: { type: 'NUMBER', description: 'Minutes (use 0 for under a minute)' },
          seconds: { type: 'NUMBER', description: 'Seconds (optional, e.g. 30 for 30 seconds)' }
        },
        required: ['minutes']
      }
    },
    { name: 'pauseTimer', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'resumeTimer', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'stopTimer', parameters: { type: 'OBJECT', properties: {} } },
    {
      name: 'setTemperature',
      parameters: {
        type: 'OBJECT',
        properties: { level: { type: 'STRING' } },
        required: ['level']
      }
    },
    { name: 'nextStep', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'previousStep', parameters: { type: 'OBJECT', properties: {} } },
    {
      name: 'goToStep',
      parameters: {
        type: 'OBJECT',
        description: 'Jumps the UI to a specific step.',
        properties: { index: { type: 'NUMBER', description: '0-indexed step number' } },
        required: ['index']
      }
    },
    {
      name: 'setAudioSource',
      parameters: {
        type: 'OBJECT',
        description: 'Switch whether the user hears the assistant (agent) or the recipe video. Use when they say "use video audio", "I want to hear the video", "switch to agent", etc.',
        properties: {
          source: { type: 'STRING', enum: ['agent', 'video'], description: 'agent = assistant speaks; video = mute assistant so user hears embedded video' }
        },
        required: ['source']
      }
    },
    {
      name: 'setVideoPlayback',
      parameters: {
        type: 'OBJECT',
        description: 'Pause, stop, or play the embedded recipe video. Call this when the user says "play the video", "start the video", "start video", "play video", "resume the video", "pause the video", "stop the video", "pause video", etc.',
        properties: {
          action: { type: 'STRING', enum: ['play', 'pause', 'stop'], description: 'play = start or resume playback; pause = pause; stop = stop and reset to start' }
        },
        required: ['action']
      }
    },
    {
      name: 'setVideoMute',
      parameters: {
        type: 'OBJECT',
        description: 'Mute or unmute the embedded recipe video. Use when the user says "mute the video", "mute video", "unmute the video", "turn off video sound", etc.',
        properties: {
          muted: { type: 'BOOLEAN', description: 'true = mute the video; false = unmute the video' }
        },
        required: ['muted']
      }
    },
    {
      name: 'finishRecipe',
      parameters: {
        type: 'OBJECT',
        description: 'Call when the user says they have finished cooking the recipe (e.g. "I\'m done", "we\'re finished", "recipe complete", "all done"). This subtracts the recipe ingredients from their inventory and exits cooking mode.',
        properties: {}
      }
    }
  ];

  const handleLiveMessage = useCallback(async (message: any) => {
    // Process tool calls first so the step indicator and UI update immediately, before audio.
    // Show "AI is deciding: ..." briefly before executing so agentic reasoning is visible (judges).
    if (message.toolCall) {
      const calls = message.toolCall.functionCalls as Array<{ id?: string; name: string; args?: Record<string, unknown> }>;
      const firstLabel = calls.length > 0 ? getThinkingLabelForToolCall(calls[0]) : null;
      if (firstLabel) {
        setAiThinkingAction(`AI is deciding: ${firstLabel}…`);
      }
      const runTools = () => {
        for (const fc of calls) {
          if (fc.name === 'startTimer') {
            const mins = typeof fc.args?.minutes === 'number' ? fc.args.minutes : 0;
            const secs = typeof fc.args?.seconds === 'number' ? fc.args.seconds : 0;
            const total = mins * 60 + secs;
            triggerStartTimer(Math.max(1, total));
          }
          else if (fc.name === 'pauseTimer') triggerPauseTimer();
          else if (fc.name === 'resumeTimer') triggerResumeTimer();
          else if (fc.name === 'stopTimer') triggerStopTimer();
          else if (fc.name === 'setTemperature') triggerSetTemperature(fc.args?.level as string);
          else if (fc.name === 'nextStep') triggerNextStep();
          else if (fc.name === 'previousStep') triggerPrevStep();
          else if (fc.name === 'goToStep') triggerGoToStep(fc.args?.index as number);
          else if (fc.name === 'setAudioSource') {
            const source = (fc.args?.source === 'video' ? 'video' : 'agent') as 'agent' | 'video';
            setAudioSource(source);
            const player = ytPlayerRef.current;
            if (source === 'video' && player) {
              try {
                player.unMute?.();
                player.playVideo?.();
              } catch (_) {}
            } else if (source === 'agent' && player) {
              try { player.mute?.(); } catch (_) {}
            }
          }
          else if (fc.name === 'setVideoPlayback') {
            const action = (fc.args?.action === 'play' || fc.args?.action === 'stop' ? fc.args?.action : 'pause') as 'play' | 'pause' | 'stop';
            const player = ytPlayerRef.current;
            if (player) {
              try {
                if (action === 'play') {
                  player.playVideo?.();
                  setShowTapToPlayHint(true);
                  setTimeout(() => setShowTapToPlayHint(false), 5000);
                } else if (action === 'pause') player.pauseVideo?.();
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
          else if (fc.name === 'finishRecipe') {
            if (userId) {
              (async () => {
                try {
                  const inventory = await getInventory(userId);
                  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients.filter((i): i is string => typeof i === 'string' && !!i.trim()) : [];
                  let updates: { itemId: string; newQuantity: string | null }[];
                  try {
                    updates = await getInventoryUpdatesForRecipeFromAPI(ingredients, inventory);
                  } catch {
                    updates = getInventoryUpdatesForRecipe(recipe, inventory);
                  }
                  await applyInventoryUpdates(userId, updates);
                  notify('Ingredients subtracted from inventory.');
                } catch {
                  notify('Could not update inventory.');
                }
                onExit();
              })();
            } else {
              onExit();
            }
          }

          // Send tool response back through WebSocket
          const ws = sessionRef.current as WebSocket | null;
          if (ws && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({
                toolResponse: {
                  functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } }
                }
              }));
            } catch (_) {}
          }
        }
      };
      // Brief delay so the thinking indicator is visible before the action executes
      const thinkingDelayMs = 180;
      const clearDelayMs = 550;
      if (firstLabel) {
        setTimeout(() => {
          runTools();
          setTimeout(() => setAiThinkingAction(null), clearDelayMs);
        }, thinkingDelayMs);
      } else {
        runTools();
      }
    }

    // Audio is now received as binary WebSocket messages (handled in ws.onmessage), not here.

    if (message.serverContent?.outputTranscription) {
      const text = (message.serverContent.outputTranscription.text ?? '').trim();
      if (!text) return;
      if (newTurnStartedRef.current) {
        newTurnStartedRef.current = false;
        setAiResponse(text);
      } else {
        setAiResponse(prev => {
          if (prev.endsWith(text) || text === prev) return prev;
          const needSpace = prev.length > 0 && text.length > 0 && !/\s$/.test(prev) && !/^\s/.test(text);
          return prev + (needSpace ? ' ' : '') + text;
        });
      }
    }
    if (message.serverContent?.turnComplete) {
      newTurnStartedRef.current = true;
    }
    if (message.serverContent?.interrupted) {
      newTurnStartedRef.current = true;
      setAiResponse('');
      stopAudio();
    }
  }, [userId, recipe, onExit, triggerNextStep, triggerPrevStep, triggerGoToStep, triggerStartTimer, triggerPauseTimer, triggerResumeTimer, triggerStopTimer, triggerSetTemperature, stopAudio, processAudioQueue]);

  const toggleVoiceAssistant = async () => {
    if (isListening) {
      closeSessionAndCleanup();
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
      if (!audioContextRef.current) audioContextRef.current = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
      if (!inputAudioContextRef.current) inputAudioContextRef.current = new AudioContext({ latencyHint: 'interactive' });
      await audioContextRef.current.resume?.();
      await inputAudioContextRef.current.resume?.();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
      streamRef.current = stream;

      const inputCtx = inputAudioContextRef.current;
      const inputRate = inputCtx.sampleRate;

      // Connect to the Python backend via WebSocket (proxied by Vite in dev)
      const wsBase = (import.meta.env.VITE_LIVE_WS_URL as string) || window.location.origin;
      const token = await getAuthToken();
      const wsUrl = wsBase.replace(/^http/, 'ws') + '/ws' + (token ? `?token=${encodeURIComponent(token)}` : '');
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        // 1. Send setup config as first message
        ws.send(JSON.stringify({
          setup: {
            responseModalities: ['AUDIO'],
            tools: [{ functionDeclarations: tools }],
            contextWindowCompression: { slidingWindow: {} },
            systemInstruction: `You are the Pakao Assistant for "${recipe.title}". 
          
          INGREDIENTS (quantities for ${recipe.servings ?? 1} ${(recipe.servings ?? 1) === 1 ? 'serving' : 'servings'}—use this to answer "what do we need?", "do we have X?", "list ingredients", etc.):
          ${Array.isArray(recipe.ingredients) ? recipe.ingredients.filter((i): i is string => typeof i === 'string' && !!i.trim()).map((line, i) => `${i + 1}. ${line.trim()}`).join('\n          ') : 'None listed.'}
          
          LANGUAGE: The user may speak in any language or mix (e.g. English, Hindi, Marathi, "step 7", "payari saat", "7th step vr chal"). ALWAYS interpret intent and act—never ignore or stay silent. Recognize numbers in any form (7, seven, saat, सात, etc.) as step numbers. Your responses and all speech must be ONLY in ${VOICE_LANGUAGE_OPTIONS.find((o) => o.code === appSettings.voiceLanguage)?.label ?? 'English'}. Recipe steps and UI are in English.
          
          GO TO STEP BY NUMBER (mixed language): When the user says a step number in any language or mix—e.g. "step 7", "7th step", "go to 7", "payari 7", "saatvan step", "number 7", "7 (saat) step (payari) vr chal", "step saat"—you MUST call goToStep(N-1) where N is that number (goToStep uses 0-based index). Extract the number from speech even if it's in Hindi/Marathi (ek=1, do=2, teen=3, char=4, paanch=5, chhe=6, saat=7, aath=8, nau=9, dus=10). Always respond and call the tool; do not say you didn't understand.
          
          STEP LIST (use the [index] in goToStep(index)—ALWAYS call the tool when changing steps):
          ${recipe.steps.map((s, i) => `[${i}] ${(recipe.stepTimestamps?.[i] ?? '') ? `(${recipe.stepTimestamps[i]}) ` : ''}${s}`).join('\n')}
          
          STEP NAVIGATION (MANDATORY—you MUST call the tool, not only describe):
          - "next", "next step", "go forward", "what's next" → call nextStep() FIRST (before speaking), then say the new step instruction briefly.
          - "previous", "previous step", "go back", "last step" → call previousStep() FIRST (before speaking), then say the step instruction briefly.
          - "go to step N", "step N", "what's step N", or any phrase containing a step number (in English or another language) → call goToStep(N-1) FIRST (step numbers are 1-based; goToStep uses 0-based index). If you hear a number and "step" or "payari" or "vr chal"/"pe jao", treat it as "go to that step".
          - "when do we [X]", "go to [X]", "the part where we [X]", "what about [ingredient/time]" → find the step whose instruction or timestamp matches [X], then call goToStep(index) with that step's index from the list above. Example: "go to when we add spinach" → find the step that mentions adding spinach, get its [index], call goToStep(index).
          - "at 2 minutes", "at 1:30", "what happens at [time]" → find the step with that timestamp (or closest) in the list, call goToStep(index).
          Never only describe a step without calling nextStep, previousStep, or goToStep—the screen and video only update when you call the tool.
          AUDIO/STEP SYNC (CRITICAL): When you call nextStep(), the instruction you speak in the SAME turn must be the instruction of the step you are moving TO (the next step in the STEP LIST—one line down). When you call previousStep(), speak the instruction of the step you are moving back TO (the previous line). When you call goToStep(i), speak the instruction at index [i] in the list. The screen updates as soon as you call the tool—so your spoken instruction must match the step the user will SEE, not the step they were on. This keeps audio and steps in sync.
          SPEED: When the user asks to change step (next, previous, go to step N), call the tool IMMEDIATELY at the start of your response—before saying anything. The step indicator must update right away so the user sees the change instantly. Then speak your short confirmation and the instruction (for the TARGET step as above).
          ${recipe.videoUrl ? `\nVIDEO: The recipe video starts MUTED in agent mode. User must explicitly ask to unmute (e.g. "unmute the video", "turn on video sound")—then call setVideoMute muted false. Embedded video seeks to the step's timestamp when you call goToStep/nextStep/previousStep. Playback: When the user says "play the video", "start the video", "start video", "play video", "resume", "resume the video", or "play" (meaning the recipe video), you MUST call setVideoPlayback with action "play". For "pause the video", "stop the video", "pause video" → setVideoPlayback "pause" or "stop". Volume: "mute the video" → setVideoMute muted true; "unmute the video", "turn on video sound" → setVideoMute muted false. Audio source: "use video audio" → setAudioSource "video"; "use your voice" → setAudioSource "agent".` : ''}
          
          TIMER & HEAT AT NEW STEP:
          - TIMER: Only suggest a timer when the step actually has a clear duration that helps a beginner (e.g. "simmer for 10 minutes", "bake 20 min", "rest 5 minutes"). Do NOT suggest just because the video or recipe says "timer"—only when the instruction clearly implies a specific cooking or resting time. Do not suggest on every step; keep it infrequent so beginners get help only when it's really needed. Say once: "Want me to set a X minute timer?" Only call startTimer after the user confirms (yes, please, set it).
          - HEAT: If the step implies a heat level (sauté, boil, medium heat, sear, etc.), suggest the level in words only once (e.g. "Use medium heat for this step" or "I'd suggest medium-high here"). Do NOT offer to set it and do NOT call setTemperature—only suggest; the user will use the heat control on screen if they want.
          - If the step does not need a timer or heat, just state the instruction; do not suggest.
          
          CRITICAL SYNC & AUDITORY FEEDBACK RULES:
          1. YOU MUST VERBALLY ANNOUNCE EVERY ACTION. Confirmations are required for starting, pausing, stopping timers, setting temperatures, and moving steps.
          2. For step changes: call the tool (nextStep/previousStep/goToStep) FIRST—before any speech—so the step indicator updates instantly. Then say "Okay, next step" or "Previous step" or "Going to [that step]" ONCE and state only the instruction for the STEP THE USER WILL SEE (the target step after the tool runs). Do NOT say the step number (e.g. "Step 2") in that same reply. Do NOT say the instruction of the step you were on—say the target step's instruction so audio matches the screen.
          3. WHENEVER the user asks to go to any step (by number, by scenario, or by time), call goToStep(index) with the correct 0-based index from the STEP LIST above.
          4. NEVER repeat the step number twice. After calling a step tool, give one short confirmation and only the instruction, e.g. "Okay. Chop the onions."
          5. NEVER say technical indices like "Index 0" to the user. Say "Step 1" only when they ask which step (and say it once).
          6. NEVER repeat yourself: say the step instruction and any timer/heat question exactly once. Do not say the same sentence or phrase twice in a row.
          7. Respond instantly and concisely. One short sentence is better than two. Prioritize speed—like talking to a human in the same room.
          8. If noise is high or you didn't catch what they said, say one quick line only: "Sorry, say that again?" or "What was that?" then wait. Do not elaborate.
          9. If you're unsure of intent, pick the most likely (e.g. "next" when it's ambiguous, or "go to step N" if you heard a number) and confirm in one phrase. Don't ask multiple questions.
          10. ALWAYS respond to voice input. Never stay silent. If the user said something that sounds like a step number or "step" in any language, call goToStep(index) and confirm. If you heard a number, use it (1-based step → 0-based index = number minus 1).
          
          FINISHING THE RECIPE: When the user says they have finished cooking (e.g. "I'm done", "we're finished", "recipe complete", "all done", "finished"), call finishRecipe() once. Confirm briefly (e.g. "Done! I've updated your inventory.") then the app will exit cooking mode.`,
            outputAudioTranscription: {},
          }
        }));

        // 2. Mark as listening and store WebSocket as session
        setIsListening(true);
        sessionRef.current = ws;

        // 3. Send initial step context
        try {
          ws.send(JSON.stringify({
            clientContent: {
              turns: getCurrentStepContext(currentStepRef.current),
              turnComplete: false
            }
          }));
        } catch (_) {}

        // 4. Set up audio input pipeline
        const source = inputCtx.createMediaStreamSource(stream);
        inputSourceRef.current = source;
        let lastVolumeUpdate = 0;
        const VOLUME_UPDATE_INTERVAL_MS = 80;

        const flushBatch = (batch: number[], wsRef: WebSocket | null) => {
          if (!wsRef || wsRef !== sessionRef.current || wsRef.readyState !== WebSocket.OPEN) return;
          while (batch.length >= BATCH_SAMPLES_16K) {
            const chunk = batch.splice(0, BATCH_SAMPLES_16K);
            const float32 = new Float32Array(chunk);
            const pcm = float32ToInt16Pcm(float32);
            try {
              wsRef.send(pcm);
            } catch (_) {}
          }
        };

        // Try AudioWorklet, fall back to ScriptProcessor
        (async () => {
          try {
            await inputCtx.audioWorklet.addModule('/mic-worklet.js');
            const workletNode = new AudioWorkletNode(inputCtx, 'mic-worklet-processor', {
              processorOptions: { sampleRate: inputRate },
              numberOfInputs: 1,
              numberOfOutputs: 1
            });
            inputNodeRef.current = workletNode;
            const batch: number[] = [];
            workletNode.port.onmessage = (event: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
              const { samples, sampleRate } = event.data;
              const rms = Math.sqrt(samples.reduce((s, x) => s + x * x, 0) / samples.length);
              const now = Date.now();
              if (now - lastVolumeUpdate >= VOLUME_UPDATE_INTERVAL_MS) {
                lastVolumeUpdate = now;
                setInputVolume(rms);
              }
              const resampled = resampleTo16k(samples, sampleRate);
              for (let i = 0; i < resampled.length; i++) batch.push(resampled[i]);
              flushBatch(batch, sessionRef.current);
            };
            source.connect(workletNode);
            workletNode.connect(inputCtx.destination);
          } catch {
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            inputNodeRef.current = processor;
            const batch: number[] = [];
            processor.onaudioprocess = (e) => {
              const input = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
              const rms = Math.sqrt(sum / input.length);
              const now = Date.now();
              if (now - lastVolumeUpdate >= VOLUME_UPDATE_INTERVAL_MS) {
                lastVolumeUpdate = now;
                setInputVolume(rms);
              }
              const resampled = resampleTo16k(new Float32Array(input), inputRate);
              for (let i = 0; i < resampled.length; i++) batch.push(resampled[i]);
              flushBatch(batch, sessionRef.current);
            };
            source.connect(processor);
            processor.connect(inputCtx.destination);
          }
        })();
      };

      // Handle incoming messages: binary = audio, JSON = events
      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Binary audio from Gemini — queue for playback
          const audioBytes = new Uint8Array(event.data);
          if (audioContextRef.current && audioSourceRef.current !== 'video') {
            setIsAssistantSpeaking(true);
            audioQueueRef.current.push(audioBytes);
            processAudioQueue();
          }
        } else {
          // JSON event (tool calls, transcriptions, etc.)
          try {
            const message = JSON.parse(event.data as string);
            if (message.setupComplete) return; // Session ready signal, no action needed
            handleLiveMessage(message);
          } catch (_) {}
        }
      };

      ws.onerror = (e) => console.error(e);
      ws.onclose = () => {
        sessionRef.current = null;
        setIsListening(false);
        setIsAssistantSpeaking(false);
        setInputVolume(0);
      };
    } catch (err) {
      console.error(err);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleFinishRecipe = useCallback(async () => {
    if (userId) {
      try {
        const inventory = await getInventory(userId);
        const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients.filter((i): i is string => typeof i === 'string' && !!i.trim()) : [];
        let updates: { itemId: string; newQuantity: string | null }[];
        try {
          updates = await getInventoryUpdatesForRecipeFromAPI(ingredients, inventory);
        } catch {
          updates = getInventoryUpdatesForRecipe(recipe, inventory);
        }
        await applyInventoryUpdates(userId, updates);
        notify('Inventory updated.');
      } catch {
        notify('Could not update inventory.');
      }
    }
    setFinishPromptDismissed(true);
  }, [userId, recipe]);

  return (
    <div className="fixed inset-0 z-50 flex justify-center items-center overflow-hidden bg-stone-200/40 h-full min-h-dvh">
      <div className="w-full max-w-md h-full max-h-full bg-stone-50 shadow-2xl flex flex-col overflow-hidden" style={{ paddingTop: 'env(safe-area-inset-top)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {toolNotification && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] animate-in slide-in-from-top-4 fade-in duration-300 pointer-events-none">
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

      {aiThinkingAction && (
        <div className="flex-shrink-0 px-4 py-2 bg-violet-100 border-b border-violet-200/60 animate-in fade-in duration-200">
          <p className="text-violet-800 text-xs font-medium flex items-center justify-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" aria-hidden />
            {aiThinkingAction}
          </p>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 flex flex-col gap-5">
        {showEmbeddedVideo && recipe.videoUrl && videoId && (
          <div
            className="w-full aspect-video max-h-[220px] rounded-2xl overflow-hidden border border-stone-200/80 shadow-md flex-shrink-0 relative ring-1 ring-stone-200/50 bg-gradient-to-br from-stone-100 to-stone-200 cursor-pointer"
            onClick={() => { ytPlayerRef.current?.playVideo?.(); setShowTapToPlayHint(false); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ytPlayerRef.current?.playVideo?.(); setShowTapToPlayHint(false); } }}
            aria-label="Video area: tap or say play to start"
          >
            <div className="absolute top-2 right-2 z-20">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleReloadVideo(); }}
                className="w-8 h-8 rounded-full bg-black/20 hover:bg-black/30 text-white flex items-center justify-center active:scale-95 transition-transform shadow-sm"
                title="Reload video"
                aria-label="Reload video"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              </button>
            </div>
            {showTapToPlayHint && (
              <div className="absolute bottom-2 left-2 right-2 z-20 py-1.5 px-2 rounded-lg bg-black/70 text-white text-xs text-center pointer-events-none">
                Tap video to start playback
              </div>
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-stone-400 pointer-events-none" aria-hidden>
              <div className="w-14 h-14 rounded-full bg-white/80 shadow-sm flex items-center justify-center">
                <svg className="w-6 h-6 text-stone-500 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              </div>
              <p className="text-xs font-medium text-stone-500">Recipe video</p>
            </div>
            <div ref={ytContainerRef} className="w-full h-full relative z-10 min-h-0 pointer-events-none" />
          </div>
        )}

        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border border-stone-200/80 overflow-hidden min-h-0 flex-shrink-0">
          <button
            type="button"
            onClick={() => setKitchenGuidanceOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-stone-50/60 active:bg-stone-100/80 transition-colors rounded-2xl"
            aria-expanded={kitchenGuidanceOpen}
            aria-label={kitchenGuidanceOpen ? 'Collapse Kitchen Guidance' : 'Expand Kitchen Guidance'}
          >
            <div className="flex flex-col items-start gap-0.5">
              <span className="text-emerald-600 font-semibold text-[11px] uppercase tracking-wider">Kitchen Guidance</span>
              {recipe.servings !== appSettings.defaultServings && (
                <span className="text-[10px] text-stone-500 normal-case">Quantities for {recipe.servings} {recipe.servings === 1 ? 'serving' : 'servings'}</span>
              )}
            </div>
            <svg
              className={`w-5 h-5 text-stone-400 flex-shrink-0 transition-transform duration-200 ${kitchenGuidanceOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {kitchenGuidanceOpen && (
            <div className="px-5 pb-6 pt-1 border-t border-stone-100">
              <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-1">This step</p>
              <p className="text-[15px] leading-relaxed text-stone-700">
                {recipe.steps[currentStep] ?? 'No step'}
              </p>
            </div>
          )}
        </div>

        <div className={`grid gap-3 ${SHOW_HEAT_UI ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div className={`relative p-4 rounded-xl border transition-all min-h-0 flex flex-col gap-2 ${timerSeconds !== null && timerSeconds > 0 ? 'bg-emerald-600 text-white shadow-md border-emerald-500/80' : 'bg-white/90 backdrop-blur-sm border-stone-200/80 shadow-sm'}`}>
            <div className="absolute top-2.5 right-2.5 z-10">
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); triggerStopTimer(); }}
                className="w-7 h-7 rounded-full bg-black/10 hover:bg-black/20 text-current flex items-center justify-center active:scale-95 transition-transform"
                aria-label="Reset timer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              </button>
            </div>
            <p className={`text-[9px] uppercase font-semibold tracking-widest ${timerSeconds !== null && timerSeconds > 0 ? 'text-white/90' : 'text-stone-500'}`}>Step Timer</p>
            <button type="button" onClick={handleTimerTap} className="text-left">
              <p className="text-xl font-mono font-bold tabular-nums">{timerSeconds !== null ? formatTime(timerSeconds) : '0:00'}</p>
              <p className={`text-[10px] mt-0.5 ${timerSeconds !== null && timerSeconds > 0 ? 'text-white/90' : 'text-stone-500'}`}>Tap to start 1 min · tap again +1 min</p>
            </button>
          </div>

          {SHOW_HEAT_UI && (
            <div className={`p-4 rounded-xl border transition-all min-h-0 flex flex-col gap-2 text-white shadow-md ${suggestedTemp ? `${heatColorClasses(suggestedTemp).bg} ${heatColorClasses(suggestedTemp).border}` : (activeTemperature !== 'Off' ? `${heatColorClasses(activeTemperature).bg} ${heatColorClasses(activeTemperature).border}` : 'bg-stone-400 border-stone-300')}`}>
              <p className="text-[9px] uppercase font-semibold tracking-widest opacity-90">Heat Level</p>
              {suggestedTemp ? (
                <>
                  <p className="text-2xl font-black">{formatTempForDisplay(suggestedTemp, appSettings.units)}</p>
                  <button onClick={() => triggerSetTemperature(suggestedTemp)} className="w-full h-10 rounded-xl bg-white/20 text-[10px] font-black uppercase tracking-widest backdrop-blur-sm active:scale-95 transition-transform">Use this</button>
                </>
              ) : (
                <>
                  <p className="text-2xl font-black">{formatTempForDisplay(activeTemperature, appSettings.units)}</p>
                  <div className="flex gap-1.5">
                    {['Low', 'Medium', 'High'].map((level) => (
                      <button key={level} onClick={() => triggerSetTemperature(level)} className="flex-1 h-9 rounded-lg bg-white/20 text-[9px] font-bold uppercase backdrop-blur-sm active:scale-95 transition-transform">{level}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border border-stone-200/80 overflow-hidden min-h-0 flex-shrink-0">
          <button
            type="button"
            onClick={() => setIngredientsAccordionOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-stone-50/60 active:bg-stone-100/80 transition-colors rounded-2xl"
            aria-expanded={ingredientsAccordionOpen}
            aria-label={ingredientsAccordionOpen ? 'Collapse Ingredients' : 'Expand Ingredients'}
          >
            <span className="text-emerald-600 font-semibold text-[11px] uppercase tracking-wider">Ingredients</span>
            {recipe.servings != null && recipe.servings !== 1 && (
              <span className="text-[10px] text-stone-500 normal-case font-normal">for {recipe.servings} servings</span>
            )}
            <svg
              className={`w-5 h-5 text-stone-400 flex-shrink-0 transition-transform duration-200 ${ingredientsAccordionOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {ingredientsAccordionOpen && (
            <div className="px-5 pb-6 pt-1 border-t border-stone-100">
              <ul className="space-y-1.5 text-[15px] leading-relaxed text-stone-700 list-none">
                {Array.isArray(recipe.ingredients)
                  ? recipe.ingredients.filter((i): i is string => typeof i === 'string' && !!i.trim()).map((line, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-stone-400 shrink-0">{i + 1}.</span>
                        <span>{line.trim()}</span>
                      </li>
                    ))
                  : null}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border-t border-stone-200 flex flex-col flex-shrink-0 min-h-[12rem]">
        <div
          className={`rounded-t-2xl bg-stone-50 overflow-hidden flex flex-col captions-panel flex-shrink-0 min-w-0 transition-[max-height] duration-300 ease-out ${assistantExpanded ? 'max-h-[14rem]' : 'max-h-[2.75rem]'}`}
          style={{
            boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05), inset 0 1px 0 0 rgb(231 229 228), inset 1px 0 0 0 rgb(231 229 228), inset -1px 0 0 0 rgb(231 229 228)',
          }}
        >
          <button
            type="button"
            onClick={() => setAssistantExpanded((e) => !e)}
            className="w-full min-w-0 px-4 py-2.5 flex items-center justify-between gap-2 border-b border-stone-200 flex-shrink-0 text-left hover:bg-stone-100/80 active:bg-stone-200/60 transition-colors rounded-t-2xl"
          >
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" aria-hidden />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">Assistant</span>
            </div>
            <span className="text-[9px] text-stone-400">{assistantExpanded ? 'Collapse' : 'Expand'}</span>
          </button>
          <div
            ref={captionsScrollRef}
            className={`px-4 py-3 overflow-x-hidden text-left transition-[max-height] duration-300 ease-out captions-panel ${assistantExpanded ? 'flex-1 min-h-0 overflow-y-auto max-h-[11rem]' : 'max-h-0 min-h-0 overflow-hidden'}`}
          >
            {aiResponse ? (
              <p className="text-[14px] leading-relaxed text-stone-800 animate-in fade-in duration-200 whitespace-pre-wrap">
                {formatIndicSpacing(aiResponse)}
              </p>
            ) : (
              <p className="text-sm text-stone-500">
                Tap the mic below to start. Then ask for the next step, set a timer, or control the video with your voice.
              </p>
            )}
          </div>
        </div>
        <div className="px-5 pt-4 pb-5 space-y-3">
        <div className="flex items-center justify-center gap-6">
          <button onClick={triggerPrevStep} disabled={currentStep === 0} className="w-10 h-10 rounded-xl bg-white text-stone-600 disabled:opacity-30 border border-stone-300 shadow-sm active:scale-90 transition-all hover:bg-stone-50">
            <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
          </button>

          <div className="relative mt-2">
            {isListening && (
              <div
                className="absolute inset-0 bg-emerald-400/20 rounded-full animate-ping transition-transform duration-75 ease-out"
                style={{ transform: `scale(${2 + inputVolume * 10})` }}
              ></div>
            )}
            {!isListening && (
              <div className="absolute inset-0 rounded-full bg-emerald-400/30 animate-mic-pulse pointer-events-none" aria-hidden />
            )}
            <button
              onClick={toggleVoiceAssistant}
              title="Start voice assistant for hands-free cooking"
              className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg relative z-10 transition-all active:scale-95 ${isListening ? 'bg-emerald-600' : 'bg-emerald-500'}`}
            >
              {isListening ? (
                <div className="flex items-center gap-0.5 h-5">
                  {[1, 2, 3, 4].map(i => (
                    <div
                      key={i}
                      className="w-1 bg-white rounded-full"
                      style={{
                        height: isAssistantSpeaking ? '100%' : `${25 + inputVolume * 1200}%`,
                        maxHeight: '20px',
                        animation: isAssistantSpeaking ? 'wave 0.4s ease-in-out infinite' : 'none',
                        animationDelay: `${i * 0.1}s`
                      }}
                    />
                  ))}
                </div>
              ) : (
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
              )}
            </button>
          </div>

          <button onClick={triggerNextStep} disabled={currentStep === stepsCount - 1} className="w-10 h-10 rounded-xl bg-white text-stone-600 disabled:opacity-30 border border-stone-300 shadow-sm active:scale-90 transition-all hover:bg-stone-50">
            <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
        <div className="text-center text-stone-500 text-[10px] font-black uppercase tracking-widest min-h-[0.75rem] px-2">
          {isListening ? (isAssistantSpeaking ? "Assistant Speaking" : "Listening...") : "Tap to start voice assistant"}
        </div>
        {recipe.videoUrl && (
          <div className="flex items-center justify-center gap-2">
            <span className="text-stone-400 text-[10px] font-bold uppercase">Listen to:</span>
            <button
              onClick={() => {
                setAudioSource('agent');
                ytPlayerRef.current?.pauseVideo?.();
                ytPlayerRef.current?.mute?.();
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${audioSource === 'agent' ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-500'}`}
            >
              Agent
            </button>
            <button
              onClick={() => {
                setAudioSource('video');
                const player = ytPlayerRef.current;
                if (player) {
                  player.unMute?.();
                  player.playVideo?.();
                }
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${audioSource === 'video' ? 'bg-red-600 text-white' : 'bg-stone-100 text-stone-500'}`}
            >
              Video
            </button>
          </div>
        )}
        </div>
      </div>

      {isOnLastStep && !finishPromptDismissed && (
        <div
          className="absolute bottom-0 left-0 right-0 z-50 px-4 pb-4 pt-3 bg-white/95 backdrop-blur-sm border-t border-stone-200 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <p className="text-stone-600 text-sm text-center mb-3">Done cooking? Update your inventory when you're finished.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleFinishRecipe}
              className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 active:scale-[0.98] transition-all"
            >
              Update inventory
            </button>
            <button
              type="button"
              onClick={() => setFinishPromptDismissed(true)}
              className="px-4 py-2.5 rounded-xl border border-stone-300 text-stone-600 font-medium text-sm hover:bg-stone-50 active:scale-[0.98] transition-all"
            >
              Not yet
            </button>
          </div>
        </div>
      )}
      </div>

      <style>{`
        @keyframes wave { 0%, 100% { height: 40%; } 50% { height: 100%; } }
        @keyframes mic-pulse { 0%, 100% { opacity: 0.4; transform: scale(1.15); } 50% { opacity: 0.7; transform: scale(1.25); } }
        .animate-mic-pulse { animation: mic-pulse 2s ease-in-out infinite; }
        .captions-panel .overflow-y-auto::-webkit-scrollbar { width: 5px; }
        .captions-panel .overflow-y-auto::-webkit-scrollbar-track { background: #f5f5f4; border-radius: 3px; }
        .captions-panel .overflow-y-auto::-webkit-scrollbar-thumb { background: #d6d3d1; border-radius: 3px; }
      `}</style>
    </div>
  );
};

export default CookingMode;
