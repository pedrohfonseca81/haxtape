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
        self.onGoal(team && team.$ === 1 ? "Red" : "Blue", self.currentTick);
      }
      if (oldNi) oldNi.apply(this, arguments);
    };
  }

  /**
   * Pre-indexa o replay inteiro em memória para mapear todos os eventos e partidas,
   * coletando as estatísticas da súmula (autores dos gols, assistências, posse, chutes, passes).
   */
  _preIndexReplay() {
    const sim = new this.core.Replay(this.rawBytes, new this.core.Settings(), 3);
    const totalTicks = sim.mf;

    let currentMatch = null;
    let matchIdx = 0;
    // Cadeia de toques na bola: último jogador a tocar e o anterior (para assistência)
    let lastTouch = null;
    let prevTouch = null;

    const teamName = (team) => (team && team.$ === 1 ? "Red" : team && team.$ === 2 ? "Blue" : null);

    const playerStats = (p) => {
      let st = currentMatch.players.get(p.V);
      if (!st) {
        st = { id: p.V, name: p.w || "Player", team: null, goals: 0, assists: 0, ownGoals: 0, kicks: 0, touches: 0, passes: 0 };
        currentMatch.players.set(p.V, st);
      }
      st.team = teamName(p.ea) || st.team;
      return st;
    };

    const registerTouch = (p) => {
      const team = teamName(p.ea);
      if (!team) return;
      const st = playerStats(p);
      if (lastTouch && lastTouch.id === p.V) return;
      st.touches++;
      if (lastTouch && lastTouch.team === team) {
        currentMatch.players.get(lastTouch.id).passes++;
        currentMatch.stats[team].passes++;
      }
      prevTouch = lastTouch;
      lastTouch = { id: p.V, name: st.name, team };
    };

    sim.T.ji = (p) => {
      this.soundEvents.push({ tick: sim.Y, type: "kick" });
      if (!currentMatch || !p) return;
      const team = teamName(p.ea);
      if (!team) return;
      playerStats(p).kicks++;
      currentMatch.stats[team].kicks++;
      registerTouch(p);
    };

    sim.T.Ni = (team) => {
      this.soundEvents.push({ tick: sim.Y, type: "goal" });
      if (!currentMatch) return;
      const scoringTeam = teamName(team) || "Red";
      const game = sim.T.K;
      const goal = {
        tick: sim.Y,
        timeSec: sim.Y / 60,
        gameTime: game ? game.Hc : 0,
        team: scoringTeam,
        scorer: null,
        ownGoal: false,
        assist: null,
        scoreRed: game ? game.Pb : 0,
        scoreBlue: game ? game.Kb : 0
      };
      if (lastTouch) {
        goal.scorer = lastTouch.name;
        goal.ownGoal = lastTouch.team !== scoringTeam;
        const st = currentMatch.players.get(lastTouch.id);
        if (goal.ownGoal) {
          st.ownGoals++;
        } else {
          st.goals++;
          if (prevTouch && prevTouch.team === scoringTeam && prevTouch.id !== lastTouch.id) {
            goal.assist = prevTouch.name;
            currentMatch.players.get(prevTouch.id).assists++;
          }
        }
      }
      currentMatch.goals.push(goal);
      lastTouch = prevTouch = null;
    };

    for (let t = 0; t < totalTicks; t++) {
      while (sim.gg != null && sim.hg == sim.Y) {
        sim.gg.apply(sim.T);
        sim.Dl();
      }

      const game = sim.T.K;

      if (game && !currentMatch) {
        currentMatch = this._createMatch(matchIdx++, sim.Y, totalTicks);
        currentMatch.stadium = game.S ? game.S.w : "";
        this.matches.push(currentMatch);
        lastTouch = prevTouch = null;
      } else if (!game && currentMatch) {
        currentMatch.endTick = sim.Y;
        currentMatch = null;
      }

      if (currentMatch && game) {
        currentMatch.scoreRed = game.Pb;
        currentMatch.scoreBlue = game.Kb;
        currentMatch.gameTime = game.Hc;
        if (game.Bb === 3) currentMatch.finished = true;
        if (game.Bb === 0) lastTouch = prevTouch = null;

        // Toques por contato físico com a bola (kickoff e bola rolando)
        const ball = game.ta && game.ta.F ? game.ta.F[0] : null;
        if (ball && game.Bb <= 1) {
          for (const p of sim.T.I || []) {
            if (!p.H) continue;
            const team = teamName(p.ea);
            if (!team) continue;
            playerStats(p);
            const dx = p.H.a.x - ball.a.x;
            const dy = p.H.a.y - ball.a.y;
            const reach = p.H.Z + ball.Z + 0.1;
            if (dx * dx + dy * dy <= reach * reach) registerTouch(p);
          }
        }

        if (game.Bb === 1 && lastTouch) {
          currentMatch.stats[lastTouch.team].possessionTicks++;
        }
      }

      sim.Y++;
      sim.T.C(1);
    }

    if (this.matches.length === 0) {
      this.matches.push(this._createMatch(0, 0, totalTicks));
    }

    // Converte o mapa de jogadores em lista simples para a UI
    for (const m of this.matches) {
      m.players = [...m.players.values()].filter((p) => p.team);
    }
  }

  _createMatch(index, startTick, endTick) {
    return {
      index,
      startTick,
      endTick,
      stadium: "",
      scoreRed: 0,
      scoreBlue: 0,
      gameTime: 0,
      finished: false,
      goals: [],
      players: new Map(),
      stats: {
        Red: { kicks: 0, passes: 0, possessionTicks: 0 },
        Blue: { kicks: 0, passes: 0, possessionTicks: 0 }
      }
    };
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
