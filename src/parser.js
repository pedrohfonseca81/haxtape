/**
 * HAXTAPE — Parser de Replay HaxBall (.hbr2)
 * Lê cabeçalho, descomprime o stream e extrai os marcadores de eventos (gols).
 */

export class Hbr2Parser {
  /**
   * Lê e valida um ArrayBuffer de arquivo .hbr2
   * @param {ArrayBuffer} buffer
   * @returns {Promise<{
   *   header: { magic: string, version: number, durationTicks: number, durationSec: number },
   *   markers: Array<{ tick: number, timeSec: number, kind: number }>,
   *   decompressed: Uint8Array,
   *   rawBytes: Uint8Array
   * }>}
   */
  static async parse(buffer) {
    const rawBytes = new Uint8Array(buffer);
    if (rawBytes.byteLength < 12) {
      throw new Error("Arquivo muito curto para ser um replay do HaxBall (.hbr2).");
    }

    const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, 12);
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== "HBR2") {
      throw new Error(`Assinatura inválida: esperado 'HBR2', encontrado '${magic}'.`);
    }

    const version = view.getUint32(4, false);
    const durationTicks = view.getUint32(8, false);
    const durationSec = durationTicks / 60;

    const compressedPayload = rawBytes.subarray(12);
    let decompressed;

    // Tenta descompressão via API nativa DecompressionStream
    if (typeof DecompressionStream !== "undefined") {
      try {
        const ds = new DecompressionStream("deflate-raw");
        const writer = ds.writable.getWriter();
        writer.write(compressedPayload);
        writer.close();

        const chunks = [];
        const reader = ds.readable.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
        decompressed = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) {
          decompressed.set(c, offset);
          offset += c.length;
        }
      } catch (e) {
        // Fallback para pako se DecompressionStream falhar
        if (window.pako && window.pako.inflateRaw) {
          decompressed = window.pako.inflateRaw(compressedPayload);
        } else {
          throw e;
        }
      }
    } else if (window.pako && window.pako.inflateRaw) {
      decompressed = window.pako.inflateRaw(compressedPayload);
    } else {
      throw new Error("Nenhum descompressor Deflate suportado encontrado.");
    }

    // Leitura dos marcadores no início do stream descomprimido
    const dView = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
    let pos = 0;

    const markerCount = dView.getUint16(pos, false);
    pos += 2;

    const markers = [];
    let currentTick = 0;

    for (let i = 0; i < markerCount; i++) {
      // Leitura de VarInt
      let d = 0;
      for (let b = 0; b < 5; b++) {
        const c = dView.getUint8(pos++);
        d |= (c & 127) << (7 * b);
        if ((c & 128) === 0) break;
      }
      currentTick += (d | 0);
      const kind = dView.getUint8(pos++);
      markers.push({
        tick: currentTick,
        timeSec: currentTick / 60,
        kind
      });
    }

    return {
      header: {
        magic,
        version,
        durationTicks,
        durationSec
      },
      markers,
      decompressed,
      rawBytes
    };
  }
}
