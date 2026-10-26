/*
 * A minimal MP4 writer for one video track, so the browser can wrap what WebCodecs encodes into a file
 * the AI service can open. No audio, no B-frames (every sample's decode time is its display time).
 * Layout: ftyp, moov, mdat (the index comes first, so the file can be read as a stream).
 */

export interface Mp4Sample { data: Uint8Array; timestampUs: number; key: boolean }
export interface Mp4Track {
  codec: 'avc' | 'vp9';
  width: number;
  height: number;
  /** H.264: the avcC record WebCodecs gives as `decoderConfig.description` */
  description?: Uint8Array;
  samples: Mp4Sample[];
}

const TIMESCALE = 1000;
const enc = new TextEncoder();

const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => Array.from(enc.encode(s));
const zeros = (n: number) => new Array<number>(n).fill(0);

function box(type: string, ...parts: (number[] | Uint8Array)[]): Uint8Array {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  out.set(u32(size), 0);
  out.set(ascii(type), 4);
  let at = 8;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const full = (version: number, flags: number) => [version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255];

const MATRIX = [...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];

export function muxMp4(t: Mp4Track): Uint8Array {
  const n = t.samples.length;
  if (!n) throw new Error('No frames to write');
  if (t.codec === 'avc' && !t.description?.length) throw new Error('H.264 needs its decoder configuration');

  // Times in milliseconds; each sample lasts until the next one, the last as long as the one before it.
  const dts = t.samples.map((s) => Math.round(s.timestampUs / 1000));
  const deltas = dts.map((d, i) => (i < n - 1 ? Math.max(1, dts[i + 1] - d) : 0));
  deltas[n - 1] = n > 1 ? deltas[n - 2] : 500;
  const duration = deltas.reduce((a, b) => a + b, 0);

  // Run-length time-to-sample table
  const runs: [number, number][] = [];
  for (const d of deltas) { const last = runs[runs.length - 1]; if (last && last[1] === d) last[0]++; else runs.push([1, d]); }

  const entryName = t.codec === 'avc' ? 'avc1' : 'vp09';
  const configBox = t.codec === 'avc'
    ? box('avcC', t.description!)
    // VP9 level 3.1, 8-bit 4:2:0, BT.709, limited range
    : box('vpcC', full(1, 0), [0, 31, (8 << 4) | (1 << 1) | 0, 1, 1, 1], u16(0));
  const sampleEntry = box(entryName,
    zeros(6), u16(1), u16(0), u16(0), zeros(12), u16(t.width), u16(t.height),
    u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x0018), u16(0xffff), configBox);

  const syncs = t.samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
  const stbl = (chunkOffset: number) => box('stbl',
    box('stsd', full(0, 0), u32(1), sampleEntry),
    box('stts', full(0, 0), u32(runs.length), runs.flatMap(([c, d]) => [...u32(c), ...u32(d)])),
    box('stss', full(0, 0), u32(syncs.length), syncs.flatMap((i) => u32(i))),
    box('stsc', full(0, 0), u32(1), u32(1), u32(n), u32(1)),
    box('stsz', full(0, 0), u32(0), u32(n), t.samples.flatMap((s) => u32(s.data.length))),
    box('stco', full(0, 0), u32(1), u32(chunkOffset)));

  const build = (chunkOffset: number) => box('moov',
    box('mvhd', full(0, 0), u32(0), u32(0), u32(TIMESCALE), u32(duration), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2)),
    box('trak',
      box('tkhd', full(0, 3), u32(0), u32(0), u32(1), u32(0), u32(duration), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(t.width << 16), u32(t.height << 16)),
      box('mdia',
        box('mdhd', full(0, 0), u32(0), u32(0), u32(TIMESCALE), u32(duration), u16(0x55c4), u16(0)),
        box('hdlr', full(0, 0), u32(0), ascii('vide'), zeros(12), [...ascii('VideoHandler'), 0]),
        box('minf',
          box('vmhd', full(0, 1), u16(0), u16(0), u16(0), u16(0)),
          box('dinf', box('dref', full(0, 0), u32(1), box('url ', full(0, 1)))),
          stbl(chunkOffset)))));

  const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isom'), ascii('iso2'), ascii(t.codec === 'avc' ? 'avc1' : 'vp09'), ascii('mp41'));
  const moovSize = build(0).length; // the offset's value doesn't change the size
  const mdatStart = ftyp.length + moovSize + 8;
  const moov = build(mdatStart);
  const payload = t.samples.reduce((a, s) => a + s.data.length, 0);
  const out = new Uint8Array(ftyp.length + moov.length + 8 + payload);
  let at = 0;
  out.set(ftyp, at); at += ftyp.length;
  out.set(moov, at); at += moov.length;
  out.set(u32(8 + payload), at); out.set(ascii('mdat'), at + 4); at += 8;
  for (const s of t.samples) { out.set(s.data, at); at += s.data.length; }
  return out;
}
