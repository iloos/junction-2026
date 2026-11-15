"""Builds the draft-cut HyperFrames root (index.html) from the VO timings and the clip/still assets."""
import json, os, shutil, html

V = r"C:/Users/jiaqi/Documents/.ai/hackathon/Junc26/scratch/video"
D = V + "/draft"
A = D + "/assets"
os.makedirs(A + "/stills", exist_ok=True)
os.makedirs(A + "/vo", exist_ok=True)
os.makedirs(A + "/clips", exist_ok=True)

vo = {c["clip"]: c for c in json.load(open(os.environ.get("VO_DIR", V + "/vo") + "/vo.json", encoding="utf-8"))["clips"]}
for c in vo.values():
    shutil.copy(c["file"], A + "/vo/" + os.path.basename(c["file"]))
for f in os.listdir(V + "/stills-deck"):
    shutil.copy(V + "/stills-deck/" + f, A + "/stills/" + f)

# (clip id, slot seconds, visual: still or live clip with still fallback)
PLAN = [
    ("d1-cover", 7, "s1.png", None),
    ("d3-case", 18.5, "s3.png", None),
    ("d4-rules", 18.5, "s4.png", None),
    ("A-words-live", 26, "s7.png", "A-words-live.mp4"),
    ("B-buffet-live", 14, "s5.png", "B-buffet-live.mp4"),
    ("d8-consent", 13, "s8.png", "C-consent.mp4"),
    ("d9-next", 16, "s9.png", None),
    ("d10-close", 7, "s10.png", None),
]
LEAD = 0.4  # voice starts after the picture
XF = 0.25   # crossfade on deck cuts

scenes, audio, caps, tw = [], [], [], []
t = 0.0
for i, (cid, slot, still, live) in enumerate(PLAN):
    sid = "sc%d" % i
    live_ok = live and os.path.exists(A + "/clips/" + live)
    if live_ok:
        scenes.append('<div id="%s" class="clip scene" data-start="%.2f" data-duration="%.2f" data-track-index="0" data-track-kind="graphics" style="z-index:%d"><video id="%sv" class="clip" src="assets/clips/%s" muted playsinline data-start="%.2f" data-duration="%.2f" data-track-index="1"></video></div>'
                      % (sid, t, slot, 10 + i, sid, live, t, slot))
    else:
        scenes.append('<div id="%s" class="clip scene" data-start="%.2f" data-duration="%.2f" data-track-index="0" data-track-kind="graphics" style="z-index:%d"><img id="%si" src="assets/stills/%s" alt=""></div>'
                      % (sid, t, slot, 10 + i, sid, still))
        tw.append('tl.fromTo("#%si", {scale:1.0}, {scale:1.025, duration:%.2f, ease:"none"}, %.2f);' % (sid, slot, t))
    if i > 0 and not (live_ok or (PLAN[i - 1][3] and os.path.exists(A + "/clips/" + PLAN[i - 1][3]))):
        tw.append('tl.fromTo("#%s > *", {opacity:0}, {opacity:1, duration:%.2f, ease:"power1.out"}, %.2f);' % (sid, XF, t))
    c = vo[cid]
    audio.append('<audio id="vo%d" class="clip" src="assets/vo/%s" data-start="%.2f" data-duration="%.2f" data-track-index="5"></audio>'
                 % (i, os.path.basename(c["file"]), t + LEAD, min(c["audioS"], slot - LEAD)))
    for j, cap in (enumerate(c["captions"]) if live else []):
        cs = t + LEAD + cap["start"]
        cd = max(0.6, min(cap["end"], slot - LEAD) - cap["start"])
        caps.append('<p id="cap%d_%d" class="clip cap" data-start="%.2f" data-duration="%.2f" data-track-index="6">%s</p>'
                    % (i, j, cs, cd, html.escape(cap["text"])))
    t += slot
total = t

page = '''<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      :root { --ground: #0b0e12; --ink: #ffffff; --band: rgba(12, 16, 22, 0.62); }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: var(--ground); }
      #root { position: relative; width: 100%%; height: 100%%; font-family: "Inter", "Segoe UI", Arial, sans-serif; }
      .scene { position: absolute; inset: 0; overflow: hidden; background: var(--ground); }
      .scene img, .scene video { width: 100%%; height: 100%%; object-fit: cover; display: block; transform-origin: 50%% 50%%; }
      #captions { position: absolute; left: 0; right: 0; bottom: 120px; z-index: 50; display: flex; justify-content: center; pointer-events: none; }
      .cap { position: absolute; bottom: 0; max-width: 1400px; text-align: center; color: var(--ink); background: var(--band); padding: 12px 26px; border-radius: 10px; font-size: 38px; line-height: 1.3; font-weight: 500; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="%.2f" data-width="1920" data-height="1080">
      %s
      <div id="captions" data-track-kind="captions" data-layout-allow-overlap>
        %s
      </div>
      %s
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      %s
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
''' % (total, "\n      ".join(scenes), "\n        ".join(caps), "\n      ".join(audio), "\n      ".join(tw))
open(D + "/index.html", "w", encoding="utf-8").write(page)
print("total %.1fs, scenes %d, captions %d" % (total, len(scenes), len(caps)))
