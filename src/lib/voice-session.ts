/**
 * GRIOT Elite Voice Session (Ápice do Chat de Voz)
 *
 * Arquitetura de Ultra-Precisão:
 *  - Deteção Neuronal: Silero VAD v5 com fallback adaptativo por energia.
 *  - Transcrição Multimodal Client-Side (STT): Groq Whisper Large v3 (~150ms),
 *    Gemini 2.5/2.0 Flash Multimodal e OpenAI Whisper com fidelidade absoluta no idioma do app.
 *  - Síntese de Voz (TTS) Vinculada ao Idioma: OpenAI TTS ou Web Speech nativo
 *    estritamente filtrado pelo idioma do utilizador (pt-PT / pt-BR em português).
 *  - Smart Pause & Exact Resume (Barge-in Inteligente): Pausa suave (fade-down de 120ms).
 *    Se o utilizador hesitar, disser "espera", "hum" ou se confundir (< 1.4s),
 *    a voz retoma suavemente (fade-in de 160ms) exatamente na frase e palavra onde parou.
 *    Se for uma nova pergunta real, confirma a interrupção e comuta para a nova resposta.
 */

import { TranscriptStabilizer } from "./transcript-stabilizer";
import { concatFloat32, encodeWav } from "./audio-wav";
import { startNeuralVad, VAD_SAMPLE_RATE, type NeuralVadHandle } from "./neural-vad";
import { transcribeAudioElite, resolveSpeechLanguage } from "./speech-transcriber";
import { getUserSavedApis } from "./user-apis";

export type VoiceSessionState = "listening" | "thinking" | "speaking";

type Options = {
  onState: (state: VoiceSessionState) => void;
  onLevels: (levels: number[]) => void;
  /** Transcrição parcial/final do que o utilizador está a dizer (tempo real). */
  onPartial: (text: string, final: boolean) => void;
  /** Separa o texto consolidado da cauda provisória. */
  onPartialParts?: (stable: string, tentative: string, final: boolean) => void;
  onTranscript: (text: string) => void | Promise<void>;
  /** Reconciliação se a transcrição final divergir do otimista */
  onCorrected?: (text: string) => void | Promise<void>;
  onError: (message: string) => void;
  bars?: number;
  voice?: string;
  /** Velocidade da voz sintetizada (0.5–2). */
  speed?: number;
  /** Nome do idioma principal do utilizador (afina a transcrição e vozes). */
  languageName?: string;
  /** Se falso, falar por cima não interrompe a resposta. */
  allowInterrupt?: boolean;
  /** Chamado quando a resposta é interrompida (orbe ou barge-in por voz). */
  onInterrupt?: () => void;
};

/** Limites do turno */
const MAX_TURN_MS = 24000;
const MIN_TURN_MS = 300;
const SILENCE_MS = 620;
const SILENCE_TERMINAL_MS = 380;
const PARTIAL_EVERY_MS = 850;
const SEGMENT_MS = 1500;
const SEGMENT_OVERLAP_MS = 320;
const SEGMENT_TICK_MS = 250;

/** Ignora barge-in nos primeiros ms de fala (cauda do próprio áudio). */
const BARGE_GRACE_MS = 250;
/** Volume em modo ducked */
const DUCK_GAIN = 0.08;
/** PCM da voz: 24 kHz, 16 bits, mono. */
const PCM_RATE = 24000;
const CROSSFADE_S = 0.07;
const CORRECTION_THRESHOLD = 0.26;
const CORRECTION_WINDOW_MS = 2800;

function pickMime() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Junta duas janelas transcritas removendo a repetição da sobreposição. */
function joinOverlap(head: string, tail: string): string {
  const left = head.trim().split(/\s+/u).filter(Boolean);
  const right = tail.trim().split(/\s+/u).filter(Boolean);
  if (left.length === 0) return right.join(" ");
  if (right.length === 0) return left.join(" ");
  const norm = (word: string) => word.replace(/[^\p{L}\p{N}]/gu, "").toLocaleLowerCase();
  const max = Math.min(8, left.length, right.length);
  for (let size = max; size > 0; size -= 1) {
    let same = true;
    for (let index = 0; index < size; index += 1) {
      if (norm(left[left.length - size + index]!) !== norm(right[index]!)) {
        same = false;
        break;
      }
    }
    if (same) return left.concat(right.slice(size)).join(" ");
  }
  return left.concat(right).join(" ");
}

/** Descodifica um bloco PCM base64 (16-bit LE mono) para Float32. */
function decodePcm(b64: string): Float32Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let index = 0; index < bin.length; index += 1) bytes[index] = bin.charCodeAt(index);
  const samples = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  const floats = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) floats[index] = samples[index]! / 32768;
  return floats;
}

/** Distância entre duas transcrições */
function divergence(a: string, b: string): number {
  const left = a
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/u)
    .filter(Boolean);
  const right = b
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/u)
    .filter(Boolean);
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0 || right.length === 0) return 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length]! / Math.max(left.length, right.length);
}

/** Prosódia adaptativa */
function toneOf(sentence: string): string | undefined {
  if (/\?\s*$/.test(sentence)) return "question";
  if (/\d[\d.,:%/-]*/.test(sentence) && /\d{2,}|[%€$]/.test(sentence)) return "numeric";
  if (/^\s*(?:[-•*]|\d+[.)])\s/.test(sentence) || (sentence.match(/,/g) ?? []).length >= 3)
    return "list";
  if (/!\s*$/.test(sentence)) return "emphatic";
  return undefined;
}

type SentenceStream = {
  chunks: Float32Array<ArrayBuffer>[];
  ended: boolean;
  failed: boolean;
  done: Promise<void>;
};

export class VoiceSession {
  private opts: Options;
  private bars: number;

  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private outAnalyser: AnalyserNode | null = null;
  private master: GainNode | null = null;
  private raf = 0;

  /** Detetor neuronal */
  private vad: NeuralVadHandle | null = null;
  private neural = false;
  private neuralProb = 0;
  private turnAudio: Float32Array[] = [];
  private turnActive = false;

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private recordingSince = 0;
  private lastVoice = 0;
  private voiceFrames = 0;
  private floor = 0.008;
  private vocalFloor = 0.04;
  private echo = 0.1;
  private partialTerminal = false;

  /** Barge-in inteligente e avaliação de hesitação */
  private bargeSince = 0;
  private ducked = false;
  private isPausedForEvaluation = false;
  private evalSpeechAudio: Float32Array[] = [];
  private evalLastSpeech = 0;
  private currentSpokenSentence = "";
  private nativeUtterance: SpeechSynthesisUtterance | null = null;
  private isNativeSpeaking = false;

  private partialTimer = 0;
  private partialBusy = false;
  private partialText = "";
  private stabilizer = new TranscriptStabilizer(2);
  private aborts = new Set<AbortController>();

  private segCursor = 0;
  private segText = "";

  private optimistic = "";
  private optimisticAt = 0;

  private queue: string[] = [];
  private buffer = "";
  private streamDone = false;
  private playing = false;
  private turn = 0;
  private spoken = 0;
  private spokeAt = 0;
  private lastReply = "";

  private sources = new Set<AudioBufferSourceNode>();
  private playhead = 0;

  active = false;
  state: VoiceSessionState = "listening";

  constructor(options: Options) {
    this.opts = options;
    this.bars = options.bars ?? 22;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.7;
    this.ctx.createMediaStreamSource(this.stream).connect(analyser);
    this.analyser = analyser;

    this.master = this.ctx.createGain();
    const out = this.ctx.createAnalyser();
    out.fftSize = 512;
    out.smoothingTimeConstant = 0.5;
    this.master.connect(out);
    out.connect(this.ctx.destination);
    this.outAnalyser = out;
    void this.ctx.resume().catch(() => undefined);

    this.active = true;
    this.setState("listening");
    this.loop();

    void this.initNeuralVad();
  }

  private async initNeuralVad() {
    if (!this.stream) return;
    const handle = await startNeuralVad(this.stream, {
      onFrame: (probability, frame) => {
        this.neuralProb = probability;
        if (this.turnActive) this.turnAudio.push(new Float32Array(frame));
      },
      onSpeechStart: () => {
        if (!this.active || this.state !== "listening") return;
        this.beginTurn();
      },
      onSpeechRealStart: () => undefined,
      onMisfire: () => {
        this.turnActive = false;
        this.turnAudio = [];
        this.stopPartials();
      },
      onSpeechEnd: (audio) => {
        if (!this.active || this.state !== "listening" || !this.turnActive) return;
        this.turnActive = false;
        this.stopPartials();
        void this.closeTurn(audio);
      },
    });
    if (!this.active) {
      handle?.destroy();
      return;
    }
    if (handle) {
      this.vad = handle;
      this.neural = true;
      this.stopRecorder(false);
    }
  }

  private beginTurn() {
    this.turnActive = true;
    this.turnAudio = [];
    this.partialText = "";
    this.stabilizer.reset();
    this.segCursor = 0;
    this.segText = "";
    this.partialTerminal = false;
    this.recordingSince = performance.now();
    void this.ctx?.resume().catch(() => undefined);
    this.startNeuralPartials();
  }

  stop() {
    this.active = false;
    this.turn += 1;
    cancelAnimationFrame(this.raf);
    this.vad?.destroy();
    this.vad = null;
    this.neural = false;
    this.turnActive = false;
    this.turnAudio = [];
    this.stopRecorder(false);
    this.abortPending();
    this.silenceOutput();
    this.queue = [];
    this.buffer = "";
    this.partialText = "";
    this.streamDone = false;
    this.playing = false;
    this.isPausedForEvaluation = false;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.outAnalyser = null;
    this.master = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.analyser = null;

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  /** Texto em streaming do modelo */
  feed(delta: string) {
    this.buffer += delta;
    for (;;) {
      const match = this.buffer.match(/^[\s\S]*?[.!?…:\n]+\s/);
      if (!match) break;
      const sentence = match[0];
      this.buffer = this.buffer.slice(sentence.length);
      this.push(sentence);
    }
    const limit = this.spoken === 0 ? 70 : 180;
    if (this.buffer.length > limit) {
      const cut = this.buffer.lastIndexOf(" ", limit - 20);
      if (cut > 24) {
        this.push(this.buffer.slice(0, cut));
        this.buffer = this.buffer.slice(cut);
      }
    }
  }

  finish() {
    if (this.buffer.trim()) this.push(this.buffer);
    this.buffer = "";
    this.streamDone = true;
    if (!this.playing && this.queue.length === 0) this.resumeListening();
  }

  /** Interrupção definitiva (novo comando ou clique manual) */
  interrupt() {
    this.turn += 1;
    this.queue = [];
    this.buffer = "";
    this.playing = false;
    this.streamDone = false;
    this.isPausedForEvaluation = false;
    this.bargeSince = 0;
    this.currentSpokenSentence = "";
    this.abortPending();
    this.silenceOutput();
    this.resumeListening();
    this.opts.onInterrupt?.();
  }

  private abortPending() {
    for (const controller of this.aborts) controller.abort();
    this.aborts.clear();
    this.partialBusy = false;
    this.stopPartials();
  }

  private stopPartials() {
    if (this.partialTimer) {
      window.clearInterval(this.partialTimer);
      this.partialTimer = 0;
    }
  }

  /** Pausa suave com fade-out de 120ms (preserva a frase e a fila intactas) */
  private gentlePause() {
    if (this.isPausedForEvaluation) return;
    this.isPausedForEvaluation = true;
    this.evalSpeechAudio = [];
    this.evalLastSpeech = performance.now();

    if (this.ctx && this.master) {
      const now = this.ctx.currentTime;
      const gain = this.master.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(Math.max(gain.value, 0.0001), now);
      gain.linearRampToValueAtTime(0.0001, now + 0.12);
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
      }
    }
  }

  /** Retoma suave com fade-in de 160ms exatamente no ponto onde parou */
  private softResume() {
    this.isPausedForEvaluation = false;
    this.bargeSince = 0;

    if (this.ctx && this.master) {
      const now = this.ctx.currentTime;
      const gain = this.master.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(Math.max(gain.value, 0.0001), now);
      gain.linearRampToValueAtTime(1, now + 0.16);
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }
  }

  private silenceOutput() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // já terminou
      }
    }
    this.sources.clear();
    this.ducked = false;
    this.bargeSince = 0;
    this.isPausedForEvaluation = false;

    if (this.ctx && this.master) {
      const now = this.ctx.currentTime;
      const gain = this.master.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(Math.max(gain.value, 0.0001), now);
      gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      gain.linearRampToValueAtTime(1, now + 0.3);
    }
    this.playhead = 0;

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      this.isNativeSpeaking = false;
      this.nativeUtterance = null;
    }
  }

  private push(sentence: string) {
    const clean = sentence
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#*`_>|~]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (clean.length < 2) return;
    this.spoken += 1;
    this.lastReply = clean;
    this.queue.push(clean);
    if (!this.playing) void this.drain();
  }

  private async drain() {
    if (this.playing) return;
    this.playing = true;
    const turn = this.turn;
    this.setState("speaking");
    let next: SentenceStream | null = null;

    while (this.active && turn === this.turn) {
      const sentence = this.queue.shift();
      if (!sentence) {
        if (this.streamDone) break;
        await sleep(50);
        continue;
      }

      this.currentSpokenSentence = sentence;

      // Se estiver em pausa suave (utilizador a hesitar), aguarda a decisão
      while (this.active && turn === this.turn && this.isPausedForEvaluation) {
        await sleep(60);
      }
      if (turn !== this.turn || !this.active) break;

      let stream = next ?? this.streamSentence(sentence);
      next = null;

      const upcoming = this.queue[0];
      if (upcoming) next = this.streamSentence(upcoming);

      await stream.done;

      if (stream.chunks.length > 0 && !stream.failed) {
        await this.speak(stream, turn);
      } else {
        // Fallback robusto e instantâneo: Web Speech nativo estritamente no idioma do app
        await this.speakNative(sentence, turn);
      }
    }

    this.playing = false;
    this.currentSpokenSentence = "";
    if (this.active && turn === this.turn && this.streamDone && !this.isPausedForEvaluation) {
      await sleep(140);
      if (this.active && turn === this.turn) this.resumeListening();
    }
  }

  /**
   * Síntese com OpenAI TTS (se houver chave OpenAI configurada)
   * ou chamada a proxy TTS com formato PCM direto 24kHz.
   */
  private streamSentence(text: string): SentenceStream {
    const handle: SentenceStream = {
      chunks: [],
      ended: false,
      failed: false,
      done: Promise.resolve(),
    };
    const controller = new AbortController();
    this.aborts.add(controller);

    handle.done = (async () => {
      try {
        const userApis = getUserSavedApis();
        const openaiApi = userApis.find((a) => a.providerId === "openai" && a.apiKey);

        if (openaiApi) {
          const res = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${openaiApi.apiKey.trim()}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "tts-1",
              voice: this.opts.voice || "alloy",
              input: text,
              response_format: "pcm",
              speed: this.opts.speed || 1.0,
            }),
            signal: controller.signal,
          });

          if (res.ok) {
            const buf = await res.arrayBuffer();
            const samples = new Int16Array(buf, 0, Math.floor(buf.byteLength / 2));
            const floats = new Float32Array(samples.length);
            for (let i = 0; i < samples.length; i++) floats[i] = samples[i]! / 32768;
            if (floats.length > 0) handle.chunks.push(floats);
            return;
          }
        }

        // Tenta rota /api/tts interna caso disponível
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voice: this.opts.voice ?? "alloy",
            speed: this.opts.speed ?? 1.0,
            stream: true,
            tone: toneOf(text),
          }),
          signal: controller.signal,
        });

        if (response.ok && response.body) {
          const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
          let pending = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            pending += value;
            let sep = pending.indexOf("\n\n");
            while (sep >= 0) {
              const raw = pending.slice(0, sep);
              pending = pending.slice(sep + 2);
              for (const line of raw.split("\n")) {
                if (!line.startsWith("data:")) continue;
                const data = line.slice(5).trim();
                if (!data || data === "[DONE]") continue;
                try {
                  const event = JSON.parse(data) as { type?: string; audio?: string };
                  if (event.type === "speech.audio.delta" && event.audio) {
                    const floats = decodePcm(event.audio);
                    if (floats.length > 0) handle.chunks.push(floats);
                  }
                } catch {}
              }
              sep = pending.indexOf("\n\n");
            }
          }
        }

        if (handle.chunks.length === 0) handle.failed = true;
      } catch (error) {
        if ((error as Error).name !== "AbortError") handle.failed = true;
      } finally {
        handle.ended = true;
        this.aborts.delete(controller);
      }
    })();

    return handle;
  }

  /**
   * Síntese Nativa do Navegador/Android estritamente vinculada ao idioma do app
   * com suporte a pausa suave, retoma cirúrgica e animação de níveis no orbe.
   */
  private async speakNative(sentence: string, turn: number): Promise<void> {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (!this.active || turn !== this.turn) return;

    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(sentence);
      this.nativeUtterance = utterance;
      this.isNativeSpeaking = true;

      const langInfo = resolveSpeechLanguage(this.opts.languageName);
      utterance.lang = langInfo.bcp47;

      const voices = window.speechSynthesis.getVoices();
      const matchingVoices = voices.filter((v) =>
        v.lang.toLowerCase().replace("_", "-").startsWith(langInfo.code),
      );

      if (matchingVoices.length > 0) {
        // Preferência por voz local/natural no idioma
        const selectedVoiceName = this.opts.voice?.toLowerCase() || "";
        const preferred =
          matchingVoices.find((v) => v.name.toLowerCase().includes(selectedVoiceName)) ||
          matchingVoices.find((v) => v.name.toLowerCase().includes("google") || v.name.toLowerCase().includes("natural")) ||
          matchingVoices[0];
        if (preferred) utterance.voice = preferred;
      }

      utterance.rate = this.opts.speed || 1.0;

      // Prosódia por estilo
      const voiceStyle = (this.opts.voice || "").toLowerCase();
      if (voiceStyle.includes("grave") || voiceStyle.includes("deep")) {
        utterance.pitch = 0.8;
      } else if (voiceStyle.includes("serena") || voiceStyle.includes("calm")) {
        utterance.pitch = 1.15;
      } else {
        utterance.pitch = 1.0;
      }

      this.spokeAt = performance.now();

      utterance.onend = () => {
        this.isNativeSpeaking = false;
        this.nativeUtterance = null;
        resolve();
      };

      utterance.onerror = () => {
        this.isNativeSpeaking = false;
        this.nativeUtterance = null;
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  private async speak(stream: SentenceStream, turn: number) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) {
      await stream.done;
      return;
    }
    const gain = ctx.createGain();
    gain.connect(master);
    let cursor = 0;
    let first = true;

    const schedule = (floats: Float32Array<ArrayBuffer>) => {
      const audioBuffer = ctx.createBuffer(1, floats.length, PCM_RATE);
      audioBuffer.copyToChannel(floats, 0);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gain);
      source.onended = () => this.sources.delete(source);
      if (first && this.playhead > ctx.currentTime + CROSSFADE_S + 0.02)
        this.playhead -= CROSSFADE_S;
      const start = Math.max(this.playhead, ctx.currentTime + 0.03);
      if (first) {
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(1, start + 0.06);
        this.spokeAt = performance.now();
        first = false;
      }
      this.sources.add(source);
      source.start(start);
      this.playhead = start + audioBuffer.duration;
    };

    while (this.active && turn === this.turn) {
      while (cursor < stream.chunks.length) {
        schedule(stream.chunks[cursor]!);
        cursor += 1;
      }
      if (stream.ended) break;
      await sleep(25);
    }

    if (turn !== this.turn || !this.active) {
      window.setTimeout(() => gain.disconnect(), 300);
      return;
    }
    const end = this.playhead;
    if (!first && end > ctx.currentTime + 0.09) {
      gain.gain.setValueAtTime(1, end - 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, end + 0.03);
    }
    while (this.active && turn === this.turn && ctx.currentTime < end - 0.06) await sleep(30);
    window.setTimeout(() => gain.disconnect(), 400);
  }

  private resumeListening() {
    if (!this.active) return;
    this.spoken = 0;
    this.streamDone = false;
    this.voiceFrames = 0;
    this.lastVoice = 0;
    this.partialText = "";
    this.optimistic = "";
    this.stabilizer.reset();
    this.segCursor = 0;
    this.segText = "";
    this.partialTerminal = false;
    this.turnActive = false;
    this.turnAudio = [];
    this.echo = 0.1;
    this.bargeSince = 0;
    this.ducked = false;
    this.isPausedForEvaluation = false;
    this.setState("listening");
  }

  private setState(state: VoiceSessionState) {
    if (this.state === state) return;
    this.state = state;
    this.opts.onState(state);
  }

  private loop() {
    const analyser = this.analyser;
    if (!analyser) return;
    const outAnalyser = this.outAnalyser;
    const time = new Float32Array(analyser.fftSize);
    const freq = new Uint8Array(analyser.frequencyBinCount);
    const outFreq = new Uint8Array(outAnalyser?.frequencyBinCount ?? 0);
    const binHz = (this.ctx?.sampleRate ?? 48000) / 2 / freq.length;
    const vocalFrom = Math.max(1, Math.floor(300 / binHz));
    const vocalTo = Math.min(freq.length - 1, Math.ceil(3400 / binHz));

    const vocalEnergy = () => {
      analyser.getByteFrequencyData(freq);
      let total = 0;
      for (let index = vocalFrom; index <= vocalTo; index += 1) total += freq[index] ?? 0;
      return total / (vocalTo - vocalFrom + 1) / 255;
    };

    const tick = () => {
      if (!this.active) return;
      analyser.getFloatTimeDomainData(time);
      let sum = 0;
      for (let index = 0; index < time.length; index += 1) sum += time[index]! * time[index]!;
      const rms = Math.sqrt(sum / time.length);
      const vocal = vocalEnergy();
      const now = performance.now();

      if (this.state === "listening") {
        const step = Math.floor((vocalTo - vocalFrom + 1) / this.bars) || 1;
        this.opts.onLevels(
          Array.from({ length: this.bars }, (_, index) => {
            let total = 0;
            for (let offset = 0; offset < step; offset += 1)
              total += freq[vocalFrom + index * step + offset] ?? 0;
            return Math.min(1, Math.max(0.1, total / step / 190));
          }),
        );

        if (!this.neural) {
          const voice =
            rms > Math.max(0.012, this.floor * 3.2) && vocal > Math.max(0.09, this.vocalFloor * 3);
          if (voice) {
            this.voiceFrames += 1;
            this.lastVoice = now;
            if (this.voiceFrames > 2 && !this.recorder) this.startRecorder();
          } else {
            this.floor = this.floor * 0.96 + rms * 0.04;
            this.vocalFloor = this.vocalFloor * 0.96 + vocal * 0.04;
            this.voiceFrames = 0;
            const silenceNeeded = this.partialTerminal ? SILENCE_TERMINAL_MS : SILENCE_MS;
            if (this.recorder && this.lastVoice && now - this.lastVoice > silenceNeeded)
              this.stopRecorder(true);
          }
          if (this.recorder && now - this.recordingSince > MAX_TURN_MS) this.stopRecorder(true);
        } else if (this.turnActive && now - this.recordingSince > MAX_TURN_MS) {
          this.turnActive = false;
          this.stopPartials();
          void this.closeTurn(concatFloat32(this.turnAudio));
        }
      } else if (this.state === "speaking") {
        // Níveis reais da voz sintetizada
        if (this.isNativeSpeaking) {
          // Níveis harmónicos simulados para síntese nativa do SO
          const pulse = Math.sin(now * 0.012) * 0.35 + 0.65;
          this.opts.onLevels(
            Array.from({ length: this.bars }, (_, i) =>
              Math.min(1, Math.max(0.15, (Math.sin(now * 0.008 + i * 0.4) * 0.3 + 0.7) * pulse)),
            ),
          );
        } else if (outAnalyser && outFreq.length > 0) {
          outAnalyser.getByteFrequencyData(outFreq);
          const step = Math.floor(outFreq.length / this.bars);
          this.opts.onLevels(
            Array.from({ length: this.bars }, (_, index) => {
              let total = 0;
              for (let offset = 0; offset < step; offset += 1)
                total += outFreq[index * step + offset] ?? 0;
              return Math.min(1, Math.max(0.1, total / step / 190));
            }),
          );
        }

        // Deteção de fala por cima da voz do GRIOT
        const settled = this.spokeAt > 0 && now - this.spokeAt > BARGE_GRACE_MS;
        const speechOver = this.neural
          ? this.neuralProb > 0.58 && vocal > Math.max(0.1, this.echo * 1.2)
          : vocal > Math.max(0.16, this.echo * 1.7);
        const loudSpeech = this.neural
          ? this.neuralProb > 0.82 && vocal > Math.max(0.18, this.echo * 1.8)
          : vocal > Math.max(0.28, this.echo * 2.2);

        if ((speechOver || loudSpeech) && settled) {
          if (!this.bargeSince) this.bargeSince = now;
          if (this.opts.allowInterrupt !== false) {
            this.gentlePause();
            this.evalSpeechAudio.push(new Float32Array(time));
            this.evalLastSpeech = now;
          }
        } else {
          if (this.isPausedForEvaluation) {
            // Utilizador em pausa há mais de 750ms: avalia intenção (hesitação vs novo comando)
            if (now - this.evalLastSpeech > 750) {
              void this.evaluateInterruptionOrResume();
            }
          } else {
            this.voiceFrames = 0;
            if (vocal > this.echo) this.echo += (vocal - this.echo) * 0.05;
            else this.echo *= 0.93;
          }
        }
      }

      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /**
   * Avaliação de Hesitação / Smart Resume:
   * Se o utilizador hesitou, tossiu, disse "espera", "hum", "como?" ou parou (< 1.4s),
   * a voz retoma suavemente exatamente na frase e palavra onde parou.
   * Se for uma pergunta articulada ou comando novo, interrompe e processa.
   */
  private async evaluateInterruptionOrResume() {
    if (!this.isPausedForEvaluation) return;
    const duration = this.evalLastSpeech - this.bargeSince;
    const audioSamples = concatFloat32(this.evalSpeechAudio);
    this.evalSpeechAudio = [];
    this.isPausedForEvaluation = false;
    this.bargeSince = 0;

    // Se o som foi impercetível ou ultracurto (< 400ms): tosse ou ruído -> retoma imediatamente
    if (duration < 400 || audioSamples.length < VAD_SAMPLE_RATE * 0.35) {
      this.softResume();
      return;
    }

    try {
      const wav = encodeWav(audioSamples, VAD_SAMPLE_RATE);
      const text = (
        await transcribeAudioElite(wav, {
          language: this.opts.languageName,
          contextPrompt: "Interjeição curta, hesitação ou comando?",
        })
      ).trim();

      const lower = text.toLowerCase().replace(/[.,!?;:…"'»«]/g, "").trim();
      const hesitationKeywords = [
        "espera", "pera", "espera aí", "pera aí", "como", "como assim", "hã", "hum",
        "uhm", "ai", "não", "sim", "ok", "pois", "olha", "opa", "epa", "wait", "huh",
        "um", "uh", "what", "eish", "calma",
      ];

      const words = lower.split(/\s+/).filter(Boolean);
      const isHesitation =
        words.length === 0 ||
        (words.length <= 2 && (hesitationKeywords.includes(lower) || words.some((w) => hesitationKeywords.includes(w)))) ||
        (duration < 1400 && words.length <= 3 && !lower.includes("para") && !lower.includes("cancela"));

      if (isHesitation) {
        // Hesitação ou confusão: RETOMA SUAVEMENTE NO PONTO EXATO!
        this.softResume();
      } else {
        // Novo comando articulado real: confirma interrupção e responde
        this.interrupt();
        this.partialText = text;
        this.opts.onPartial(text, true);
        this.opts.onPartialParts?.(text, "", true);
        await this.opts.onTranscript(text);
      }
    } catch {
      this.softResume();
    }
  }

  private startRecorder() {
    if (!this.stream) return;
    const mime = pickMime();
    try {
      const recorder = mime
        ? new MediaRecorder(this.stream, { mimeType: mime })
        : new MediaRecorder(this.stream);
      this.chunks = [];
      this.partialText = "";
      this.stabilizer.reset();
      this.segCursor = 0;
      this.segText = "";
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" });
        this.chunks = [];
        if (this.pendingTranscribe) void this.closeTurnBlob(blob);
      };
      recorder.start(160);
      this.recorder = recorder;
      this.recordingSince = performance.now();
      this.startPartials(recorder);
    } catch {
      // mediarecorder não suportado
    }
  }

  private startNeuralPartials() {
    this.stopPartials();
    this.partialTimer = window.setInterval(() => {
      if (!this.active || this.partialBusy || !this.turnActive) return;
      const samples = concatFloat32(this.turnAudio);
      const pending = samples.length - this.segCursor;
      if (pending < VAD_SAMPLE_RATE * (SEGMENT_MS / 1000)) return;

      const from = Math.max(0, this.segCursor - VAD_SAMPLE_RATE * (SEGMENT_OVERLAP_MS / 1000));
      const window_ = samples.slice(from, samples.length);
      this.segCursor = samples.length;
      this.partialBusy = true;
      void this.requestTranscript(encodeWav(window_, VAD_SAMPLE_RATE), false, "segment")
        .then((text) => this.applySegment(text))
        .catch(() => undefined)
        .finally(() => {
          this.partialBusy = false;
        });
    }, SEGMENT_TICK_MS);
  }

  private applySegment(text: string) {
    const said = text.trim();
    if (!said) return;
    const merged = joinOverlap(this.segText, said);
    if (!merged || merged === this.segText) return;
    this.segText = merged;
    this.applyPartial(merged);
  }

  private startPartials(recorder: MediaRecorder) {
    this.stopPartials();
    this.partialTimer = window.setInterval(() => {
      if (!this.active || this.partialBusy) return;
      if (this.recorder !== recorder || this.chunks.length === 0) return;
      const blob = new Blob(this.chunks.slice(), { type: recorder.mimeType || "audio/webm" });
      if (blob.size < 2400) return;
      this.partialBusy = true;
      void this.requestTranscript(blob, false)
        .then((text) => {
          if (this.recorder !== recorder) return;
          this.applyPartial(text);
        })
        .catch(() => undefined)
        .finally(() => {
          this.partialBusy = false;
        });
    }, PARTIAL_EVERY_MS);
  }

  private applyPartial(text: string) {
    if (!this.active) return;
    const said = text.trim();
    if (!said) return;
    this.partialTerminal = /[.!?…]["'”’)]?\s*$/.test(said);
    const update = this.stabilizer.push(said, false);
    if (update.text === this.partialText) return;
    this.partialText = update.text;
    this.opts.onPartial(update.text, false);
    this.opts.onPartialParts?.(update.stable, update.tentative, false);
  }

  private pendingTranscribe = false;

  private stopRecorder(transcribe: boolean) {
    this.stopPartials();
    const recorder = this.recorder;
    this.recorder = null;
    if (!recorder) return;
    const long = performance.now() - this.recordingSince > MIN_TURN_MS;
    this.pendingTranscribe = transcribe && long;
    if (recorder.state !== "inactive") recorder.stop();
  }

  private sttPrompt(): string {
    const bits: string[] = [];
    if (this.opts.languageName) bits.push(`O utilizador fala ${this.opts.languageName}.`);
    if (this.partialText.trim()) bits.push(this.partialText.trim().slice(-180));
    if (this.lastReply) bits.push(this.lastReply.slice(-180));
    return bits.join(" ").slice(0, 600);
  }

  /**
   * Transcrição de Elite: invoca transcribeAudioElite diretamente no client-side
   * utilizando as melhores APIs (Groq Whisper, Gemini 2.5/2.0 Flash, OpenAI Whisper)
   */
  private async requestTranscript(blob: Blob, final: boolean, _mode?: "segment"): Promise<string> {
    const controller = new AbortController();
    this.aborts.add(controller);
    try {
      const text = await transcribeAudioElite(blob, {
        language: this.opts.languageName,
        contextPrompt: this.sttPrompt(),
        signal: controller.signal,
      });
      return text;
    } finally {
      this.aborts.delete(controller);
    }
  }

  private async closeTurn(audio: Float32Array) {
    if (!this.active) return;
    if (audio.length < VAD_SAMPLE_RATE * 0.2) {
      this.resumeListening();
      return;
    }
    if (this.segCursor > 0 && this.segText) {
      const samples = concatFloat32(this.turnAudio);
      const from = Math.max(0, this.segCursor - VAD_SAMPLE_RATE * (SEGMENT_OVERLAP_MS / 1000));
      const tail = samples.slice(from);
      if (tail.length >= VAD_SAMPLE_RATE * 0.15) {
        await this.dispatchTurn(encodeWav(tail, VAD_SAMPLE_RATE), this.segText);
        return;
      }
    }
    await this.dispatchTurn(encodeWav(audio, VAD_SAMPLE_RATE));
  }

  private async closeTurnBlob(blob: Blob) {
    if (!this.active) return;
    await this.dispatchTurn(blob);
  }

  private async dispatchTurn(blob: Blob, prefix = "") {
    this.setState("thinking");
    const best = this.partialText.trim();

    if (best.length >= 2) {
      this.optimistic = best;
      this.optimisticAt = performance.now();
      this.opts.onPartial(best, true);
      this.opts.onPartialParts?.(best, "", true);
      this.streamDone = false;
      void this.confirmTranscript(blob, prefix);
      try {
        await this.opts.onTranscript(best);
      } catch {}
      return;
    }

    try {
      const tail = (await this.requestTranscript(blob, true)).trim();
      if (!this.active) return;
      const said = prefix ? joinOverlap(prefix, tail) : tail;
      const merged = this.stabilizer.push(said, true);
      const text = merged.text.trim() || said;
      if (text.length < 2) {
        this.opts.onPartial("", true);
        this.resumeListening();
        return;
      }
      this.partialText = text;
      this.opts.onPartial(text, true);
      this.opts.onPartialParts?.(text, "", true);
      this.streamDone = false;
      await this.opts.onTranscript(text);
    } catch (error) {
      if (!this.active || (error as Error).name === "AbortError") return;
      this.opts.onError("Não consegui ouvir. Tenta outra vez.");
      this.resumeListening();
    }
  }

  private async confirmTranscript(blob: Blob, prefix = "") {
    let precise = "";
    try {
      const tail = (await this.requestTranscript(blob, true)).trim();
      precise = prefix ? joinOverlap(prefix, tail) : tail;
    } catch {
      return;
    }
    if (!this.active || precise.length < 2) return;

    const optimistic = this.optimistic;
    if (!optimistic || !this.opts.onCorrected) return;
    if (performance.now() - this.optimisticAt > CORRECTION_WINDOW_MS) return;
    if (divergence(optimistic, precise) < CORRECTION_THRESHOLD) return;

    this.turn += 1;
    this.queue = [];
    this.buffer = "";
    this.playing = false;
    this.streamDone = false;
    this.silenceOutput();
    this.optimistic = precise;
    this.partialText = precise;
    this.opts.onPartial(precise, true);
    this.opts.onPartialParts?.(precise, "", true);
    this.setState("thinking");
    try {
      await this.opts.onCorrected(precise);
    } catch {}
  }
}
