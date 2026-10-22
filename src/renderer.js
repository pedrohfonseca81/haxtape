/**
 * HAXTAPE — Renderizador de Vídeo e HUD
 * Renderiza o campo, jogadores e bola via HaxballCore.Renderer,
 * e sobrepõe o HUD (placar Red/Blue, tempo de jogo e watermark) direto no canvas.
 */

export class VideoRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {ReplayEngine} engine
   */
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.engine = engine;
    this.coreRenderer = null;

    // Resolução base padrão (720p 60fps)
    this.width = 1280;
    this.height = 720;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    this._initCoreRenderer();
  }

  _initCoreRenderer() {
    if (!window.HaxballCore) return;

    this.coreRenderer = new window.HaxballCore.Renderer();
    this.coreRenderer.sa = this.canvas;
    this.coreRenderer.c = this.ctx;

    // Trava a resolução em 1280x720 para exportação limpa e nítida
    this.coreRenderer.Pr = () => {
      if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
        this.canvas.width = this.width;
        this.canvas.height = this.height;
      }
    };

    this.updatePatterns();
  }

  updatePatterns() {
    if (!this.coreRenderer || !window.HaxballCore.Globals) return;
    const g = window.HaxballCore.Globals;
    if (g.Ko) this.coreRenderer.Lo = this.ctx.createPattern(g.Ko, null);
    if (g.Vn) this.coreRenderer.Wn = this.ctx.createPattern(g.Vn, null);
    if (g.Tn) this.coreRenderer.Un = this.ctx.createPattern(g.Tn, null);
  }

  /**
   * Renderiza um frame completo (campo + física + HUD)
   * @param {any} frame
   */
  renderFrame(frame) {
    if (!frame) return;

    if (!this.coreRenderer) {
      this._initCoreRenderer();
    }

    // Garante que os patterns de grama estejam ativos
    if (!this.coreRenderer.Lo && window.HaxballCore.Globals.Ko) {
      this.updatePatterns();
    }

    // Renderiza o campo e jogadores pelo núcleo do HaxBall
    this.coreRenderer.Kc(frame, 0);
  }
}
