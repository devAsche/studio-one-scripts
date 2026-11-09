"""package/ から dist/StairPack.package (ZIP) を作る。JSの非ASCII文字は \\uXXXX にエスケープする。"""
import os, zipfile, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'package'); DIST = os.path.join(ROOT, 'dist')
os.makedirs(DIST, exist_ok=True)
def esc(s):
    out = []
    for c in s:
        if ord(c) < 128:
            out.append(c)
        else:
            b = c.encode('utf-16-be')
            out.extend('\\u%02x%02x' % (b[i], b[i + 1]) for i in range(0, len(b), 2))
    return ''.join(out)
out = os.path.join(DIST, 'StairPack.package')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in ('metainfo.xml', 'classfactory.xml', 'stairpack.js'):
        data = open(os.path.join(SRC, name), encoding='utf-8').read()
        if name.endswith('.js'):
            data = esc(data)
        z.writestr(name, data.encode('utf-8'))
print(out, os.path.getsize(out))
