/**
 * Minimal streaming reader for OpenStreetMap .osm.pbf files (no dependencies:
 * Node's zlib plus a small protobuf decoder). Used to cut the Chennai area out
 * of a Geofabrik regional extract when the Overpass API is too busy.
 *
 * Format: https://wiki.openstreetmap.org/wiki/PBF_Format
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { openSync, readSync, closeSync, fstatSync } from "node:fs";
import { inflateSync } from "node:zlib";

/* ---------------- protobuf primitives ---------------- */

class Reader {
  constructor(buf, start = 0, end = buf.length) {
    this.buf = buf;
    this.pos = start;
    this.end = end;
  }
  varint() {
    // Numbers up to 2^53 (OSM ids and deltas fit); avoids 32-bit bit-ops overflow.
    let result = 0;
    let mul = 1;
    for (;;) {
      const b = this.buf[this.pos++];
      result += (b & 0x7f) * mul;
      if (b < 0x80) return result;
      mul *= 128;
    }
  }
  svarint() {
    const v = this.varint();
    return v % 2 === 1 ? -(v + 1) / 2 : v / 2;
  }
  bytes() {
    const len = this.varint();
    const s = this.pos;
    this.pos += len;
    return [s, this.pos];
  }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) {
      // Read the length first: `this.pos += this.varint()` would add it to the pre-read position.
      const len = this.varint();
      this.pos += len;
    }
    else if (wire === 5) this.pos += 4;
    else throw new Error(`unsupported wire type ${wire}`);
  }
  /** Iterate fields: cb(fieldNumber, wireType). The callback must consume the value (or call skip). */
  fields(cb) {
    while (this.pos < this.end) {
      const key = this.varint();
      cb(Math.floor(key / 8), key % 8);
    }
  }
}

function packed(buf, [s, e], signed) {
  const r = new Reader(buf, s, e);
  const out = [];
  while (r.pos < r.end) out.push(signed ? r.svarint() : r.varint());
  return out;
}

const decoder = new TextDecoder();

/* ---------------- blocks ---------------- */

function* blobs(file) {
  const fd = openSync(file, "r");
  const size = fstatSync(fd).size;
  let pos = 0;
  const lenBuf = Buffer.alloc(4);
  try {
    while (pos < size) {
      readSync(fd, lenBuf, 0, 4, pos);
      const hlen = lenBuf.readUInt32BE(0);
      pos += 4;
      const hbuf = Buffer.alloc(hlen);
      readSync(fd, hbuf, 0, hlen, pos);
      pos += hlen;
      let type = "";
      let datasize = 0;
      new Reader(hbuf).fields(function (f, w) {
        if (f === 1) {
          const [s, e] = this.bytes();
          type = decoder.decode(hbuf.subarray(s, e));
        } else if (f === 3) datasize = this.varint();
        else this.skip(w);
      });
      const bbuf = Buffer.alloc(datasize);
      readSync(fd, bbuf, 0, datasize, pos);
      pos += datasize;
      let data = null;
      new Reader(bbuf).fields(function (f, w) {
        if (f === 1) {
          const [s, e] = this.bytes();
          data = bbuf.subarray(s, e);
        } else if (f === 3) {
          const [s, e] = this.bytes();
          data = inflateSync(bbuf.subarray(s, e));
        } else this.skip(w);
      });
      yield { type, data, progress: pos / size };
    }
  } finally {
    closeSync(fd);
  }
}

// Reader.fields calls cb with `this` bound to the reader for brevity.
const origFields = Reader.prototype.fields;
Reader.prototype.fields = function (cb) {
  return origFields.call(this, cb.bind(this));
};

/**
 * Stream a .osm.pbf file. Callbacks receive plain objects:
 *   node({ id, lat, lon, tags })      (tags may be empty)
 *   way({ id, tags, refs })
 *   relation({ id, tags, members: [{ type, ref, role }] })
 * Return false from `wantNodeTags`-free callbacks is not needed; filter in the callback.
 */
export function readPbf(file, { node, way, relation, onProgress }) {
  const TYPES = ["node", "way", "relation"];
  let lastReport = 0;
  for (const { type, data, progress } of blobs(file)) {
    if (onProgress && progress - lastReport > 0.02) {
      lastReport = progress;
      onProgress(progress);
    }
    if (type !== "OSMData") continue;
    const buf = data;
    const strings = [];
    const groups = [];
    let gran = 100;
    let latOff = 0;
    let lonOff = 0;
    new Reader(buf).fields(function (f, w) {
      if (f === 1) {
        const [s, e] = this.bytes();
        new Reader(buf, s, e).fields(function (g, gw) {
          if (g === 1) {
            const [a, b] = this.bytes();
            strings.push(decoder.decode(buf.subarray(a, b)));
          } else this.skip(gw);
        });
      } else if (f === 2) groups.push(this.bytes());
      else if (f === 17) gran = this.varint();
      else if (f === 19) latOff = this.varint();
      else if (f === 20) lonOff = this.varint();
      else this.skip(w);
    });
    const coord = (v, off) => (off + gran * v) * 1e-9;
    const tagsOf = (keys, vals) => {
      const t = {};
      for (let i = 0; i < keys.length; i++) t[strings[keys[i]]] = strings[vals[i]];
      return t;
    };
    for (const [gs, ge] of groups) {
      new Reader(buf, gs, ge).fields(function (f, w) {
        if (f === 2 && node) {
          // DenseNodes
          const [s, e] = this.bytes();
          let ids = [];
          let lats = [];
          let lons = [];
          let kv = [];
          new Reader(buf, s, e).fields(function (g, gw) {
            if (g === 1) ids = packed(buf, this.bytes(), true);
            else if (g === 8) lats = packed(buf, this.bytes(), true);
            else if (g === 9) lons = packed(buf, this.bytes(), true);
            else if (g === 10) kv = packed(buf, this.bytes(), false);
            else this.skip(gw);
          });
          let id = 0;
          let lat = 0;
          let lon = 0;
          let k = 0;
          for (let i = 0; i < ids.length; i++) {
            id += ids[i];
            lat += lats[i];
            lon += lons[i];
            const tags = {};
            if (kv.length) {
              while (kv[k] !== 0) {
                tags[strings[kv[k]]] = strings[kv[k + 1]];
                k += 2;
              }
              k++;
            }
            node({ id, lat: coord(lat, latOff), lon: coord(lon, lonOff), tags });
          }
        } else if (f === 1 && node) {
          const [s, e] = this.bytes();
          let id = 0;
          let lat = 0;
          let lon = 0;
          let keys = [];
          let vals = [];
          new Reader(buf, s, e).fields(function (g, gw) {
            if (g === 1) id = this.svarint();
            else if (g === 2) keys = packed(buf, this.bytes(), false);
            else if (g === 3) vals = packed(buf, this.bytes(), false);
            else if (g === 8) lat = this.svarint();
            else if (g === 9) lon = this.svarint();
            else this.skip(gw);
          });
          node({ id, lat: coord(lat, latOff), lon: coord(lon, lonOff), tags: tagsOf(keys, vals) });
        } else if (f === 3 && way) {
          const [s, e] = this.bytes();
          let id = 0;
          let keys = [];
          let vals = [];
          let refs = [];
          new Reader(buf, s, e).fields(function (g, gw) {
            if (g === 1) id = this.varint();
            else if (g === 2) keys = packed(buf, this.bytes(), false);
            else if (g === 3) vals = packed(buf, this.bytes(), false);
            else if (g === 8) refs = packed(buf, this.bytes(), true);
            else this.skip(gw);
          });
          for (let i = 1; i < refs.length; i++) refs[i] += refs[i - 1];
          way({ id, tags: tagsOf(keys, vals), refs });
        } else if (f === 4 && relation) {
          const [s, e] = this.bytes();
          let id = 0;
          let keys = [];
          let vals = [];
          let roles = [];
          let memids = [];
          let types = [];
          new Reader(buf, s, e).fields(function (g, gw) {
            if (g === 1) id = this.varint();
            else if (g === 2) keys = packed(buf, this.bytes(), false);
            else if (g === 3) vals = packed(buf, this.bytes(), false);
            else if (g === 8) roles = packed(buf, this.bytes(), false);
            else if (g === 9) memids = packed(buf, this.bytes(), true);
            else if (g === 10) types = packed(buf, this.bytes(), false);
            else this.skip(gw);
          });
          let ref = 0;
          const members = memids.map((m, i) => {
            ref += m;
            return { type: TYPES[types[i]], ref, role: strings[roles[i]] };
          });
          relation({ id, tags: tagsOf(keys, vals), members });
        } else this.skip(w);
      });
    }
  }
}
