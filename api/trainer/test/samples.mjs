/* Synthetic demo files and library bodies for the module's api tests. Built in code, like
 * upstream's api/test/media-samples.mjs (not imported: that file is upstream's test helper, and
 * the module's tests should only break when upstream's behaviour changes). Not a *.test.js file. */
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

export const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const pad = n => crypto.randomBytes(Math.max(0, n));

/** Magic bytes of a JPEG and random rest: all the media store reads of a still. */
export const jpeg = (n = 600) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad(n - 4)]);

function box(type, ...parts) {
  const body = Buffer.concat(parts.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + body.length, 0);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, body]);
}
/** A structurally valid MP4 (ftyp, moov with mvhd, mdat) of `seconds`, about `bytes` long. */
export function mp4({ seconds = 5, bytes = 2000 } = {}) {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(seconds * 1000, 16);
  const head = Buffer.concat([
    box('ftyp', Buffer.from('isom', 'latin1'), Buffer.alloc(4), Buffer.from('isommp41', 'latin1')),
    box('moov', box('mvhd', mvhd), box('trak', box('tkhd', Buffer.alloc(84))))
  ]);
  return Buffer.concat([head, box('mdat', pad(Math.max(0, bytes - head.length - 8)))]);
}

/** What receive() reads off a request: headers and a byte stream. */
export function fakeUpload(bytes, mime) {
  const req = Readable.from([bytes], { objectMode: false });
  req.headers = { 'content-type': mime, 'content-length': String(bytes.length) };
  return req;
}

/** The MediaRef the app's ingest would write for a video and its poster. */
export function videoRef(video, poster) {
  return {
    kind: 'video', hash: sha(video), mime: 'video/mp4', size: video.length, width: 640, height: 360, dur: 5, codec: 'avc1',
    poster: { hash: sha(poster), mime: 'image/jpeg', size: poster.length, width: 480, height: 270 }, at: 1_800_000_000_000
  };
}

export const exerciseBody = (over = {}) => ({
  n: 'Split squat, rear foot elevated', bp: 'upper legs', eq: 'dumbbell',
  desc: 'Front shin vertical.\nDrive through the front heel.', primaries: ['quadriceps'], secondaries: ['gluteal'], ...over
});

/** A programme body with one routine per entry of `slots` (each a list of slot objects). */
export const programmeBody = (name, ...slots) => ({
  name, unit: 'kg',
  routines: slots.map((ex, i) => ({ id: `tr_${String(i + 1).padStart(16, '0')}`, name: `Day ${i + 1}`, emoji: 'dumbbell', ex })),
  week: { 1: ['tr_0000000000000001'] }
});
