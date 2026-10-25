#!/usr/bin/env python3
"""Shrink a GLB's textures: every image is scaled down to at most MAX pixels on a side and
re-encoded as JPEG (ffmpeg does the work), and the binary chunk is rebuilt around them.
Geometry is untouched. Usage: shrink-glb.py in.glb out.glb [max=1024] [quality=4 (2 best … 31)]"""
import json, struct, subprocess, sys

def main():
    src, dst = sys.argv[1], sys.argv[2]
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
    q = sys.argv[4] if len(sys.argv) > 4 else '4'
    data = open(src, 'rb').read()
    jlen = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20 + jlen])
    boff = 20 + jlen
    blen = struct.unpack('<I', data[boff:boff + 4])[0]
    binc = data[boff + 8:boff + 8 + blen]
    views = gltf['bufferViews']
    replace = {}
    for img in gltf.get('images', []):
        v = views[img['bufferView']]
        raw = binc[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        out = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', 'pipe:0', '-vf',
                              f"scale='min({size},iw)':'min({size},ih)':force_original_aspect_ratio=decrease",
                              '-q:v', q, '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'],
                             input=raw, capture_output=True, check=True).stdout
        replace[img['bufferView']] = out
        img['mimeType'] = 'image/jpeg'
    new = bytearray()
    for i, v in enumerate(views):
        chunk = replace.get(i) or binc[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        while len(new) % 4: new.append(0)
        v['byteOffset'] = len(new)
        v['byteLength'] = len(chunk)
        new += chunk
    while len(new) % 4: new.append(0)
    gltf['buffers'][0]['byteLength'] = len(new)
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(new)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(new), 0x004E4942)); f.write(new)
    print(f'{src}: {len(data) // 1024} KB -> {total // 1024} KB')

main()
