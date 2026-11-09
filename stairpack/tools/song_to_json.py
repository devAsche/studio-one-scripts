"""Studio One .song -> JSON (トラック・イベント一覧, 秒単位). テスト用/オフライン確認用."""
import sys, json, zipfile, os
sys.path.insert(0, os.path.dirname(__file__))
from s1song import load_xml, xid

def beats_to_sec_factory(root):
    segs = sorted(((float(s.get('start') or 0), float(s.get('tempo'))) for s in root.iter('TempoMapSegment')))
    def conv(b):
        # tempo = seconds per beat, segments start in beats (定テンポ曲を想定しつつ区分線形で処理)
        t = 0.0
        for i, (st, spb) in enumerate(segs):
            en = segs[i + 1][0] if i + 1 < len(segs) else float('inf')
            if b <= st: break
            t += (min(b, en) - st) * spb
        return t
    return conv

def song_to_tracks(path):
    root = load_xml(zipfile.ZipFile(path).read('Song/song.xml'))
    conv = beats_to_sec_factory(root)
    tracks = [t for t in root.iter('List') if xid(t) == 'Tracks'][0]
    out = []
    for order, t in enumerate(tracks):
        if t.tag != 'MediaTrack':
            continue
        evs = []
        for lst in t:
            if lst.tag == 'List' and xid(lst) == 'Events':
                for e in lst:
                    st = float(e.get('start') or 0); ln = float(e.get('length') or 0)
                    if e.get('timeFormat') == '2':
                        s, en = conv(st), conv(st + ln)
                    else:
                        s, en = st, st + ln
                    evs.append({'s': s, 'e': en, 'name': e.get('name'), 'muted': e.get('mute') == '1'})
        out.append({'order': order, 'name': t.get('name'), 'muted': t.get('mute') == '1',
                    'mediaType': t.get('mediaType'), 'events': evs})
    return out

if __name__ == '__main__':
    json.dump(song_to_tracks(sys.argv[1]), open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
