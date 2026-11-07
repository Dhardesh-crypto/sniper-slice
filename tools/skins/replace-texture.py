# Put a new image into a building skin's GLB in place of its texture (patch-sky.js makes one). The
# meshopt-compressed geometry after the image in the file is moved along, untouched.
#   python3 replace-texture.py public/models/skin_<name>.glb new.webp
import json, struct, sys

path, image = sys.argv[1], open(sys.argv[2], 'rb').read()
data = open(path, 'rb').read()
jlen = struct.unpack('<I', data[12:16])[0]
js = json.loads(data[20:20 + jlen])
blen = struct.unpack('<I', data[20 + jlen: 24 + jlen])[0]
binary = data[28 + jlen: 28 + jlen + blen]
iv = js['bufferViews'][js['images'][0]['bufferView']]
buf, off, size = iv.get('buffer', 0), iv.get('byteOffset', 0), iv['byteLength']
pad = (-(off + len(image))) % 4                            # (what follows stays 4-byte aligned)
delta = len(image) + pad - size
binary = binary[:off] + image + b'\0' * pad + binary[off + size:]
iv['byteLength'] = len(image)
for bv in js['bufferViews']:
    if bv is not iv and bv.get('buffer', 0) == buf and bv.get('byteOffset', 0) > off: bv['byteOffset'] += delta
    ext = bv.get('extensions', {}).get('EXT_meshopt_compression')
    if ext and ext.get('buffer', 0) == buf and ext.get('byteOffset', 0) > off: ext['byteOffset'] += delta
js['buffers'][buf]['byteLength'] = len(binary)
j = json.dumps(js, separators=(',', ':')).encode(); j += b' ' * ((-len(j)) % 4)
binary += b'\0' * ((-len(binary)) % 4)
open(path, 'wb').write(struct.pack('<III', 0x46546C67, 2, 28 + len(j) + len(binary)) + struct.pack('<II', len(j), 0x4E4F534A) + j
                       + struct.pack('<II', len(binary), 0x004E4942) + binary)
print(path, 'image', size, '->', len(image))
