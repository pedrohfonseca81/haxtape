/**
 * HAXTAPE — Motor de Simulação e Replay
 * Orquestra o núcleo do HaxBall, rastreia eventos de gol/chute e gerencia busca rápida.
 */

export class ReplayEngine {
  constructor(audioManager) {
    this.audio = audioManager;
    this.core = window.HaxballCore;
    this.replay = null;
    this.rawBytes = null;
    this.durationTicks = 0;
    this.currentTick = 0;
    this.playbackSpeed = 1.0;
    this.isPlaying = false;
    this.isSeeking = false;
    this.soundEvents = []; // Todos os eventos de som ao longo da partida { tick, type }
    this.matches = []; // Partidas detectadas no replay
    this.currentMatchIndex = 0;
    this.texturesLoaded = false;
    this.onTick = null;
    this.onGoal = null;
  }

  /**
   * Pré-carrega as texturas do campo (grama, concreto)
   */
  async loadAssets() {
    if (this.texturesLoaded) return;

    const loadImage = (src) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });
    };

    const [grass, concrete, concrete2, typing] = await Promise.all([
      loadImage("assets/images/grass.png"),
      loadImage("assets/images/concrete.png"),
      loadImage("assets/images/concrete2.png"),
      loadImage("assets/images/typing.png")
    ]);

    if (this.core && this.core.Globals) {
      if (grass) this.core.Globals.Ko = grass;
      if (concrete) this.core.Globals.Vn = concrete;
      if (concrete2) this.core.Globals.Tn = concrete2;
      if (typing) this.core.Globals.Dm = typing;
    }

    this.texturesLoaded = true;
  }

  /**
   * Carrega um replay a partir de um Uint8Array
   * @param {Uint8Array} rawBytes
   */
  async loadReplay(rawBytes) {
    await this.loadAssets();

    this.rawBytes = rawBytes;
    this.replay = new this.core.Replay(rawBytes, new this.core.Settings(), 3);
    this.durationTicks = this.replay.mf;
    this.currentTick = 0;
    this.soundEvents = [];
    this.matches = [];

    // Pre-simula o arquivo inteiro para indexar chutes, gols e partidas
    this._preIndexReplay();

    // Reinicia o replay para o tick 0
    this.replay.ui();
    this.currentTick = 0;

    // Configura ganchos de som para reprodução ao vivo
    this._setupSoundHooks();

    return {
      durationTicks: this.durationTicks,
      durationSec: this.durationTicks / 60,
      markers: this.replay.Vk.map((m) => ({
        tick: Math.round(m.mj * this.durationTicks),
        timeSec: (m.mj * this.durationTicks) / 60,
        kind: m.kind
      })),
      matches: this.matches
    };
  }

  _setupSoundHooks() {
    if (!this.replay || !this.replay.T) return;

    const self = this;
    const oldJi = this.replay.T.ji;
    const oldNi = this.replay.T.Ni;

    this.replay.T.ji = function (player) {
      if (self.isPlaying && !self.isSeeking && self.audio) {
        self.audio.playKick();
      }
      if (oldJi) oldJi.apply(this, arguments);
    };

    this.replay.T.Ni = function (team) {
      if (self.isPlaying && !self.isSeeking && self.audio) {
        self.audio.playGoal();
      }
      if (self.onGoal) {
        self.onGoal(team, self.currentTick);
      }
      if (oldNi) oldNi.apply(this, arguments);
    };
  }

  /**
   * Pre-indexa o replay inteiro em memória para mapear todos os eventos e partidas
   */
  _preIndexReplay() {
    const sim = new this.core.Replay(this.rawBytes, new this.core.Settings(), 3);
    const totalTicks = sim.mf;

    let currentMatch = null;
    let matchIdx = 0;

    sim.T.ji = () => {
      this.soundEvents.push({ tick: sim.Y, type: "kick" });
    };

    sim.T.Ni = (team) => {
      this.soundEvents.push({ tick: sim.Y, type: "goal" });
      if (currentMatch) {
        currentMatch.goals.push({
          tick: sim.Y,
          timeSec: sim.Y / 60,
          team: team === 1 ? "Red" : "Blue"
        });
      }
    };

    for (let t = 0; t < totalTicks; t++) {
      while (sim.gg != null && sim.hg == sim.Y) {
        sim.gg.apply(sim.T);
        sim.Dl();
      }

      if (sim.T.K && !currentMatch) {
        currentMatch = {
          index: matchIdx++,
          startTick: sim.Y,
          endTick: totalTicks,
          scoreRed: 0,
          scoreBlue: 0,
          goals: []
        };
        this.matches.push(currentMatch);
      } else if (!sim.T.K && currentMatch) {
        currentMatch.endTick = sim.Y;
        currentMatch = null;
      }

      if (currentMatch && sim.T.K) {
        currentMatch.scoreRed = sim.T.K.Pb;
        currentMatch.scoreBlue = sim.T.K.Kb;
      }

      sim.Y++;
      sim.T.C(1);
    }

    if (this.matches.length === 0) {
      this.matches.push({
        index: 0,
        startTick: 0,
        endTick: totalTicks,
        scoreRed: 0,
        scoreBlue: 0,
        goals: []
      });
    }
  }

  /**
   * Salto instantâneo para um tick específico
   * @param {number} targetTick
   */
  seek(targetTick) {
    if (!this.replay) return;
    targetTick = Math.max(0, Math.min(this.durationTicks, Math.round(targetTick)));

    this.isSeeking = true;
    if (targetTick < this.replay.Y) {
      this.replay.ui();
      this._setupSoundHooks();
    }

    while (this.replay.Y < targetTick) {
      while (this.replay.gg != null && this.replay.hg == this.replay.Y) {
        this.replay.gg.apply(this.replay.T);
        this.replay.Dl();
      }
      this.replay.Y++;
      this.replay.T.C(1);
    }

    this.currentTick = this.replay.Y;
    this.isSeeking = false;

    if (this.core && this.core.nextFrame) {
      this.core.nextFrame();
    }

    if (this.onTick) {
      this.onTick(this.currentTick);
    }
  }

  /**
   * Executa um passo da simulação
   * @returns {any} Objeto de renderização do frame (Sf)
   */
  step() {
    if (!this.replay || this.currentTick >= this.durationTicks) {
      this.isPlaying = false;
      return null;
    }

    while (this.replay.gg != null && this.replay.hg == this.replay.Y) {
      this.replay.gg.apply(this.replay.T);
      this.replay.Dl();
    }

    this.replay.Y++;
    this.replay.T.C(1);
    this.currentTick = this.replay.Y;

    if (this.core && this.core.nextFrame) {
      this.core.nextFrame();
    }

    if (this.onTick) {
      this.onTick(this.currentTick);
    }

    return this.replay.T.sc();
  }

  /**
   * Retorna os dados essenciais do estado atual do jogo
   */
  getState() {
    if (!this.replay || !this.replay.T) {
      return {
        tick: 0,
        durationTicks: this.durationTicks,
        redScore: 0,
        blueScore: 0,
        matchTime: 0,
        players: [],
        hasMatch: false
      };
    }

    const room = this.replay.T;
    const match = room.K;

    const players = (room.I || []).map((p) => ({
      id: p.V,
      name: p.w || "Player",
      team: p.$ ? p.$.$ : 0, // 0: Spec, 1: Red, 2: Blue
      avatar: p.Ch || ""
    }));

    return {
      tick: this.currentTick,
      durationTicks: this.durationTicks,
      redScore: match ? match.Pb : 0,
      blueScore: match ? match.Kb : 0,
      matchTime: match && typeof match.Hc === "number" ? Math.floor(match.Hc) : Math.floor(this.currentTick / 60),
      players,
      hasMatch: !!match,
      stadium: match ? match.S : null
    };
  }
}
