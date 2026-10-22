# HAXTAPE — HaxBall Replay Clipper ⚽📼

> Cortador e exportador de replays do HaxBall (`.hbr2`) para vídeo a 60 FPS direto no navegador. 100% estático, sem backend e com renderização via WebCodecs.

🔗 **Acesse online:** [https://pedrohfonseca81.github.io/haxtape/](https://pedrohfonseca81.github.io/haxtape/)

---

## 🎯 Destaques do Projeto

- **100% Client-Side & Sem Build:** Desenvolvido em Vanilla JS puro com ES Modules nativos. Não precisa de `npm install`, webpack, vite ou qualquer infraestrutura de backend. Seus replays nunca saem da sua máquina.
- **Simulação Determinística Oficial:** Executa a engine física do HaxBall frame a frame a 60 FPS, garantindo zero desync, colisões fiéis, curvas e física de chute idêntica à do jogo.
- **Linha do Tempo e Corte Preciso:**
  - Alças interativas de início `[ Início` e fim `Fim ]`.
  - Atalhos de teclado no estilo de editores profissionais (<kbd>I</kbd> para entrada e <kbd>O</kbd> para saída).
  - Marcadores de gol automáticos na timeline com salto direto para o lance (-5s antes até +3s após o gol).
- **Exportação Ultrarrápida (WebCodecs):**
  - **WebM (Padrão):** Codec VP9 / VP8 a 60 FPS + áudio Opus via `webm-muxer`, renderizado em ~1 a 2 segundos com máxima compatibilidade e sem travamentos.
  - **MP4:** Codec H.264 AVC + áudio AAC via `mp4-muxer` com fallback inteligente para `MediaRecorder`.
- **Áudio do Jogo Sincronizado:** Efeitos sonoros reais (chute, trave, apito de gol) renderizados via Web Audio API diretamente dentro da faixa de áudio do arquivo de vídeo.
- **Placar Integrado no Painel:** O placar da partida (Red x Blue) e o tempo de jogo são exibidos em tempo real na barra de ferramentas inferior, mantendo o campo e os jogadores totalmente limpos e desobstruídos no vídeo gravado.
- **Detecção de Multi-Partidas:** Identifica automaticamente quando um único `.hbr2` contém mais de um jogo consecutivo, permitindo alternar de partida instantaneamente.

---

## ⌨️ Atalhos de Teclado

| Tecla | Ação |
| :--- | :--- |
| <kbd>Espaço</kbd> | Reproduzir / Pausar |
| <kbd>I</kbd> | Marcar **Início** do corte na posição atual |
| <kbd>O</kbd> | Marcar **Fim** do corte na posição atual |
| <kbd>&larr;</kbd> / <kbd>&rarr;</kbd> | Recuar / Avançar 1 segundo |
| <kbd>Shift</kbd> + <kbd>&larr;</kbd> / <kbd>&rarr;</kbd> | Recuar / Avançar 1 frame (ajuste fino) |

---

## 🚀 Como Executar Localmente

Por ser um projeto web puramente estático, basta servir o diretório em qualquer servidor HTTP:

### Opção 1: Python
```bash
python3 server.py
# ou: python3 -m http.server 8080
```
Abra no navegador em: `http://localhost:8080`

### Opção 2: Node.js
```bash
npx serve .
```

---

## 📁 Estrutura do Repositório

```text
/
├── index.html              # Interface do usuário (Canvas, Dropzone, Timeline e Controles)
├── style.css               # Tema dark moderno ajustado para 100vh sem rolagem
├── server.py               # Servidor local Python com cabeçalhos de zero-cache
├── README.md               # Documentação completa em português
├── assets/
│   ├── audio/              # Efeitos sonoros originais do HaxBall (.wav)
│   ├── images/             # Texturas de campo (grass, concrete)
│   └── samples/            # Replays reais para testes (.hbr2)
└── src/
    ├── vendor/
    │   ├── pako.min.js     # Descompressor Deflate rápido
    │   ├── webm-muxer.js   # Muxer WebM nativo (VP9/VP8 + Opus)
    │   └── mp4-muxer.js    # Muxer MP4 nativo (H.264 + AAC)
    ├── haxball-core.js     # Motor determinístico e renderizador original do HaxBall
    ├── parser.js           # Parser do container .hbr2 e extração de metadados
    ├── audio.js            # Gerenciador Web Audio (ao vivo e renderização offline)
    ├── engine.js           # Orquestrador da simulação física e seek temporal
    ├── renderer.js         # Renderizador do campo e jogadores a 60 FPS
    ├── recorder.js         # Gravação e codificação via WebCodecs (WebM / MP4)
    └── app.js              # Controlador principal da aplicação e eventos de UI
```

---

## 🛠️ Tecnologias Utilizadas

- **HTML5 Canvas API** (Renderização gráfica de alta performance a 60 FPS)
- **WebCodecs API** (`VideoEncoder`, `AudioEncoder`, `VideoFrame`)
- **Web Audio API** (`AudioContext`, `OfflineAudioContext`)
- **Vanilla JavaScript (ES Modules)**
- **Pako** (Descompressão Deflate rápida)
- **webm-muxer** & **mp4-muxer**

---

## 📄 Créditos e Licença

- O motor de simulação e lógica física pertencem ao jogo original **HaxBall** criado por Mario Carbajal (basro).
- Este projeto é open-source sob a licença MIT.
