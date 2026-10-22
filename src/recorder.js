/**
 * HAXTAPE — Gravador e Exportador de Vídeo
 * Suporta WebCodecs ultra-rápido (offline a 60 FPS) tanto para WebM (VP9/VP8 + Opus) quanto MP4 (H.264 + AAC),
 * além de fallback automático para MediaRecorder.
 *
 * NOTA CRÍTICA DE COMPATIBILIDADE:
 * No Linux (especialmente Fedora e distribuições com VLC 3.0), o VLC possui um bug upstream conhecido
 * de "buffer deadlock prevented" no decodificador Cisco OpenH264 que gera uma janela 100% preta ao reproduzir MP4 H.264.
 * O formato WebM (VP9 + Opus) utiliza o decodificador nativo do FFmpeg no VLC, eliminando completamente a tela preta
 * e garantindo renderização instantânea com cores perfeitas e áudio estéreo sincronizado.
 */

import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4ArrayBufferTarget } from "./vendor/mp4-muxer.js";
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmArrayBufferTarget } from "./vendor/webm-muxer.js";

/**
 * Corrige o formato AVCDecoderConfigurationRecord (avcC) gerado por decodificadores como Firefox/OpenH264,
 * onde o byte de cabeçalho NAL do SPS (0x67) e do PPS (0x68) é inadvertidamente duplicado,
 * quebrando a leitura em reprodutores como VLC, Windows Media Player e QuickTime.
 * @param {ArrayBuffer|Uint8Array} description
 * @returns {ArrayBuffer}
 */
function sanitizeAvcDescription(description) {
  if (!description) return description;
  let raw;
  if (description instanceof Uint8Array) {
    raw = description;
  } else if (description.buffer) {
    raw = new Uint8Array(description.buffer, description.byteOffset || 0, description.byteLength);
  } else {
    raw = new Uint8Array(description);
  }
  if (raw.length < 8) return description;

  const version = raw[0];
  const profile = raw[1];
  const compat = raw[2];
  const level = raw[3];
  const lengthSize = raw[4] & 0x03;
  const numSps = raw[5] & 0x1f;

  let offset = 6;
  const spsList = [];

  for (let i = 0; i < numSps; i++) {
    if (offset + 2 > raw.length) break;
    const spsLen = (raw[offset] << 8) | raw[offset + 1];
    offset += 2;
    if (offset + spsLen > raw.length) break;

    let sps = raw.subarray(offset, offset + spsLen);
    offset += spsLen;

    // Detecta e remove byte duplicado do cabeçalho NAL do SPS (ex: 0x67 0x67)
    if (sps.length >= 2 && sps[0] === sps[1] && (sps[0] & 0x1f) === 7) {
      sps = sps.subarray(1);
    }
    spsList.push(sps);
  }

  if (offset >= raw.length) return description;

  const numPps = raw[offset];
  offset += 1;
  const ppsList = [];

  for (let i = 0; i < numPps; i++) {
    if (offset + 2 > raw.length) break;
    const spsLen = (raw[offset] << 8) | raw[offset + 1];
    offset += 2;
    if (offset + spsLen > raw.length) break;

    let pps = raw.subarray(offset, offset + spsLen);
    offset += spsLen;

    // Detecta e remove byte duplicado do cabeçalho NAL do PPS (ex: 0x68 0x68)
    if (pps.length >= 2 && pps[0] === pps[1] && (pps[0] & 0x1f) === 8) {
      pps = pps.subarray(1);
    }
    ppsList.push(pps);
  }

  let totalLen = 6;
  for (const s of spsList) totalLen += 2 + s.length;
  totalLen += 1;
  for (const p of ppsList) totalLen += 2 + p.length;

  const clean = new Uint8Array(totalLen);
  clean[0] = version;
  clean[1] = profile;
  clean[2] = compat;
  clean[3] = level;
  clean[4] = 0xfc | lengthSize;
  clean[5] = 0xe0 | spsList.length;

  let w = 6;
  for (const s of spsList) {
    clean[w++] = (s.length >> 8) & 0xff;
    clean[w++] = s.length & 0xff;
    clean.set(s, w);
    w += s.length;
  }

  clean[w++] = ppsList.length;
  for (const p of ppsList) {
    clean[w++] = (p.length >> 8) & 0xff;
    clean[w++] = p.length & 0xff;
    clean.set(p, w);
    w += p.length;
  }

  return clean.buffer;
}

export class ClipRecorder {
  /**
   * @param {ReplayEngine} engine
   * @param {VideoRenderer} renderer
   * @param {AudioManager} audio
   */
  constructor(engine, renderer, audio) {
    this.engine = engine;
    this.renderer = renderer;
    this.audio = audio;
    this.isExporting = false;
    this.abortController = null;
  }

  /**
   * Verifica se o navegador tem suporte à API WebCodecs VideoEncoder
   */
  static isWebCodecsSupported() {
    return typeof window.VideoEncoder !== "undefined" && typeof window.VideoFrame !== "undefined";
  }

  /**
   * Detecta se o ambiente atual tem maior estabilidade com WebM (Linux / Firefox)
   */
  static isWebmPreferred() {
    const isLinux = typeof navigator !== "undefined" && /linux/i.test(navigator.userAgent || navigator.platform || "");
    const isFirefox = typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent || "");
    return isLinux || isFirefox;
  }

  /**
   * Inicia a exportação do clipe no intervalo selecionado [startTick, endTick]
   * @param {number} startTick
   * @param {number} endTick
   * @param {object} options
   * @param {function(number, string): void} onProgress
   * @returns {Promise<Blob>}
   */
  async exportClip(startTick, endTick, options = {}, onProgress = () => {}) {
    if (this.isExporting) {
      throw new Error("Uma exportação já está em andamento.");
    }

    this.isExporting = true;
    this.abortController = new AbortController();

    const withAudio = options.withAudio ?? !this.audio.muted;
    const format = options.format || (ClipRecorder.isWebmPreferred() ? "webm" : "mp4");

    try {
      if (format === "webm") {
        if (ClipRecorder.isWebCodecsSupported() && !options.forceMediaRecorder) {
          onProgress(0, "Iniciando codificação acelerada (WebM 60 FPS)...");
          try {
            return await this._exportWithWebCodecsWebM(startTick, endTick, withAudio, onProgress);
          } catch (webcodecsErr) {
            console.warn("Falha no WebCodecs WebM, acionando fallback MediaRecorder:", webcodecsErr);
            if (this.abortController?.signal.aborted) throw webcodecsErr;
            onProgress(0, "Alternando para gravação em tempo real...");
            return await this._exportWithMediaRecorder(startTick, endTick, withAudio, onProgress, "webm");
          }
        } else {
          onProgress(0, "Iniciando gravação em tempo real (WebM)...");
          return await this._exportWithMediaRecorder(startTick, endTick, withAudio, onProgress, "webm");
        }
      } else {
        if (ClipRecorder.isWebCodecsSupported() && !options.forceMediaRecorder) {
          onProgress(0, "Iniciando codificação acelerada (MP4 60 FPS)...");
          try {
            return await this._exportWithWebCodecsMP4(startTick, endTick, withAudio, onProgress);
          } catch (webcodecsErr) {
            console.warn("Falha no WebCodecs MP4, acionando fallback MediaRecorder:", webcodecsErr);
            if (this.abortController?.signal.aborted) throw webcodecsErr;
            onProgress(0, "Alternando para gravação em tempo real...");
            return await this._exportWithMediaRecorder(startTick, endTick, withAudio, onProgress, "mp4");
          }
        } else {
          onProgress(0, "Iniciando gravação em tempo real (MP4)...");
          return await this._exportWithMediaRecorder(startTick, endTick, withAudio, onProgress, "mp4");
        }
      }
    } finally {
      this.isExporting = false;
      this.abortController = null;
    }
  }

  cancel() {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.isExporting = false;
  }

  /* ========================================================================
     Exportação WebM (VP9 / VP8 + Opus) — 100% Compatível com Linux/VLC
     ======================================================================== */

  async _exportWithWebCodecsWebM(startTick, endTick, withAudio, onProgress) {
    const totalTicks = endTick - startTick;
    if (totalTicks <= 0) {
      throw new Error("Intervalo inválido para corte.");
    }

    const width = 1280;
    const height = 720;
    const fps = 60;
    const frameIntervalUs = Math.round(1_000_000 / fps);
    const audioSampleRate = 48000;

    // Detecta codec de vídeo WebM suportado (VP9 priorizado, fallback para VP8)
    const candidateCodecs = [
      { codec: "vp09.00.10.08", muxerCodec: "V_VP9" },
      { codec: "vp8", muxerCodec: "V_VP8" }
    ];

    let chosenVideo = null;
    for (const c of candidateCodecs) {
      try {
        const supp = await VideoEncoder.isConfigSupported({
          codec: c.codec,
          width,
          height,
          bitrate: 4_500_000,
          framerate: fps
        });
        if (supp && supp.supported) {
          chosenVideo = c;
          break;
        }
      } catch (e) {}
    }

    if (!chosenVideo) {
      throw new Error("Nenhum codec WebM (VP9/VP8) suportado pelo VideoEncoder neste navegador.");
    }

    // Suporte a áudio Opus
    let canEncodeAudio = false;
    if (withAudio && typeof window.AudioEncoder !== "undefined" && typeof window.AudioData !== "undefined") {
      try {
        const aSupp = await AudioEncoder.isConfigSupported({
          codec: "opus",
          numberOfChannels: 2,
          sampleRate: audioSampleRate,
          bitrate: 128_000
        });
        if (aSupp && aSupp.supported) {
          canEncodeAudio = true;
        }
      } catch (e) {}
    }

    const muxer = new WebmMuxer({
      target: new WebmArrayBufferTarget(),
      video: {
        codec: chosenVideo.muxerCodec,
        width,
        height,
        frameRate: fps
      },
      audio: canEncodeAudio
        ? {
            codec: "A_OPUS",
            numberOfChannels: 2,
            sampleRate: audioSampleRate
          }
        : undefined
    });

    let encoderError = null;
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        console.error("Erro no VideoEncoder WebM:", e);
        encoderError = e;
      }
    });

    videoEncoder.configure({
      codec: chosenVideo.codec,
      width,
      height,
      bitrate: 4_500_000,
      framerate: fps
    });

    // Renderiza trilha de som offline se ativada
    let audioEncoder = null;
    let audioBuffer = null;
    if (canEncodeAudio) {
      try {
        audioBuffer = await this.audio.renderOfflineAudio(
          this.engine.soundEvents,
          startTick,
          endTick,
          audioSampleRate
        );

        audioEncoder = new AudioEncoder({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
          error: (e) => console.warn("Aviso no AudioEncoder Opus:", e)
        });

        audioEncoder.configure({
          codec: "opus",
          numberOfChannels: 2,
          sampleRate: audioSampleRate,
          bitrate: 128_000
        });
      } catch (err) {
        console.warn("Falha ao inicializar áudio Opus, prosseguindo apenas com vídeo:", err);
        audioEncoder = null;
      }
    }

    const originalTick = this.engine.currentTick;
    this.engine.isPlaying = false;
    this.engine.seek(startTick);

    // Centraliza câmera na bola
    if (this.engine.replay?.T?.sc) {
      const initialFrame = this.engine.replay.T.sc();
      if (initialFrame?.K?.ta?.F?.[0]?.a && this.renderer.coreRenderer?.Ya) {
        this.renderer.coreRenderer.Ya.x = initialFrame.K.ta.F[0].a.x;
        this.renderer.coreRenderer.Ya.y = initialFrame.K.ta.F[0].a.y;
      }
    }

    let frameIndex = 0;
    for (let t = startTick; t <= endTick; t++) {
      if (this.abortController?.signal.aborted) {
        throw new Error("Exportação cancelada pelo usuário.");
      }
      if (encoderError) {
        throw new Error(`Erro na codificação de vídeo: ${encoderError.message || encoderError}`);
      }

      const frameData = this.engine.step();
      if (this.renderer.coreRenderer) {
        this.renderer.coreRenderer.$c = window.performance.now() - (1000 / fps);
      }
      if (frameData) {
        this.renderer.renderFrame(frameData);
      }

      const bitmap = await createImageBitmap(this.renderer.canvas);
      const timestampUs = Math.round((frameIndex / fps) * 1_000_000);
      const videoFrame = new VideoFrame(bitmap, {
        timestamp: timestampUs,
        duration: frameIntervalUs
      });

      const isKeyFrame = frameIndex % 60 === 0;
      videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
      videoFrame.close();
      bitmap.close();

      frameIndex++;

      if (frameIndex % 15 === 0) {
        const pct = Math.round((frameIndex / totalTicks) * 85);
        onProgress(pct, `Renderizando quadros: ${pct}%`);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    onProgress(88, "Finalizando codificação de vídeo...");
    await videoEncoder.flush();
    videoEncoder.close();

    // Codifica áudio Opus sincronizado com a duração do vídeo
    if (audioEncoder && audioBuffer && audioEncoder.state === "configured") {
      try {
        onProgress(92, "Codificando trilha de áudio Opus...");
        await this._encodeOpusAudioBuffer(audioEncoder, audioBuffer, audioSampleRate);
        if (audioEncoder.state === "configured") {
          await audioEncoder.flush();
        }
      } catch (err) {
        console.warn("Erro ao codificar áudio Opus:", err);
      } finally {
        try { audioEncoder.close(); } catch (e) {}
      }
    }

    onProgress(97, "Empacotando container WebM...");
    muxer.finalize();

    this.engine.seek(originalTick);
    if (this.engine.replay) {
      this.renderer.renderFrame(this.engine.replay.T.sc());
    }

    const { buffer } = muxer.target;
    onProgress(100, "Concluído!");

    return new Blob([buffer], { type: "video/webm" });
  }

  async _encodeOpusAudioBuffer(audioEncoder, audioBuffer, sampleRate) {
    if (!audioEncoder || audioEncoder.state !== "configured") return;

    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
    const totalFrames = left.length;
    const chunkSize = 960; // 20ms a 48000Hz (quadro padrão Opus)

    let offset = 0;
    while (offset < totalFrames) {
      if (audioEncoder.state !== "configured") break;

      const framesToRead = Math.min(chunkSize, totalFrames - offset);
      const leftChunk = left.subarray(offset, offset + framesToRead);
      const rightChunk = right.subarray(offset, offset + framesToRead);

      const planarData = new Float32Array(framesToRead * 2);
      planarData.set(leftChunk, 0);
      planarData.set(rightChunk, framesToRead);

      const timestampUs = Math.round((offset / sampleRate) * 1_000_000);

      const audioData = new AudioData({
        format: "f32-planar",
        sampleRate,
        numberOfFrames: framesToRead,
        numberOfChannels: 2,
        timestamp: timestampUs,
        data: planarData
      });

      audioEncoder.encode(audioData);
      audioData.close();
      offset += framesToRead;
    }
  }

  /* ========================================================================
     Exportação MP4 (H.264 Baseline + AAC)
     ======================================================================== */

  async _exportWithWebCodecsMP4(startTick, endTick, withAudio, onProgress) {
    const totalTicks = endTick - startTick;
    if (totalTicks <= 0) {
      throw new Error("Intervalo inválido para corte.");
    }

    const width = 1280;
    const height = 720;
    const fps = 60;
    const frameIntervalUs = Math.round(1_000_000 / fps);
    const sampleRate = 44100;

    const candidateVideoCodecs = [
      "avc1.64002a",
      "avc1.64001f",
      "avc1.4d002a",
      "avc1.4d001f",
      "avc1.42002a",
      "avc1.42001f",
      "avc1.42E01E"
    ];

    let chosenVideoCodec = null;
    for (const c of candidateVideoCodecs) {
      try {
        const supp = await VideoEncoder.isConfigSupported({
          codec: c,
          width,
          height,
          bitrate: 4_500_000,
          framerate: fps
        });
        if (supp && supp.supported) {
          chosenVideoCodec = c;
          break;
        }
      } catch (e) {}
    }

    if (!chosenVideoCodec) {
      throw new Error("Nenhum codec H.264 suportado pelo VideoEncoder neste navegador.");
    }

    let canEncodeAudio = false;
    let audioConfig = null;

    if (withAudio && typeof window.AudioEncoder !== "undefined" && typeof window.AudioData !== "undefined") {
      try {
        const aSupp = await AudioEncoder.isConfigSupported({
          codec: "mp4a.40.2",
          numberOfChannels: 2,
          sampleRate,
          bitrate: 128_000
        });
        if (aSupp && aSupp.supported) {
          canEncodeAudio = true;
          audioConfig = {
            codec: "mp4a.40.2",
            numberOfChannels: 2,
            sampleRate,
            bitrate: 128_000
          };
        }
      } catch (e) {}
    }

    const muxer = new Mp4Muxer({
      target: new Mp4ArrayBufferTarget(),
      video: {
        codec: "avc",
        width,
        height
      },
      audio: canEncodeAudio
        ? {
            codec: "aac",
            numberOfChannels: 2,
            sampleRate
          }
        : undefined,
      fastStart: "in-memory"
    });

    let encoderError = null;
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig?.description) {
          meta.decoderConfig.description = sanitizeAvcDescription(meta.decoderConfig.description);
        }
        muxer.addVideoChunk(chunk, meta);
      },
      error: (e) => {
        console.error("Erro no VideoEncoder MP4:", e);
        encoderError = e;
      }
    });

    videoEncoder.configure({
      codec: chosenVideoCodec,
      width,
      height,
      bitrate: 4_500_000,
      framerate: fps
    });

    let audioEncoder = null;
    let audioBuffer = null;
    let audioFailed = false;

    if (canEncodeAudio) {
      try {
        audioBuffer = await this.audio.renderOfflineAudio(this.engine.soundEvents, startTick, endTick, sampleRate);

        audioEncoder = new AudioEncoder({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
          error: (e) => {
            console.warn("Aviso no AudioEncoder AAC:", e);
            audioFailed = true;
          }
        });

        audioEncoder.configure(audioConfig);
      } catch (err) {
        console.warn("Falha ao inicializar AudioEncoder AAC, continuando sem som:", err);
        audioFailed = true;
        audioEncoder = null;
      }
    }

    const originalTick = this.engine.currentTick;
    this.engine.isPlaying = false;
    this.engine.seek(startTick);

    if (this.engine.replay?.T?.sc) {
      const initialFrame = this.engine.replay.T.sc();
      if (initialFrame?.K?.ta?.F?.[0]?.a && this.renderer.coreRenderer?.Ya) {
        this.renderer.coreRenderer.Ya.x = initialFrame.K.ta.F[0].a.x;
        this.renderer.coreRenderer.Ya.y = initialFrame.K.ta.F[0].a.y;
      }
    }

    let frameIndex = 0;
    for (let t = startTick; t <= endTick; t++) {
      if (this.abortController?.signal.aborted) {
        throw new Error("Exportação cancelada pelo usuário.");
      }
      if (encoderError) {
        throw new Error(`Erro na codificação de vídeo: ${encoderError.message || encoderError}`);
      }

      const frameData = this.engine.step();
      if (this.renderer.coreRenderer) {
        this.renderer.coreRenderer.$c = window.performance.now() - (1000 / fps);
      }
      if (frameData) {
        this.renderer.renderFrame(frameData);
      }

      const bitmap = await createImageBitmap(this.renderer.canvas);
      const timestampUs = Math.round((frameIndex / fps) * 1_000_000);
      const videoFrame = new VideoFrame(bitmap, {
        timestamp: timestampUs,
        duration: frameIntervalUs
      });

      const isKeyFrame = frameIndex % 60 === 0;
      videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
      videoFrame.close();
      bitmap.close();

      frameIndex++;

      if (frameIndex % 15 === 0) {
        const pct = Math.round((frameIndex / totalTicks) * 85);
        onProgress(pct, `Renderizando quadros: ${pct}%`);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    onProgress(88, "Finalizando codificação de vídeo...");
    await videoEncoder.flush();
    videoEncoder.close();

    if (audioEncoder && audioBuffer && !audioFailed && audioEncoder.state === "configured") {
      try {
        onProgress(92, "Codificando áudio...");
        await this._encodeAacAudioBuffer(audioEncoder, audioBuffer, sampleRate);
        if (audioEncoder.state === "configured") {
          await audioEncoder.flush();
        }
      } catch (err) {
        console.warn("Erro ao codificar áudio, prosseguindo com vídeo:", err);
      } finally {
        try { audioEncoder.close(); } catch (e) {}
      }
    }

    onProgress(97, "Empacotando container MP4...");
    muxer.finalize();

    this.engine.seek(originalTick);
    if (this.engine.replay) {
      this.renderer.renderFrame(this.engine.replay.T.sc());
    }

    const { buffer } = muxer.target;
    onProgress(100, "Concluído!");

    return new Blob([buffer], { type: "video/mp4" });
  }

  async _encodeAacAudioBuffer(audioEncoder, audioBuffer, sampleRate) {
    if (!audioEncoder || audioEncoder.state !== "configured") return;

    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
    const totalFrames = left.length;
    const chunkSize = 1024;

    let offset = 0;
    while (offset < totalFrames) {
      if (audioEncoder.state !== "configured") break;

      const framesToRead = Math.min(chunkSize, totalFrames - offset);
      const leftChunk = left.subarray(offset, offset + framesToRead);
      const rightChunk = right.subarray(offset, offset + framesToRead);

      const planarData = new Float32Array(framesToRead * 2);
      planarData.set(leftChunk, 0);
      planarData.set(rightChunk, framesToRead);

      const timestampUs = Math.round((offset / sampleRate) * 1_000_000);

      const audioData = new AudioData({
        format: "f32-planar",
        sampleRate,
        numberOfFrames: framesToRead,
        numberOfChannels: 2,
        timestamp: timestampUs,
        data: planarData
      });

      audioEncoder.encode(audioData);
      audioData.close();
      offset += framesToRead;
    }
  }

  /* ========================================================================
     Fallback: MediaRecorder em Tempo Real
     ======================================================================== */

  async _exportWithMediaRecorder(startTick, endTick, withAudio, onProgress, format = "webm") {
    const totalTicks = endTick - startTick;
    const stream = this.renderer.canvas.captureStream(60);

    let mimeType = "video/webm";
    if (format === "mp4") {
      mimeType = MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42002a"')
        ? 'video/mp4; codecs="avc1.42002a"'
        : MediaRecorder.isTypeSupported("video/mp4")
        ? "video/mp4"
        : "video/webm";
    } else {
      mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp9')
        ? 'video/webm; codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm; codecs=vp8')
        ? 'video/webm; codecs=vp8'
        : 'video/webm';
    }

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 4_500_000
    });

    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const originalTick = this.engine.currentTick;
    this.engine.isPlaying = false;

    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        this.engine.seek(originalTick);
        if (this.engine.replay) {
          this.renderer.renderFrame(this.engine.replay.T.sc());
        }
        const blob = new Blob(chunks, { type: mimeType });
        resolve(blob);
      };

      recorder.onerror = (e) => {
        stream.getTracks().forEach((track) => track.stop());
        reject(e);
      };

      this.engine.seek(startTick);
      recorder.start();

      let current = startTick;
      const interval = setInterval(() => {
        if (this.abortController?.signal.aborted) {
          clearInterval(interval);
          recorder.stop();
          reject(new Error("Exportação cancelada pelo usuário."));
          return;
        }

        if (current >= endTick) {
          clearInterval(interval);
          recorder.stop();
          return;
        }

        const frame = this.engine.step();
        if (frame) {
          this.renderer.renderFrame(frame);
        }
        current++;

        const pct = Math.round(((current - startTick) / totalTicks) * 100);
        onProgress(pct, `Gravando em tempo real: ${pct}%`);
      }, 1000 / 60);
    });
  }
}
