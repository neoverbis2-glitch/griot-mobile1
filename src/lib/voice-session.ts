/**
 * Conversa por voz real do GRIOT.
 *
 * Arquitetura:
 *  - Ouvido: detetor de fala neuronal (Silero VAD em WASM) sobre o microfone.
 *    Distingue voz de ruído e marca o fim do turno com precisão. Se o modelo
 *    não carregar, há um detetor por energia/banda vocal como reserva.
 *  - Transcrição: janelas em WAV completo sobem durante a fala (modelo rápido)
 *    e são fundidas por um estabilizador; no fim do turno a transcrição de alta
 *    precisão corre em paralelo, fora do caminho crítico.
 *  - Resposta otimista: assim que a fala termina, o modelo arranca com a melhor
 *    transcrição já disponível; se a versão de alta precisão divergir muito,
 *    o turno é refeito com o texto corrigido.
 *  - Voz: PCM em streaming, frase a frase, com crossfade entre frases e
 *    prosódia adaptada ao conteúdo.
 *  - Interrupção: fala curta por cima ("hum", "pois") só baixa o volume e a
 *    resposta retoma; fala sustentada cancela tudo e volta a ouvir.
 */

import { TranscriptStabilizer } from "./transcript-stabilizer";
import { concatFloat32, encodeWav } from "./audio-wav";
import { startNeuralVad, VAD_SAMPLE_RATE, type NeuralVadHandle } from "./neural-vad";

export type VoiceSessionState = "listening" | "thinking" | "speaking";

type Options = {
  onState: (state: VoiceSessionState) => void;
  onLevels: (levels: number[]) => void;
  /** Transcrição parcial/final do que o utilizador está a dizer (tempo real). */
  onPartial: (text: string, final: boolean) => void;
  /** Igual a onPartial, mas separa o texto consolidado da cauda provisória. */
  onPartialParts?: (stable: string, tentative: string, final: boolean) => void;
  onTranscript: (text: string) => void | Promise<void>;
  /**
   * A transcrição de alta precisão divergiu do arranque otimista: o turno deve
   * ser refeito com este texto (quem chama aborta o stream em curso).
   */
  onCorrected?: (text: string) => void | Promise<void>;
  onError: (message: string) => void;
  bars?: number;
  voice?: string;
  /** Velocidade da voz sintetizada (0.5–2). */
  speed?: number;
  /** Nome do idioma principal do utilizador (afina a transcrição). */
  languageName?: string;
  /** Se falso, falar por cima não interrompe a resposta. */
  allowInterrupt?: boolean;
  /** Chamado quando a resposta é interrompida (orbe ou barge-in por voz). */
  onInterrupt?: () => void;
};

/** Limites do turno: evita gravações infinitas e recortes demasiado curtos. */
const MAX_TURN_MS = 24000;
const MIN_TURN_MS = 300;
const SILENCE_MS = 620;
/** Frase terminada com pontuação final: fecha o turno mais depressa. */
const SILENCE_TERMINAL_MS = 380;
const PARTIAL_EVERY_MS = 850;
/** Janela autónoma transcrita durante a fala (segmento sobreposto). */
const SEGMENT_MS = 1500;
/** Sobreposição entre janelas: nenhuma palavra fica cortada na junção. */
const SEGMENT_OVERLAP_MS = 320;
/** Cadência de verificação de novas janelas prontas. */
const SEGMENT_TICK_MS = 250;

/** Ignora barge-in nos primeiros ms de fala (cauda do próprio áudio). */
const BARGE_GRACE_MS = 300;
/** Fala por cima abaixo deste tempo é confirmação ("hum"), não interrupção. */
const BACKCHANNEL_MS = 460;
/** Volume da resposta enquanto se avalia se a fala por cima é interrupção. */
const DUCK_GAIN = 0.14;
/** PCM da voz: 24 kHz, 16 bits, mono — formato do streaming TTS. */
const PCM_RATE = 24000;
/** Crossfade entre frases faladas: a próxima entra 70 ms antes do fim. */
const CROSSFADE_S = 0.07;
/** Divergência mínima (0–1) para refazer o turno com a transcrição precisa. */
const CORRECTION_THRESHOLD = 0.26;
/** Depois disto já é tarde para corrigir: a resposta vai adiantada. */
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

/** Distância entre duas transcrições, 0 (iguais) a 1 (nada em comum). */
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
  // Levenshtein por palavras (as frases são curtas: custo irrelevante).
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

/** Prosódia: pista curta para o sintetizador, conforme o conteúdo da frase. */
function toneOf(sentence: string): string | undefined {
  if (/\?\s*$/.test(sentence)) return "question";
  if (/\d[\d.,:%/-]*/.test(sentence) && /\d{2,}|[%€$]/.test(sentence)) return "numeric";
  if (/^\s*(?:[-•*]|\d+[.)])\s/.test(sentence) || (sentence.match(/,/g) ?? []).length >= 3)
    return "list";
  if (/!\s*$/.test(sentence)) return "emphatic";
  return undefined;
}

/** Stream de uma frase falada: blocos PCM chegam por SSE e acumulam aqui. */
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

  /** Detetor neuronal (quando disponível). */
  private vad: NeuralVadHandle | null = null;
  private neural = false;
  private neuralProb = 0;
  /** Amostras do turno atual, vindas do detetor a 16 kHz. */
  private turnAudio: Float32Array[] = [];
  private turnActive = false;

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private recordingSince = 0;
  private lastVoice = 0;
  private voiceFrames = 0;
  private floor = 0.008;
  /** Piso de ruído na banda vocal (300–3400 Hz). */
  private vocalFloor = 0.04;
  /** Eco da voz do GRIOT na banda vocal (limiar adaptativo de barge-in). */
  private echo = 0.1;
  /** A transcrição parcial terminou com pontuação final. */
  private partialTerminal = false;

  /** Fala por cima em avaliação: quando começou e se o volume já foi baixado. */
  private bargeSince = 0;
  private ducked = false;

  private partialTimer = 0;
  private partialBusy = false;
  private partialText = "";
  private stabilizer = new TranscriptStabilizer(2);
  private aborts = new Set<AbortController>();

  /** Amostras do turno já cobertas por janelas fechadas. */
  private segCursor = 0;
  /** Texto acumulado das janelas já transcritas (prefixo do turno). */
  private segText = "";

  /** Texto enviado de forma otimista e o instante do envio. */
  private optimistic = "";
  private optimisticAt = 0;

  private queue: string[] = [];
  private buffer = "";
  private streamDone = false;
  private playing = false;
  private turn = 0;
  private spoken = 0;
  private spokeAt = 0;
  /** Última frase falada pelo GRIOT — contexto para a transcrição seguinte. */
  private lastReply = "";

  /** Reprodução Web Audio: fontes agendadas e posição de agenda. */
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

    // Saída: fontes PCM → ganho mestre → analisador (orbe reativo) → colunas.
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

    // O detetor neuronal carrega em segundo plano: a sessão já funciona com o
    // detetor por energia enquanto o modelo não está pronto.
    void this.initNeuralVad();
    void this.prewarmVoice();
  }

  /** Liga o detetor neuronal ao stream já aberto (reserva: detetor por energia). */
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
      // Se o detetor por energia já tinha aberto uma gravação, encerra-a.
      this.stopRecorder(false);
    }
  }

  /**
   * Primeira ligação ao sintetizador aberta em segundo plano: a primeira
   * resposta da sessão não paga o custo de arranque da ligação.
   */
  private async prewarmVoice() {
    const controller = new AbortController();
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warmup: true }),
        signal: controller.signal,
      });
      await response.body?.cancel().catch(() => undefined);
    } catch {
      // aquecimento é best-effort
    }
  }

  /** Começa a acumular áudio do turno e a transcrever em tempo real. */
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
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.outAnalyser = null;
    this.master = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.analyser = null;
  }

  /** Texto em streaming do modelo: fala assim que houver uma frase completa. */
  feed(delta: string) {
    this.buffer += delta;
    for (;;) {
      const match = this.buffer.match(/^[\s\S]*?[.!?…:\n]+\s/);
      if (!match) break;
      const sentence = match[0];
      this.buffer = this.buffer.slice(sentence.length);
      this.push(sentence);
    }
    // O primeiro pedaço é curto de propósito: a voz arranca quase de imediato.
    const limit = this.spoken === 0 ? 70 : 180;
    if (this.buffer.length > limit) {
      const cut = this.buffer.lastIndexOf(" ", limit - 20);
      if (cut > 24) {
        this.push(this.buffer.slice(0, cut));
        this.buffer = this.buffer.slice(cut);
      }
    }
  }

  /** O modelo terminou: fala o resto e volta a ouvir. */
  finish() {
    if (this.buffer.trim()) this.push(this.buffer);
    this.buffer = "";
    this.streamDone = true;
    if (!this.playing && this.queue.length === 0) this.resumeListening();
  }

  /** Interromper a resposta e voltar a ouvir. */
  interrupt() {
    this.turn += 1;
    this.queue = [];
    this.buffer = "";
    this.playing = false;
    this.streamDone = false;
    this.abortPending();
    this.silenceOutput();
    this.resumeListening();
    // Avisa o dono da sessão: o stream do modelo também deve ser abortado,
    // senão o resto da resposta voltava a encher a fila e continuava a falar.
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

  /** Baixa o volume da resposta sem a destruir (fala curta por cima). */
  private duck() {
    if (this.ducked || !this.ctx || !this.master) return;
    this.ducked = true;
    const now = this.ctx.currentTime;
    const gain = this.master.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(gain.value, 0.0001), now);
    gain.exponentialRampToValueAtTime(DUCK_GAIN, now + 0.08);
  }

  /** Retoma o volume: a fala por cima era só uma confirmação. */
  private unduck() {
    this.bargeSince = 0;
    if (!this.ducked || !this.ctx || !this.master) return;
    this.ducked = false;
    const now = this.ctx.currentTime;
    const gain = this.master.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(gain.value, 0.0001), now);
    gain.exponentialRampToValueAtTime(1, now + 0.18);
  }

  /** Cala imediatamente tudo o que está agendado, com um fade de 50 ms. */
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
    if (this.ctx && this.master) {
      const now = this.ctx.currentTime;
      const gain = this.master.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(Math.max(gain.value, 0.0001), now);
      gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      // Repõe o volume para o próximo turno.
      gain.linearRampToValueAtTime(1, now + 0.4);
    }
    this.playhead = 0;
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
      let stream = next ?? this.streamSentence(sentence);
      next = null;
      // Pré-carrega a frase seguinte enquanto esta toca.
      const upcoming = this.queue[0];
      if (upcoming) next = this.streamSentence(upcoming);
      // Uma segunda tentativa quando a primeira falhou sem áudio nenhum.
      if (stream.ended && stream.failed && stream.chunks.length === 0) {
        stream = this.streamSentence(sentence);
      }
      if (stream.failed && stream.chunks.length === 0) {
        await stream.done;
        continue;
      }
      await this.speak(stream, turn);
      await stream.done;
    }

    this.playing = false;
    if (this.active && turn === this.turn && this.streamDone) {
      // Pequena pausa para não apanhar a cauda do próprio áudio.
      await sleep(140);
      if (this.active && turn === this.turn) this.resumeListening();
    }
  }

  /** Pede a voz ao servidor em streaming SSE e acumula os blocos PCM. */
  private streamSentence(text: string): SentenceStream {
    const handle: SentenceStream = {
      chunks: [],
      ended: false,
      failed: false,
      done: Promise.resolve(),
    };
    const controller = new AbortController();
    this.aborts.add(controller);
    const tone = toneOf(text);

    handle.done = (async () => {
      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voice: this.opts.voice ?? "alloy",
            speed: this.opts.speed ?? 1.0,
            stream: true,
            ...(tone ? { tone } : {}),
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body)
          throw new Error(await response.text().catch(() => "tts"));
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
              } catch {
                // evento parcialmente recebido — ignora
              }
            }
            sep = pending.indexOf("\n\n");
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
   * Agenda os blocos PCM no grafo de áudio à medida que chegam, com fade-in no
   * início da frase e fade-out na cauda — a transição entre frases é um
   * crossfade contínuo, sem cortes nem silêncios.
   */
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
      // Crossfade: a frase nova sobrepõe a cauda da anterior.
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
    // Fade-out suave na cauda da frase.
    const end = this.playhead;
    if (!first && end > ctx.currentTime + 0.09) {
      gain.gain.setValueAtTime(1, end - 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, end + 0.03);
    }
    // Espera até a frase terminar de tocar (ou até ser interrompida).
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
    // Banda vocal 300–3400 Hz nos bins do analisador do microfone.
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
        // O orbe mostra a voz do utilizador (banda vocal, mais estável).
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
          // Reserva sem o modelo neuronal: energia geral + banda vocal.
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
            // Frase com pontuação final fecha o turno mais cedo: menos espera.
            const silenceNeeded = this.partialTerminal ? SILENCE_TERMINAL_MS : SILENCE_MS;
            if (this.recorder && this.lastVoice && now - this.lastVoice > silenceNeeded)
              this.stopRecorder(true);
          }
          // Turno demasiado longo: fecha e transcreve o que já existe.
          if (this.recorder && now - this.recordingSince > MAX_TURN_MS) this.stopRecorder(true);
        } else if (this.turnActive && now - this.recordingSince > MAX_TURN_MS) {
          // Turno demasiado longo com o detetor neuronal: fecha à mesma.
          this.turnActive = false;
          this.stopPartials();
          void this.closeTurn(concatFloat32(this.turnAudio));
        }
      } else if (this.state === "speaking") {
        // Orbe reativo: níveis reais do áudio que o GRIOT está a falar.
        if (outAnalyser && outFreq.length > 0) {
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

        // Barge-in em dois tempos. Primeiro sinal: baixa o volume. Se a fala
        // continuar além de BACKCHANNEL_MS, é interrupção a sério; se parar
        // antes, era só uma confirmação e a resposta retoma o volume.
        const settled = this.spokeAt > 0 && now - this.spokeAt > BARGE_GRACE_MS;
        // O modelo neuronal manda quando está disponível; o eco na banda vocal
        // continua a proteger contra a auto-interrupção em altifalante.
        const speechOver = this.neural
          ? this.neuralProb > 0.6 && vocal > Math.max(0.1, this.echo * 1.25)
          : vocal > Math.max(0.17, this.echo * 1.8);
        const loudSpeech = this.neural
          ? this.neuralProb > 0.85 && vocal > Math.max(0.2, this.echo * 1.9)
          : vocal > Math.max(0.3, this.echo * 2.3);

        if ((speechOver || loudSpeech) && settled) {
          if (!this.bargeSince) this.bargeSince = now;
          if (this.opts.allowInterrupt !== false) {
            this.duck();
            if (now - this.bargeSince > BACKCHANNEL_MS) {
              this.bargeSince = 0;
              this.ducked = false;
              this.interrupt();
              this.raf = requestAnimationFrame(tick);
              return;
            }
          }
        } else {
          if (this.bargeSince && now - this.bargeSince > 90) this.unduck();
          this.voiceFrames = 0;
          if (vocal > this.echo) this.echo += (vocal - this.echo) * 0.05;
          else this.echo *= 0.93;
        }
      }

      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
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
        if (this.pendingTranscribe) {
          this.pendingTranscribe = false;
          void this.closeTurnBlob(blob);
        }
      };
      recorder.start(250);
      this.recorder = recorder;
      this.recordingSince = performance.now();
      this.startPartials(recorder);
    } catch {
      this.opts.onError("Não consigo gravar áudio neste dispositivo.");
      this.active = false;
    }
  }

  /**
   * Transcrição contínua por janelas sobrepostas: durante a fala, cada ~1,5 s
   * fecha-se um segmento autónomo (WAV completo, com uma pequena sobreposição
   * para não cortar palavras) que sobe ao modelo rápido. O estabilizador funde
   * os segmentos, por isso no fim do turno só falta transcrever a cauda.
   */
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

  /** Funde o texto de uma janela no prefixo já acumulado do turno. */
  private applySegment(text: string) {
    const said = text.trim();
    if (!said) return;
    const merged = joinOverlap(this.segText, said);
    if (!merged || merged === this.segText) return;
    this.segText = merged;
    this.applyPartial(merged);
  }

  /** Transcrição em tempo real (reserva): envia o áudio acumulado a cada ~0,85 s. */
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

  /** Funde uma hipótese parcial e mostra o texto estabilizado. */
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

  /** Contexto recente para afinar a transcrição (nomes, termos, idioma). */
  private sttPrompt(): string {
    const bits: string[] = [];
    if (this.opts.languageName) bits.push(`O utilizador fala ${this.opts.languageName}.`);
    if (this.partialText.trim()) bits.push(this.partialText.trim().slice(-180));
    if (this.lastReply) bits.push(this.lastReply.slice(-180));
    return bits.join(" ").slice(0, 600);
  }

  private async requestTranscript(blob: Blob, final: boolean, mode?: "segment"): Promise<string> {
    const controller = new AbortController();
    this.aborts.add(controller);
    try {
      const type = blob.type || "audio/webm";
      const ext = type.includes("wav") ? "wav" : type.includes("mp4") ? "mp4" : "webm";
      const form = new FormData();
      form.append("audio", blob, `turno.${ext}`);
      // A transcrição final usa o modelo de alta precisão; janelas e parciais,
      // o modelo rápido.
      form.append("mode", final ? "final" : (mode ?? "partial"));
      const prompt = this.sttPrompt();
      if (prompt) form.append("prompt", prompt);
      const response = await fetch("/api/stt", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { text?: string };
      return payload.text ?? "";
    } finally {
      this.aborts.delete(controller);
    }
  }

  /** Fim de turno do detetor neuronal: áudio bruto a 16 kHz. */
  private async closeTurn(audio: Float32Array) {
    if (!this.active) return;
    if (audio.length < VAD_SAMPLE_RATE * 0.2) {
      this.resumeListening();
      return;
    }
    // Se já houve janelas transcritas, a transcrição final cobre só a cauda
    // (último segmento) — o prefixo já está consolidado.
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

  /** Fim de turno do detetor por energia (reserva): blob do MediaRecorder. */
  private async closeTurnBlob(blob: Blob) {
    if (!this.active) return;
    await this.dispatchTurn(blob);
  }

  /**
   * Arranca a resposta com a melhor transcrição disponível e, em paralelo,
   * confirma-a com o modelo de alta precisão. Se divergirem muito e ainda for
   * cedo, o turno é refeito com o texto correto.
   *
   * `prefix` é o texto já consolidado pelas janelas anteriores: nesse caso o
   * `blob` é só a cauda do turno.
   */
  private async dispatchTurn(blob: Blob, prefix = "") {
    this.setState("thinking");
    const best = this.partialText.trim();

    if (best.length >= 2) {
      this.optimistic = best;
      this.optimisticAt = performance.now();
      this.opts.onPartial(best, true);
      this.opts.onPartialParts?.(best, "", true);
      this.streamDone = false;
      // Confirmação de alta precisão em paralelo — fora do caminho crítico.
      void this.confirmTranscript(blob, prefix);
      try {
        await this.opts.onTranscript(best);
      } catch {
        // quem chama trata o erro do modelo
      }
      return;
    }

    // Sem parcial utilizável: espera pela transcrição de alta precisão.
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

  /** Transcrição de alta precisão do turno já despachado; corrige se divergir. */
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

    // Divergiu de forma relevante: cala o que estiver a sair e refaz o turno.
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
    } catch {
      // quem chama trata o erro
    }
  }
}
