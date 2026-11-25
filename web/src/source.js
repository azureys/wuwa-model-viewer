// Access to the files of one imported model package (the unzipped encore.moe .zip).
// The package is served at `${base}/...` and lists its files in `${base}/index.json`.

export class PackageSource {
  // reader(path) → Blob|undefined: alternative storage (IndexedDB on iPhone/browser) instead of fetch()
  constructor(base, files, reader = null) {
    this.base = base.replace(/\/+$/, '');
    this.files = files;
    this.reader = reader;
    this.lower = new Map(files.map((f) => [f.toLowerCase(), f]));
    this.byBase = new Map();
    for (const f of files) {
      const b = f.split('/').pop().toLowerCase();
      if (!this.byBase.has(b)) this.byBase.set(b, []);
      this.byBase.get(b).push(f);
    }
  }

  static async open(base) {
    const res = await fetch(`${base.replace(/\/+$/, '')}/index.json`);
    if (!res.ok) throw new Error(`Could not read the model index (${res.status})`);
    const idx = await res.json();
    return new PackageSource(base, idx.files ?? idx);
  }

  has(path) { return this.lower.has(path.toLowerCase()); }
  resolve(path) { return this.lower.get(path.toLowerCase()) ?? null; }
  // Find a file by exact path, or by file name preferring the given folder.
  find(path, preferDir = '') {
    const exact = this.resolve(path);
    if (exact) return exact;
    const cands = this.byBase.get(path.split('/').pop().toLowerCase());
    if (!cands) return null;
    return cands.find((c) => preferDir && c.toLowerCase().startsWith(preferDir.toLowerCase())) ?? cands[0];
  }
  url(path) { return `${this.base}/${path.split('/').map(encodeURIComponent).join('/')}`; }
  async buffer(path) {
    if (this.reader) return (await this.blob(path)).arrayBuffer();
    const res = await fetch(this.url(path));
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.arrayBuffer();
  }
  async json(path) { return JSON.parse(new TextDecoder().decode(await this.buffer(path))); }
  async blob(path) {
    if (this.reader) {
      const b = await this.reader(path);
      if (!b) throw new Error(`404 ${path}`);
      return b;
    }
    const res = await fetch(this.url(path));
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.blob();
  }

  // Sort the package into the character, its extra parts, weapons and props, each with their animations.
  catalog() {
    const models = this.files.filter((f) => /\.uemodel$/i.test(f));
    const anims = this.files.filter((f) => /\.ueanim$/i.test(f));
    const dirOf = (f) => f.split('/').slice(0, -2).join('/'); // ".../<Asset>/Model/x.uemodel" → ".../<Asset>"
    const groupOf = (f) => {
      if (/\/(Weapon\/)?Prop\//i.test(f)) return 'prop'; // Weapon/Prop/Role/<X>Prop or Prop/RoleProp/<X>Prop
      if (/\/Weapon\//i.test(f)) return 'weapon';
      return 'character';
    };
    const entries = models.map((f) => ({ path: f, kind: groupOf(f), dir: dirOf(f), name: f.split('/').pop().replace(/\.uemodel$/i, '') }));
    const chars = entries.filter((e) => e.kind === 'character');
    // Character folder = the role folder holding CommonAnim etc. ("Role/FemaleMS/Katixiya")
    const roleDir = (e) => e.dir.split('/').slice(0, -1).join('/');
    const main = chars.find((e) => !/_Tail\d|Part/i.test(e.name)) ?? chars[0] ?? null;
    const parts = chars.filter((e) => e !== main && main && roleDir(e) === roleDir(main));
    const otherChars = chars.filter((e) => e !== main && !parts.includes(e));

    // One weapon per folder ("Weapon/Knuckles/R5Knuckles504"): its pieces (right/left hand, scabbard) and animations.
    const weapons = [];
    for (const e of entries.filter((x) => x.kind === 'weapon')) {
      const dir = e.dir.split('/').slice(0, -1).join('/');
      let w = weapons.find((x) => x.dir === dir);
      if (!w) weapons.push(w = { dir, name: dir.split('/').pop(), type: dir.split('/').slice(-2, -1)[0], pieces: [], anims: [] });
      w.pieces.push({ path: e.path, name: e.name });
    }
    // main piece first, then the left-hand piece / scabbard (same order as the weapon sockets)
    const minor = (p) => /_L$|scabbard/i.test(p.name);
    for (const w of weapons) w.pieces.sort((a, b) => +minor(a) - +minor(b));
    const props = entries.filter((x) => x.kind === 'prop').map((e) => ({ ...e, anims: [] }));

    const charAnims = [];
    for (const a of anims) {
      const p = props.find((x) => a.startsWith(x.dir + '/'));
      if (p) { p.anims.push(a); continue; }
      const w = weapons.find((x) => a.startsWith(x.dir + '/'));
      if (w) { w.anims.push(a); continue; }
      charAnims.push(a);
    }
    return { main, parts, otherChars, weapons, props, charAnims, roleDir: main ? roleDir(main) : '' };
  }
}
