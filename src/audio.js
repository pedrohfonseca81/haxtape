/**
 * HAXTAPE — Gerenciador de Áudio e Efeitos Sonoros
 * Reproduz sons ao vivo via Web Audio API e sintetiza faixas de áudio para exportação MP4.
 */

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.buffers = {
      kick: null,
      goal: null,
      highlight: null
    };
    this.muted = false;
    this.volume = 1.0;
    this.isLoaded = false;
  }

  /**
   * Inicializa o AudioContext e carrega os arquivos de áudio originais
   */
  async init() {
    if (this.isLoaded) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      this.ctx = new AudioContextClass();
    }

    try {
      const [kickBuf, goalBuf, postBuf] = await Promise.all([
        this._fetchAndDecode("assets/audio/kick.ogg"),
        this._fetchAndDecode("assets/audio/goal.ogg"),
        this._fetchAndDecode("assets/audio/highlight.wav")
      ]);

      this.buffers.kick = kickBuf;
      this.buffers.goal = goalBuf;
      this.buffers.highlight = postBuf;
      this.isLoaded = true;
    } catch (err) {
      console.warn("Não foi possível carregar alguns efeitos sonoros:", err);
    }
  }

  async _fetchAndDecode(url) {
    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    if (this.ctx) {
      return await this.ctx.decodeAudioData(arrayBuffer);
    }
    return null;
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  setMuted(muted) {
    this.muted = muted;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  /**
   * Reproduz um efeito sonoro ao vivo
   */
  playSound(type, customVolume = 1.0) {
    if (this.muted || !this.ctx || !this.buffers[type]) return;
    this.resume();

    try {
      const source = this.ctx.createBufferSource();
      source.buffer = this.buffers[type];

      const gain = this.ctx.createGain();
      gain.gain.value = this.volume * customVolume;

      source.connect(gain);
      gain.connect(this.ctx.destination);
      source.start(0);
    } catch (e) {
      // Ignora falhas pontuais de reprodução
    }
  }

  playKick() {
    this.playSound("kick", 0.9);
  }

  playGoal() {
    this.playSound("goal", 1.0);
  }

  playPost() {
    this.playSound("highlight", 0.85);
  }

  /**
   * Renderiza uma faixa de áudio offline para o trecho do clipe
   * @param {Array<{ tick: number, type: 'kick' | 'goal' | 'highlight' }>} soundEvents
   * @param {number} startTick
   * @param {number} endTick
   * @param {number} sampleRate
   * @returns {Promise<AudioBuffer>}
   */
  async renderOfflineAudio(soundEvents, startTick, endTick, sampleRate = 44100) {
    const durationSec = Math.max(0.1, (endTick - startTick) / 60);
    const totalSamples = Math.ceil(durationSec * sampleRate);

    // Cria contexto offline
    const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
      2, // Estéreo
      totalSamples,
      sampleRate
    );

    // Conecta os eventos que ocorrem dentro do intervalo selecionado
    for (const evt of soundEvents) {
      if (evt.tick >= startTick && evt.tick <= endTick) {
        const offsetSec = (evt.tick - startTick) / 60;
        const buf = this.buffers[evt.type];
        if (buf) {
          const src = offlineCtx.createBufferSource();
          src.buffer = buf;
          src.connect(offlineCtx.destination);
          src.start(offsetSec);
        }
      }
    }

    return await offlineCtx.startRendering();
  }
}
