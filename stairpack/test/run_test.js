// Studio One の API を模したモックで stairpack.js を丸ごと動かすテスト
// 使い方: node test/run_test.js test/iris.json "^main \\d+$" [ミュート扱いにするトラック名,...] [--no-transfer]
const fs = require("fs");
const path = require("path");

const [,, jsonPath, pattern, mutedCsv, flag] = process.argv;
const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const re = new RegExp(pattern || "^main \\d+$");
const forceMuted = new Set((mutedCsv || "").split(",").filter(Boolean));
const noTransfer = flag === "--no-transfer";

// ---- Host モック ----
const alerts = [];
const logFiles = {};
global.Host = {
  Interfaces: { IEditTask: "IEditTask" },
  Results: { kResultOk: 0, kResultFailed: 1, kResultAborted: 2 },
  Console: { writeLine: () => {} },
  Url: (u) => ({ url: u }),
  IO: { createTextFile: (u) => { const lines = []; logFiles[u.url] = lines; return { writeLine: (l) => lines.push(l), close: () => {} }; } },
  GUI: { alert: (m) => alerts.push(m), flushUpdates: () => {} },
};

// ---- トラック/イベントのモック ----
function makeTrack(t) {
  const tr = {
    name: t.name, mediaType: t.mediaType || "Audio", isFolder: 0,
    channel: { mute: (t.muted || forceMuted.has(t.name)) ? 1 : 0 },
    layers: { count: 1 }, envelopes: { isEmpty: () => 1 },
    events: [],
    createIterator() { const arr = this.events.slice(); let i = 0; return { next: () => arr[i++] || null }; },
    isEmpty() { return this.events.length === 0 ? 1 : 0; },
  };
  tr.events = t.events.map((e) => ({ name: e.name, startTime: { seconds: e.s }, endTime: { seconds: e.e }, track: tr }));
  return tr;
}
let allTracks = data.map(makeTrack);
// テスト対象は「名前がパターンに一致するトラック」。ミュートは元ファイルのものを使わず forceMuted のみ反映
allTracks.forEach((tr, i) => { if (re.test(tr.name)) tr.channel.mute = forceMuted.has(tr.name) ? 1 : 0; });
const selected = allTracks.filter((t) => re.test(t.name));

const functions = {
  executeImmediately: 0,
  removeTrack(t) { allTracks = allTracks.filter((x) => x !== t); },
};
if (!noTransfer)
  functions.transferEvent = (ev, dest) => {
    ev.track.events = ev.track.events.filter((x) => x !== ev);
    dest.events.push(ev); ev.track = dest;
  };

const context = {
  functions,
  mainTrackList: {
    get numTracks() { return allTracks.length; },
    getTrack: (i) => allTracks[i],
    get numSelectedTracks() { return selected.length; },
    getSelectedTrack: (i) => selected[i],
  },
};

// ---- 実行 ----
const before = selected.filter((t) => !t.channel.mute).reduce((n, t) => n + t.events.length, 0);
const mutedBefore = selected.filter((t) => t.channel.mute).map((t) => t.name + ":" + t.events.length).join(",");
const { StairPackTask } = require(process.env.SP_MODULE || path.join(__dirname, "..", "package", "stairpack.js"));
const status = new StairPackTask(false).performEdit(context);

// ---- 検証 ----
const remaining = allTracks.filter((t) => selected.includes(t));
const active = remaining.filter((t) => !t.channel.mute);
const after = active.reduce((n, t) => n + t.events.length, 0);
let overlaps = 0;
for (const t of active) {
  const ev = t.events.slice().sort((a, b) => a.startTime.seconds - b.startTime.seconds);
  for (let i = 1; i < ev.length; i++) if (ev[i].startTime.seconds < ev[i - 1].endTime.seconds - 0.0005) overlaps++;
}
const mutedAfter = remaining.filter((t) => t.channel.mute).map((t) => t.name + ":" + t.events.length).join(",");

console.log("status", status);
console.log("alert:\n" + alerts.join("\n---\n"));
console.log("selected", selected.length, "-> remaining", remaining.length, "(active", active.length + ")");
console.log("events before", before, "after", after, "overlaps on same track", overlaps);
console.log("muted untouched:", mutedBefore === mutedAfter, mutedAfter);
for (const t of active)
  console.log("  " + t.name.padEnd(10), t.events.slice().sort((a, b) => a.startTime.seconds - b.startTime.seconds)
    .map((e) => `[${e.startTime.seconds.toFixed(1)}-${e.endTime.seconds.toFixed(1)}]`).join(" "));
const ok = before === after && overlaps === 0 && mutedBefore === mutedAfter;
console.log(ok ? "PASS" : "FAIL");
if (process.env.SHOWLOG) console.log(Object.values(logFiles)[0].join("\n"));
process.exit(ok ? 0 : 1);
