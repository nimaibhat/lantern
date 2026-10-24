# Lantern


```bash
npm install
```



## Hero video

- `media/lantern-hero-source.mp4`: the original Shader Lab export (HEVC, 18 MB). Kept out of git.
- `public/lantern-hero.mp4`: the web version the page loads (H.264, 1440px, 3 MB).
- `public/lantern-hero.jpg`: the poster frame shown while the video loads.

To re-export after changing the source:

```bash
ffmpeg -y -i media/lantern-hero-source.mp4 -vf scale=1440:-2 -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -movflags +faststart -an public/lantern-hero.mp4
ffmpeg -y -ss 0.5 -i public/lantern-hero.mp4 -frames:v 1 -vf scale=960:-2 -q:v 9 public/lantern-hero.jpg
```
