/**
 * HAXTAPE — Controlador Principal da Aplicação
 * Conecta UI, Engine, Renderizador, Áudio e Gravador MP4.
 */

import { Hbr2Parser } from "./parser.js?v=nocache_5";
import { AudioManager } from "./audio.js?v=nocache_5";
import { ReplayEngine } from "./engine.js?v=nocache_5";
import { VideoRenderer } from "./renderer.js?v=nocache_5";
import { ClipRecorder } from "./recorder.js?v=nocache_5";

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

    // Súmula: partidas cuja súmula já abriu automaticamente ao final
    this.summaryShown = new Set();
    this.summaryMatch = null;

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
      trimLengthText: document.getElementById("trim-length-text"),
      timelineBar: document.getElementById("timeline-bar"),
      timelineTrack: document.getElementById("timeline-track"),
      timelineDimLeft: document.getElementById("timeline-dim-left"),
      timelineDimRight: document.getElementById("timeline-dim-right"),
      timelineRange: document.getElementById("timeline-range"),
      timelineRangeLabel: document.getElementById("timeline-range-label"),
      timelineHover: document.getElementById("timeline-hover"),
      timelineHoverTime: document.getElementById("timeline-hover-time"),
      timelineRuler: document.getElementById("timeline-ruler"),
      handleStartTag: document.getElementById("handle-start-tag"),
      handleEndTag: document.getElementById("handle-end-tag"),
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
      btnSpeed: document.getElementById("btn-speed"),
      exportModal: document.getElementById("export-modal"),
      exportModalTitle: document.getElementById("export-modal-title"),
      exportStatusText: document.getElementById("export-status-text"),
      exportProgressFill: document.getElementById("export-progress-fill"),
      exportProgressPct: document.getElementById("export-progress-pct"),
      btnCancelExport: document.getElementById("btn-cancel-export"),
      panelScoreboard: document.getElementById("panel-scoreboard"),
      panelScoreRed: document.getElementById("panel-score-red"),
      panelScoreBlue: document.getElementById("panel-score-blue"),
      panelMatchTime: document.getElementById("panel-match-time"),
      btnSummary: document.getElementById("btn-summary"),
      summaryModal: document.getElementById("summary-modal"),
      summaryMeta: document.getElementById("summary-meta"),
      summaryScore: document.getElementById("summary-score"),
      summaryResult: document.getElementById("summary-result"),
      summaryGoals: document.getElementById("summary-goals"),
      summaryStats: document.getElementById("summary-stats"),
      summaryLineups: document.getElementById("summary-lineups"),
      summaryMvp: document.getElementById("summary-mvp"),
      btnSummaryClose: document.getElementById("btn-summary-close"),
      btnSummaryOk: document.getElementById("btn-summary-ok"),
      btnSummaryCopy: document.getElementById("btn-summary-copy"),
      btnSummaryReplay: document.getElementById("btn-summary-replay")
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

    // Cria os marcadores visuais de gol, trechos de partida e régua na timeline
    this.summaryShown.clear();
    this._closeSummary();
    this._renderTimelineMarkers(info.matches);
    this._renderTimelineRuler();

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

          // Fim de partida: pausa e mostra a súmula (uma vez por partida)
          const ended = this.engine.matches.find(
            (m) => m.endTick === this.engine.currentTick && !this.summaryShown.has(m.index)
          );
          if (ended) {
            this.summaryShown.add(ended.index);
            this.accumulatedTime = 0;
            this._setPlaying(false);
            this.openSummary(ended);
            break;
          }
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

  _setPlaying(playing) {
    this.engine.isPlaying = playing;
    this.dom.playIcon.textContent = playing ? "❚❚" : "▶";
  }

  togglePlayPause() {
    if (!this.engine.replay) return;

    this._setPlaying(!this.engine.isPlaying);

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

  _renderTimelineMarkers(matches) {
    this.dom.timelineMarkers.innerHTML = "";
    this.dom.timelineTrack.innerHTML = "";
    const total = this.engine.durationTicks;
    if (!total) return;

    for (const match of matches || []) {
      // Trecho com bola rolando destacado no fundo da barra
      const seg = document.createElement("div");
      seg.className = "match-segment";
      seg.style.left = `${(match.startTick / total) * 100}%`;
      seg.style.width = `${((match.endTick - match.startTick) / total) * 100}%`;
      this.dom.timelineTrack.appendChild(seg);

      for (const goal of match.goals) {
        const markerEl = document.createElement("div");
        markerEl.className = `goal-marker ${goal.team === "Red" ? "red" : "blue"}`;
        markerEl.style.left = `${(goal.tick / total) * 100}%`;
        const who = goal.scorer ? ` — ${goal.scorer}${goal.ownGoal ? " (contra)" : ""}` : "";
        markerEl.title = `Gol ${goal.team} aos ${formatClock(goal.gameTime)}${who}\nClique para clipar (-5s a +3s)`;

        markerEl.addEventListener("mousedown", (e) => e.stopPropagation());
        markerEl.addEventListener("click", (e) => {
          e.stopPropagation();
          this._snapClipAroundGoal(goal.tick);
        });

        this.dom.timelineMarkers.appendChild(markerEl);
      }
    }
  }

  _renderTimelineRuler() {
    const ruler = this.dom.timelineRuler;
    ruler.innerHTML = "";
    const totalSec = this.engine.durationTicks / 60;
    if (!totalSec) return;

    // Escolhe um passo que deixe ~1 rótulo a cada 90px
    const maxLabels = Math.max(2, Math.floor(ruler.clientWidth / 90));
    const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
    const step = steps.find((s) => totalSec / s <= maxLabels) || 3600;

    for (let t = 0; t < totalSec - step * 0.4; t += step) {
      const label = document.createElement("span");
      label.className = "ruler-label";
      label.style.left = `${(t / totalSec) * 100}%`;
      label.textContent = formatClock(t);
      ruler.appendChild(label);
    }
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

    const total = this.engine.durationTicks;
    const currentPct = (this.engine.currentTick / total) * 100;
    const startPct = (this.trimStartTick / total) * 100;
    const endPct = (this.trimEndTick / total) * 100;

    this.dom.timelinePlayhead.style.left = `${currentPct}%`;
    this.dom.handleStart.style.left = `${startPct}%`;
    this.dom.handleEnd.style.left = `${endPct}%`;

    this.dom.timelineRange.style.left = `${startPct}%`;
    this.dom.timelineRange.style.width = `${Math.max(0, endPct - startPct)}%`;
    this.dom.timelineDimLeft.style.width = `${startPct}%`;
    this.dom.timelineDimRight.style.width = `${Math.max(0, 100 - endPct)}%`;

    // Atualiza texto de duração do corte
    const startSec = this.trimStartTick / 60;
    const endSec = this.trimEndTick / 60;
    const durSec = (this.trimEndTick - this.trimStartTick) / 60;

    this.dom.trimDurationText.textContent = `${formatClock(startSec)} → ${formatClock(endSec)}`;
    this.dom.trimLengthText.textContent = `${durSec.toFixed(1)}s`;
    this.dom.handleStartTag.textContent = formatClock(startSec);
    this.dom.handleEndTag.textContent = formatClock(endSec);

    // Enquanto o corte cobre o replay inteiro, a faixa ensina como cortar
    const isFull = this.trimStartTick === 0 && this.trimEndTick === total;
    const label = this.dom.timelineRangeLabel;
    label.classList.toggle("is-hint", isFull);
    label.textContent = isFull
      ? "Arraste as alças amarelas para recortar o clipe"
      : `✂ ${durSec.toFixed(1)}s`;
  }

  _updateTimeText() {
    const curSec = this.engine.currentTick / 60;
    const totSec = this.engine.durationTicks / 60;

    this.dom.currentTimeText.textContent = formatClock(curSec);
    this.dom.totalTimeText.textContent = formatClock(totSec);

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

    this._setPlaying(false);

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
    this.dom.btnSpeed.addEventListener("click", () => {
      const speeds = [0.5, 1, 2];
      const next = speeds[(speeds.indexOf(this.engine.playbackSpeed) + 1) % speeds.length] ?? 1;
      this.engine.playbackSpeed = next;
      this.dom.btnSpeed.textContent = `${next}x`;
      this.dom.btnSpeed.classList.toggle("active", next !== 1);
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

    // Súmula da Partida
    this.dom.btnSummary.addEventListener("click", () => this.openSummary());
    this.dom.btnSummaryClose.addEventListener("click", () => this._closeSummary());
    this.dom.btnSummaryOk.addEventListener("click", () => this._closeSummary());
    this.dom.btnSummaryCopy.addEventListener("click", () => this._copySummary());
    this.dom.btnSummaryReplay.addEventListener("click", () => {
      const match = this.summaryMatch;
      this._closeSummary();
      if (!match) return;
      this.trimStartTick = match.startTick;
      this.trimEndTick = match.endTick;
      this._seekAndRender(match.startTick);
      this._setPlaying(true);
    });
    this.dom.summaryModal.addEventListener("click", (e) => {
      if (e.target === this.dom.summaryModal) this._closeSummary();
    });

    // Exportar MP4
    this.dom.btnExportMp4.addEventListener("click", (e) => this.startExport({ forceMediaRecorder: e.shiftKey }));
    this.dom.btnCancelExport.addEventListener("click", () => this.recorder.cancel());

    // Interações com a Timeline (Clique e Arraste das alças)
    this.dom.timelineBar.addEventListener("mousedown", (e) => {
      const handle = e.target.closest(".trim-handle");
      if (handle) {
        e.preventDefault();
        this.isDraggingHandle = handle === this.dom.handleStart ? "start" : "end";
        handle.classList.add("dragging");
        document.body.style.cursor = "ew-resize";
      } else {
        // Clique direto na timeline para buscar (seek)
        this._handleTimelineClick(e);
      }
    });

    // Prévia do tempo sob o cursor
    this.dom.timelineBar.addEventListener("mousemove", (e) => {
      if (!this.engine.durationTicks) return;
      const rect = this.dom.timelineBar.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      this.dom.timelineHover.style.left = `${x}px`;
      this.dom.timelineHoverTime.textContent = formatClock((x / rect.width) * (this.engine.durationTicks / 60));
    });

    window.addEventListener("resize", () => this._renderTimelineRuler());

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
        this.dom.handleStart.classList.remove("dragging");
        this.dom.handleEnd.classList.remove("dragging");
        document.body.style.cursor = "";
      }
    });

    // Atalhos de Teclado
    window.addEventListener("keydown", (e) => {
      // Ignora se estiver digitando em campos de input
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;

      if (this._isSummaryOpen()) {
        if (e.code === "Escape" || e.code === "KeyS") {
          e.preventDefault();
          this._closeSummary();
        }
        return;
      }

      switch (e.code) {
        case "KeyS":
          e.preventDefault();
          this.openSummary();
          break;

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

  _seekAndRender(tick) {
    this.engine.seek(tick);
    if (this.engine.replay) {
      this.renderer.renderFrame(this.engine.replay.T.sc());
    }
    this._updateTimelineUI();
    this._updateTimeText();
  }

  /* ========================================================================
     Súmula da Partida
     ======================================================================== */

  /** Partida em andamento no tick atual, ou a última encerrada antes dele */
  _matchAtCurrentTick() {
    const tick = this.engine.currentTick;
    const matches = this.engine.matches;
    return (
      matches.find((m) => tick >= m.startTick && tick <= m.endTick) ||
      [...matches].reverse().find((m) => m.endTick <= tick) ||
      matches[0]
    );
  }

  _isSummaryOpen() {
    return this.dom.summaryModal.style.display !== "none";
  }

  _closeSummary() {
    this.dom.summaryModal.style.display = "none";
  }

  openSummary(match = this._matchAtCurrentTick()) {
    if (!match) return;
    this.summaryMatch = match;
    const s = buildSummary(match);
    const multi = this.engine.matches.length > 1;

    this.dom.summaryMeta.textContent = [
      multi ? `Jogo ${match.index + 1}` : null,
      match.stadium || null,
      `⏱ ${formatClock(match.gameTime)}`,
      match.finished ? "Encerrada" : "Interrompida"
    ].filter(Boolean).join(" · ");

    const winner = s.red > s.blue ? "Red" : s.blue > s.red ? "Blue" : null;
    this.dom.summaryScore.innerHTML = `
      <div class="summary-team red ${winner === "Red" ? "winner" : ""}">RED <span class="team-dot"></span></div>
      <div class="summary-goals-big">${s.red}<span class="x">×</span>${s.blue}</div>
      <div class="summary-team blue ${winner === "Blue" ? "winner" : ""}"><span class="team-dot"></span> BLUE</div>`;
    this.dom.summaryResult.textContent = winner ? `Vitória do ${winner}` : "Empate";

    // Gols
    const goalsEl = this.dom.summaryGoals;
    goalsEl.innerHTML = "";
    if (match.goals.length === 0) {
      goalsEl.innerHTML = `<li class="summary-empty">Nenhum gol na partida.</li>`;
    }
    for (const goal of match.goals) {
      const li = document.createElement("li");
      li.className = `summary-goal ${goal.team === "Red" ? "red" : "blue"}`;
      li.innerHTML = `
        <time>${formatClock(goal.gameTime)}</time>
        <span class="goal-partial">${goal.scoreRed}-${goal.scoreBlue}</span>
        <span class="goal-who">
          <strong>${escapeHtml(goal.scorer || "Desconhecido")}</strong>${goal.ownGoal ? `<span class="goal-own">contra</span>` : ""}
          ${goal.assist ? `<small>assist. ${escapeHtml(goal.assist)}</small>` : ""}
        </span>
        <button class="btn btn-secondary goal-watch" title="Clipar este gol (-5s a +3s)">▶ Ver</button>`;
      li.querySelector("button").addEventListener("click", () => {
        this._closeSummary();
        this._snapClipAroundGoal(goal.tick);
        this._setPlaying(true);
      });
      goalsEl.appendChild(li);
    }

    // Estatísticas comparativas
    this.dom.summaryStats.innerHTML = s.stats
      .map(({ label, red, blue, suffix = "" }) => {
        const sum = red + blue;
        const redPct = sum ? (red / sum) * 100 : 50;
        return `
          <div class="stat-row">
            <div class="stat-row-head"><span>${red}${suffix}</span><span>${label}</span><span>${blue}${suffix}</span></div>
            <div class="stat-bar"><span class="red" style="width:${redPct}%"></span><span class="blue" style="width:${100 - redPct}%"></span></div>
          </div>`;
      })
      .join("");

    // Escalações
    const lineup = (team) => {
      const players = s.players.filter((p) => p.team === team);
      if (players.length === 0) return `<ul class="lineup-team ${team.toLowerCase()}"><li class="summary-empty">—</li></ul>`;
      return `<ul class="lineup-team ${team.toLowerCase()}">${players
        .map((p) => {
          const badges = [
            p.goals ? `<span title="Gols">⚽${p.goals}</span>` : "",
            p.assists ? `<span title="Assistências">🤝${p.assists}</span>` : "",
            p.ownGoals ? `<span title="Gols contra">🔻${p.ownGoals}</span>` : "",
            `<span class="dim" title="Chutes">👟${p.kicks}</span>`
          ].join("");
          return `<li class="lineup-player"><span class="lineup-name">${escapeHtml(p.name)}</span><span class="lineup-badges">${badges}</span></li>`;
        })
        .join("")}</ul>`;
    };
    this.dom.summaryLineups.innerHTML = lineup("Red") + lineup("Blue");

    this.dom.summaryMvp.innerHTML = s.mvp
      ? `⭐ Craque da partida: <strong>${escapeHtml(s.mvp.name)}</strong> <span>(${s.mvp.team})</span>`
      : "";

    this.dom.summaryModal.style.display = "flex";
  }

  async _copySummary() {
    if (!this.summaryMatch) return;
    const text = summaryToText(buildSummary(this.summaryMatch), this.summaryMatch, this.engine.matches.length > 1);
    try {
      await navigator.clipboard.writeText(text);
      this.dom.btnSummaryCopy.textContent = "✓ Copiada!";
    } catch {
      this.dom.btnSummaryCopy.textContent = "Falha ao copiar";
    }
    setTimeout(() => (this.dom.btnSummaryCopy.textContent = "📋 Copiar súmula"), 1600);
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

/* ==========================================================================
   Utilitários
   ========================================================================== */

function formatClock(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Consolida os dados da partida no formato exibido pela súmula */
function buildSummary(match) {
  const { Red, Blue } = match.stats;
  const possTotal = Red.possessionTicks + Blue.possessionTicks;
  const possRed = possTotal ? Math.round((Red.possessionTicks / possTotal) * 100) : 50;

  const players = [...match.players].sort(
    (a, b) => b.goals - a.goals || b.assists - a.assists || b.kicks - a.kicks
  );

  // Craque: gols e assistências pesam mais; passes e chutes desempatam
  const rating = (p) => p.goals * 3 + p.assists * 2 - p.ownGoals * 2 + p.passes * 0.1 + p.kicks * 0.05;
  const mvp = players.length ? players.reduce((best, p) => (rating(p) > rating(best) ? p : best)) : null;

  return {
    red: match.scoreRed,
    blue: match.scoreBlue,
    players,
    mvp: mvp && rating(mvp) > 0 ? mvp : null,
    stats: [
      { label: "Posse de bola", red: possRed, blue: 100 - possRed, suffix: "%" },
      { label: "Chutes", red: Red.kicks, blue: Blue.kicks },
      { label: "Passes", red: Red.passes, blue: Blue.passes }
    ]
  };
}

/** Versão em texto da súmula, pronta para colar no Discord/WhatsApp */
function summaryToText(s, match, multi) {
  const lines = [];
  const title = ["📋 SÚMULA", multi ? `Jogo ${match.index + 1}` : null, match.stadium || null].filter(Boolean).join(" — ");
  lines.push(title);
  lines.push(`🔴 RED ${s.red} x ${s.blue} BLUE 🔵  ·  ⏱ ${formatClock(match.gameTime)}`);
  lines.push("");
  if (match.goals.length) {
    lines.push("⚽ Gols");
    for (const g of match.goals) {
      const dot = g.team === "Red" ? "🔴" : "🔵";
      const who = (g.scorer || "Desconhecido") + (g.ownGoal ? " (contra)" : "");
      lines.push(`${formatClock(g.gameTime)} ${dot} ${who}${g.assist ? ` (assist. ${g.assist})` : ""}`);
    }
    lines.push("");
  }
  lines.push("📊 " + s.stats.map((st) => `${st.label} ${st.red}${st.suffix || ""} x ${st.blue}${st.suffix || ""}`).join(" · "));
  if (s.mvp) lines.push(`⭐ Craque: ${s.mvp.name} (${s.mvp.team})`);
  return lines.join("\n");
}

// Inicializa a aplicação ao carregar a página
window.addEventListener("DOMContentLoaded", () => {
  new HaxTapeApp();
});
