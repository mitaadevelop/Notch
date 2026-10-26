// Het menubalk-icoon, zonder bestand: een klein kalendertje als PNG met alleen doorzichtigheid (een "template image",
// zodat macOS het zelf zwart of wit maakt). Zo hoeft er geen afbeelding mee verpakt te worden.
import zlib from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// Is dit beeldpunt van het kalendertje (op een raster van 16 × 16) gevuld?
function filled(x: number, y: number) {
  const body = x >= 2 && x <= 13 && y >= 3 && y <= 14;
  const frame = body && (x === 2 || x === 13 || y === 3 || y === 14);
  const header = body && y <= 5;
  const rings = (x === 5 || x === 10) && y >= 1 && y <= 3;
  const days = body && y >= 8 && y <= 12 && x >= 4 && x <= 11 && (x - 4) % 3 !== 2 && (y - 8) % 2 === 0;
  return frame || header || rings || days;
}

/** Een PNG (RGBA) van `size` × `size` beeldpunten; 16 is het gewone formaat, 32 voor scherpe schermen. */
export function trayIconPng(size = 16): Buffer {
  const scale = size / 16;
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // filtertype 0 + beeldpunten
    for (let x = 0; x < size; x++) {
      if (filled(Math.floor(x / scale), Math.floor(y / scale))) row.writeUInt32BE(0x000000ff, 1 + x * 4); // zwart, ondoorzichtig
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bitdiepte
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
