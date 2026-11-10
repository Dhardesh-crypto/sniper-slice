Skins are shipped at 2048 x 2048 (10 November 2026): `npx gltf-transform resize <skin>.glb <out>.glb --width 2048 --height 2048`.
At 4096 each took about 89 MB of GPU memory (Town has five); at 2048 about 22 MB, and half the download.
A new skin from tools/skins/skin-all.sh bakes at 4096: resize it before it goes into public/models.
