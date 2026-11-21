/**
 * A minimal ZIP writer — PURE, dependency-free. — client meeting 2026-11-16 (admin export of rep photos)
 *
 * Entries are STORED (method 0, no compression): the payload is JPEG/PNG photos, which are already
 * compressed, so deflating them would cost CPU for nothing. Plain PKZIP 2.0 (no ZIP64), which every OS
 * unzipper reads; fine for a roster of photos (well under 4 GB / 65 535 entries). File names are UTF-8
 * (general-purpose flag bit 11). Timestamps are fixed by the caller's `date`, so the output is deterministic.
 */

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Standard CRC-32 (IEEE 802.3), as ZIP requires. */
export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time fields from a date's calendar parts (ZIP has no timezone; the caller picks the clock). */
function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.max(date.getUTCFullYear(), 1980);
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

/** Build a ZIP archive holding `entries`, in order. */
export function buildZip(entries: ZipEntry[], date: Date): Buffer {
  const { time, day } = dosDateTime(date);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed (2.0)
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    // extra, comment, disk start, internal attrs, external attrs: all 0
    central.writeUInt32LE(offset, 42); // offset of the local header
    centrals.push(central, name);

    offset += local.length + name.length + size;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // entries total
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16); // central directory offset
  return Buffer.concat([...locals, centralDir, end]);
}
