/**
 * HAXTAPE — Controlador Principal da Aplicação
 * Conecta UI, Engine, Renderizador, Áudio e Gravador MP4.
 */

import { Hbr2Parser } from "./parser.js?v=nocache_3";
import { AudioManager } from "./audio.js?v=nocache_3";
import { ReplayEngine } from "./engine.js?v=nocache_3";
import { VideoRenderer } from "./renderer.js?v=nocache_3";
import { ClipRecorder } from "./recorder.js?v=nocache_3";

class HaxTapeApp {
  constructor() {
    this.canvas = document.getElementById("game-canvas");
    this.audio = new AudioManager();
    this.engine = new ReplayEngine(this.audio);
    this.renderer = new VideoRenderer(this.canvas, this.engine);
    this.recorder = new ClipRecorder(this.engine, this.renderer, this.audio);

    // Estado do corte
    this.trimStartTick = 0;
    this.trimEndTick = 0;
    this.isDraggingHandle = null; // 'start' | 'end' | null

    // Cache de elementos DOM
    this.dom = {
      dropzone: document.getElementById("dropzone"),
      dropzoneClickable: document.getElementById("dropzone-clickable"),
      fileInput: document.getElementById("file-input"),
      controlsPanel: document.getElementById("controls-panel"),
      matchContainer: document.getElementById("match-selector-container"),
      matchSelect: document.getElementById("match-select"),
      btnPlayPause: document.getElementById("btn-play-pause"),
      playIcon: document.getElementById("play-icon"),
      playIndicator: document.getElementById("play-indicator"),
      currentTimeText: document.getElementById("current-time"),
      totalTimeText: document.getElementById("total-time"),
      trimDurationText: document.getElementById("trim-duration-text"),
      timelineBar: document.getElementById("timeline-bar"),
      timelineRange: document.getElementById("timeline-range"),
      timelinePlayhead: document.getElementById("timeline-playhead"),
      timelineMarkers: document.getElementById("timeline-markers"),
      handleStart: document.getElementById("handle-start"),
      handleEnd: document.getElementById("handle-end"),
      btnSetIn: document.getElementById("btn-set-in"),
      btnSetOut: document.getElementById("btn-set-out"),
      btnToggleAudio: document.getElementById("btn-toggle-audio"),
      audioIcon: document.getElementById("audio-icon"),
      exportFormatSelect: document.getElementById("export-format-select"),
      btnExportMp4: document.getElementById("btn-export-mp4"),
      btnExportText: document.getElementById("btn-export-text"),
      exportModal: document.getElementById("export-modal"),
      exportModalTitle: document.getElementById("export-modal-title"),
      exportStatusText: document.getElementById("export-status-text"),
      exportProgressFill: document.getElementById("export-progress-fill"),
      exportProgressPct: document.getElementById("export-progress-pct"),
      btnCancelExport: document.getElementById("btn-cancel-export"),
      panelScoreboard: document.getElementById("panel-scoreboard"),
      panelScoreRed: document.getElementById("panel-score-red"),
      panelScoreBlue: document.getElementById("panel-score-blue"),
      panelMatchTime: document.getElementById("panel-match-time")
    };

    this.lastFrameTime = performance.now();
    this.accumulatedTime = 0;

    this.init();
  }

  async init() {
    this._setupEventListeners();
    this._setupDropzone();
    this._startRenderLoop();

    if (this.dom.exportFormatSelect) {
      const preferWebm = ClipRecorder.isWebmPreferred();
      this.dom.exportFormatSelect.value = preferWebm ? "webm" : "mp4";
      this._updateExportButtonText();
    }
  }

  _updateExportButtonText() {
    const fmt = this.dom.exportFormatSelect?.value || "webm";
    if (this.dom.btnExportText) {
      this.dom.btnExportText.textContent = `Baixar Clipe (.${fmt})`;
    }
  }

  /* ========================================================================
     Carregamento de Arquivos e Replay
     ======================================================================== */

  async loadReplayFile(file) {
    if (!file) return;
    try {
      this._showLoading("Lendo e descompactando replay...");
      const arrayBuffer = await file.arrayBuffer();
      await this.processReplayBuffer(arrayBuffer, file.name);
    } catch (err) {
      console.error(err);
      alert("Erro ao carregar replay: " + err.message);
    } finally {
      if (this.dom.fileInput) {
        this.dom.fileInput.value = "";
      }
    }
  }

  async processReplayBuffer(buffer, filename = "partida.hbr2") {
    // Inicializa o sistema de áudio
    await this.audio.init();

    // Valida e descompacta via Parser
    const parsed = await Hbr2Parser.parse(buffer);

    // Carrega na engine determinística
    const info = await this.engine.loadReplay(parsed.rawBytes);

    // Esconde a dropzone e mostra os controles
    this.dom.dropzone.style.display = "none";
    this.dom.controlsPanel.style.display = "flex";

    // Configura o corte inicial cobrindo o replay do início ao fim
    this.trimStartTick = 0;
    this.trimEndTick = this.engine.durationTicks;

    // Configura o seletor de partidas (se houver mais de uma)
    if (info.matches && info.matches.length > 1) {
      this.dom.matchContainer.style.display = "flex";
      this.dom.matchSelect.innerHTML = "";
      info.matches.forEach((m, idx) => {
        const opt = document.createElement("option");
        opt.value = idx;
        const durMin = Math.floor((m.endTick - m.startTick) / 3600);
        const durSec = Math.floor(((m.endTick - m.startTick) % 3600) / 60);
        opt.textContent = `Jogo ${idx + 1}: Red ${m.scoreRed}x${m.scoreBlue} Blue (${String(durMin).padStart(2, "0")}:${String(durSec).padStart(2, "0")})`;
        this.dom.matchSelect.appendChild(opt);
      });
    } else {
      this.dom.matchContainer.style.display = "none";
    }

    // Cria os marcadores visuais de gol na timeline
    this._renderTimelineMarkers(info.markers);

    // Começa exatamente do início (tick 0)
    this.engine.seek(0);
    const firstFrame = this.engine.replay.T.sc();
    this.renderer.renderFrame(firstFrame);

    // Inicia a reprodução automaticamente a partir do início
    this.engine.isPlaying = true;
    this.dom.playIcon.textContent = "❚❚";

    this._updateTimelineUI();
    this._updateTimeText();
  }

  _showLoading(text) {
    if (this.dom.dropzone && this.dom.dropzone.style.display !== "none") {
      const p = this.dom.dropzone.querySelector("p");
      if (p) p.textContent = text;
    }
  }

  /* ========================================================================
     Loop Principal de Reprodução e Renderização
     ======================================================================== */

  _startRenderLoop() {
    const loop = (now) => {
      requestAnimationFrame(loop);

      const deltaMs = Math.min(100, now - this.lastFrameTime);
      this.lastFrameTime = now;

      if (!this.engine.replay) return;

      if (this.engine.isPlaying) {
        this.accumulatedTime += deltaMs * this.engine.playbackSpeed;
        const tickDurationMs = 1000 / 60; // 16.666ms por tick

        let lastFrame = null;
        while (this.accumulatedTime >= tickDurationMs) {
          // Se atingiu o final do corte, faz loop de volta para o início do corte
          if (this.engine.currentTick >= this.trimEndTick) {
            this.engine.seek(this.trimStartTick);
          }

          const frame = this.engine.step();
          if (frame) {
            lastFrame = frame;
          }
          this.accumulatedTime -= tickDurationMs;
        }

        // Renderiza apenas uma vez por frame de tela para máxima fluidez a 60 FPS
        if (lastFrame) {
          this.renderer.renderFrame(lastFrame);
        }

        this._updateTimelineUI();
        this._updateTimeText();
      }
    };

    requestAnimationFrame(loop);
  }

  togglePlayPause() {
    if (!this.engine.replay) return;

    this.engine.isPlaying = !this.engine.isPlaying;
    this.dom.playIcon.textContent = this.engine.isPlaying ? "❚❚" : "▶";

    // Mostra indicador rápido no centro do canvas
    this.dom.playIndicator.textContent = this.engine.isPlaying ? "▶" : "❚❚";
    this.dom.playIndicator.classList.add("show");
    setTimeout(() => this.dom.playIndicator.classList.remove("show"), 350);

    // Se estiver no final do corte e der play, recomeça do início do corte
    if (this.engine.isPlaying && this.engine.currentTick >= this.trimEndTick) {
      this.engine.seek(this.trimStartTick);
    }
  }

  /* ========================================================================
     Timeline e Corte Interativo
     ======================================================================== */

  _renderTimelineMarkers(markers) {
    this.dom.timelineMarkers.innerHTML = "";
    if (!markers || markers.length === 0 || this.engine.durationTicks === 0) return;

    markers.forEach((m) => {
      const pct = (m.tick / this.engine.durationTicks) * 100;
      const markerEl = document.createElement("div");
      markerEl.className = `goal-marker ${m.kind === 1 ? "red" : "blue"}`;
      markerEl.style.left = `${pct}%`;
      const mins = Math.floor(m.timeSec / 60);
      const secs = Math.floor(m.timeSec % 60);
      markerEl.title = `Gol aos ${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")} — Clique para clipar (-5s a +3s)`;

      markerEl.addEventListener("click", (e) => {
        e.stopPropagation();
        this._snapClipAroundGoal(m.tick);
      });

      this.dom.timelineMarkers.appendChild(markerEl);
    });
  }

  _snapClipAroundGoal(goalTick) {
    this.trimStartTick = Math.max(0, goalTick - 300); // 5 segundos antes
    this.trimEndTick = Math.min(this.engine.durationTicks, goalTick + 180); // 3 segundos após
    this.engine.seek(this.trimStartTick);
    const frame = this.engine.replay.T.sc();
    this.renderer.renderFrame(frame);
    this._updateTimelineUI();
    this._updateTimeText();
  }

  _updateTimelineUI() {
    if (!this.engine.durationTicks) return;

    const currentPct = (this.engine.currentTick / this.engine.durationTicks) * 100;
    const startPct = (this.trimStartTick / this.engine.durationTicks) * 100;
    const endPct = (this.trimEndTick / this.engine.durationTicks) * 100;

    this.dom.timelinePlayhead.style.left = `${currentPct}%`;
    this.dom.handleStart.style.left = `${startPct}%`;
    this.dom.handleEnd.style.left = `${endPct}%`;

    this.dom.timelineRange.style.left = `${startPct}%`;
    this.dom.timelineRange.style.width = `${Math.max(0, endPct - startPct)}%`;

    // Atualiza texto de duração do corte
    const startSec = this.trimStartTick / 60;
    const endSec = this.trimEndTick / 60;
    const durSec = (this.trimEndTick - this.trimStartTick) / 60;

    const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    this.dom.trimDurationText.textContent = `${fmt(startSec)} - ${fmt(endSec)} (${durSec.toFixed(1)}s)`;
  }

  _updateTimeText() {
    const curSec = this.engine.currentTick / 60;
    const totSec = this.engine.durationTicks / 60;
    const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

    this.dom.currentTimeText.textContent = fmt(curSec);
    this.dom.totalTimeText.textContent = fmt(totSec);

    this._updateScoreboardUI();
  }

  _updateScoreboardUI() {
    if (!this.engine.replay) return;
    const state = this.engine.getState();
    const redScore = (state && typeof state.redScore === "number" && !isNaN(state.redScore)) ? state.redScore : 0;
    const blueScore = (state && typeof state.blueScore === "number" && !isNaN(state.blueScore)) ? state.blueScore : 0;
    const timeVal = (state && typeof state.matchTime === "number" && !isNaN(state.matchTime)) ? Math.max(0, state.matchTime) : 0;

    const mins = Math.floor(timeVal / 60);
    const secs = timeVal % 60;
    const timeStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    if (this.dom.panelScoreRed && this.dom.panelScoreRed.textContent !== String(redScore)) {
      this.dom.panelScoreRed.textContent = String(redScore);
    }
    if (this.dom.panelScoreBlue && this.dom.panelScoreBlue.textContent !== String(blueScore)) {
      this.dom.panelScoreBlue.textContent = String(blueScore);
    }
    if (this.dom.panelMatchTime && this.dom.panelMatchTime.textContent !== timeStr) {
      this.dom.panelMatchTime.textContent = timeStr;
    }
  }

  /* ========================================================================
     Exportação de MP4
     ======================================================================== */

  async startExport(options = {}) {
    if (!this.engine.replay) return;

    this.engine.isPlaying = false;
    this.dom.playIcon.textContent = "▶";

    const format = this.dom.exportFormatSelect?.value || "mp4";
    if (this.dom.exportModalTitle) {
      this.dom.exportModalTitle.textContent = `Exportando Clipe (${format.toUpperCase()})`;
    }

    this.dom.exportModal.style.display = "flex";
    this.dom.exportProgressFill.style.width = "0%";
    this.dom.exportProgressPct.textContent = "0%";
    this.dom.exportStatusText.textContent = "Preparando renderização do clipe...";

    try {
      const blob = await this.recorder.exportClip(
        this.trimStartTick,
        this.trimEndTick,
        { withAudio: !this.audio.muted, format, ...options },
        (pct, text) => {
          this.dom.exportProgressFill.style.width = `${pct}%`;
          this.dom.exportProgressPct.textContent = `${pct}%`;
          this.dom.exportStatusText.textContent = text;
        }
      );

      // Gera download automático do arquivo de vídeo
      const startSec = Math.floor(this.trimStartTick / 60);
      const endSec = Math.floor(this.trimEndTick / 60);
      const ext = blob.type.includes("webm") ? "webm" : "mp4";
      const filename = `HaxTape-clipe-${startSec}s-${endSec}s.${ext}`;

      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      setTimeout(() => {
        this.dom.exportModal.style.display = "none";
      }, 600);
    } catch (err) {
      if (err.message !== "Cancelado" && err.message !== "Exportação cancelada pelo usuário.") {
        console.error(err);
        alert("Erro na exportação: " + err.message);
      }
      this.dom.exportModal.style.display = "none";
    }
  }

  /* ========================================================================
     Eventos de Drag & Drop, Mouse e Teclado
     ======================================================================== */

  _setupDropzone() {
    const dz = this.dom.dropzone;

    ["dragenter", "dragover"].forEach((evt) => {
      window.addEventListener(evt, (e) => {
        e.preventDefault();
        dz.classList.add("drag-over");
      });
    });

    ["dragleave", "dragend"].forEach((evt) => {
      window.addEventListener(evt, (e) => {
        e.preventDefault();
        dz.classList.remove("drag-over");
      });
    });

    window.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("drag-over");
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.loadReplayFile(e.dataTransfer.files[0]);
      }
    });
  }

  _setupEventListeners() {
    // Clique para abrir seletor de arquivo no dropzone e no input
    if (this.dom.fileInput) {
      this.dom.fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.loadReplayFile(e.target.files[0]);
        }
      });
    }

    if (this.dom.dropzoneClickable) {
      this.dom.dropzoneClickable.addEventListener("click", (e) => {
        // Se já clicou no label, deixa o label acionar o input nativamente
        if (e.target.closest("label")) return;
        this.dom.fileInput.click();
      });
    }

    // Play/Pause
    this.dom.btnPlayPause.addEventListener("click", () => this.togglePlayPause());
    this.canvas.addEventListener("click", () => this.togglePlayPause());

    // Velocidade de reprodução
    document.querySelectorAll(".speed-selector .btn-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".speed-selector .btn-chip").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.engine.playbackSpeed = parseFloat(btn.dataset.speed);
      });
    });

    // Marcar Início / Fim [ I ] e [ O ]
    this.dom.btnSetIn.addEventListener("click", () => {
      this.trimStartTick = Math.min(this.engine.currentTick, this.trimEndTick - 30);
      this._updateTimelineUI();
    });

    this.dom.btnSetOut.addEventListener("click", () => {
      this.trimEndTick = Math.max(this.engine.currentTick, this.trimStartTick + 30);
      this._updateTimelineUI();
    });

    // Alternar Áudio
    this.dom.btnToggleAudio.addEventListener("click", () => {
      this.audio.muted = !this.audio.muted;
      this.dom.audioIcon.textContent = this.audio.muted ? "🔇" : "🔊";
    });

    // Seletor de Formato (WebM / MP4)
    if (this.dom.exportFormatSelect) {
      this.dom.exportFormatSelect.addEventListener("change", () => {
        this._updateExportButtonText();
      });
    }

    // Troca de partida no seletor de multi-partidas
    this.dom.matchSelect.addEventListener("change", (e) => {
      const idx = parseInt(e.target.value, 10);
      const match = this.engine.matches[idx];
      if (match) {
        this.trimStartTick = match.startTick;
        this.trimEndTick = match.endTick;
        this.engine.seek(match.startTick);
        const frame = this.engine.replay.T.sc();
        this.renderer.renderFrame(frame);
        this._updateTimelineUI();
        this._updateTimeText();
      }
    });

    // Exportar MP4
    this.dom.btnExportMp4.addEventListener("click", (e) => this.startExport({ forceMediaRecorder: e.shiftKey }));
    this.dom.btnCancelExport.addEventListener("click", () => this.recorder.cancel());

    // Interações com a Timeline (Clique e Arraste das alças)
    this.dom.timelineBar.addEventListener("mousedown", (e) => {
      if (e.target === this.dom.handleStart) {
        this.isDraggingHandle = "start";
      } else if (e.target === this.dom.handleEnd) {
        this.isDraggingHandle = "end";
      } else {
        // Clique direto na timeline para buscar (seek)
        this._handleTimelineClick(e);
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isDraggingHandle || !this.engine.durationTicks) return;

      const rect = this.dom.timelineBar.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const targetTick = Math.round((x / rect.width) * this.engine.durationTicks);

      if (this.isDraggingHandle === "start") {
        this.trimStartTick = Math.max(0, Math.min(targetTick, this.trimEndTick - 30));
      } else if (this.isDraggingHandle === "end") {
        this.trimEndTick = Math.max(this.trimStartTick + 30, Math.min(targetTick, this.engine.durationTicks));
      }

      this._updateTimelineUI();
      this._updateTimeText();
    });

    window.addEventListener("mouseup", () => {
      if (this.isDraggingHandle) {
        const target = this.isDraggingHandle === "start" ? this.trimStartTick : this.trimEndTick;
        this.engine.seek(target);
        if (this.engine.replay) {
          const frame = this.engine.replay.T.sc();
          this.renderer.renderFrame(frame);
        }
        this.isDraggingHandle = null;
      }
    });

    // Atalhos de Teclado
    window.addEventListener("keydown", (e) => {
      // Ignora se estiver digitando em campos de input
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          this.togglePlayPause();
          break;

        case "KeyI":
          e.preventDefault();
          this.trimStartTick = Math.min(this.engine.currentTick, this.trimEndTick - 30);
          this._updateTimelineUI();
          break;

        case "KeyO":
          e.preventDefault();
          this.trimEndTick = Math.max(this.engine.currentTick, this.trimStartTick + 30);
          this._updateTimelineUI();
          break;

        case "ArrowLeft":
          e.preventDefault();
          const stepBack = e.shiftKey ? 1 : 60; // 1 frame ou 1 segundo
          this.engine.seek(Math.max(0, this.engine.currentTick - stepBack));
          if (this.engine.replay) {
            this.renderer.renderFrame(this.engine.replay.T.sc());
          }
          this._updateTimelineUI();
          this._updateTimeText();
          break;

        case "ArrowRight":
          e.preventDefault();
          const stepFwd = e.shiftKey ? 1 : 60;
          this.engine.seek(Math.min(this.engine.durationTicks, this.engine.currentTick + stepFwd));
          if (this.engine.replay) {
            this.renderer.renderFrame(this.engine.replay.T.sc());
          }
          this._updateTimelineUI();
          this._updateTimeText();
          break;
      }
    });
  }

  _handleTimelineClick(e) {
    if (!this.engine.durationTicks) return;
    const rect = this.dom.timelineBar.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const targetTick = Math.round((x / rect.width) * this.engine.durationTicks);

    this.engine.seek(targetTick);
    if (this.engine.replay) {
      const frame = this.engine.replay.T.sc();
      this.renderer.renderFrame(frame);
    }
    this._updateTimelineUI();
    this._updateTimeText();
  }
}

// Inicializa a aplicação ao carregar a página
window.addEventListener("DOMContentLoaded", () => {
  new HaxTapeApp();
});
