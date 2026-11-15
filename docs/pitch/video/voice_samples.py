"""Voice samples for the film: Gemini 3.8 Flash TTS and ElevenLabs, one line, several voices and paces.

Reads only GEMINI_STUDIO_API_KEY and ELEVENLABS_API_KEY from the main checkout's .env inside this process; values are never printed or written.
Writes WAV/MP3 files and an index.html with players to Junc26/scratch/video/voices/.
"""
import base64, html, json, os, sys, urllib.request, urllib.error

ENV = r"C:/Users/jiaqi/Documents/.ai/hackathon/Junc26/.env"
OUT = r"C:/Users/jiaqi/Documents/.ai/hackathon/Junc26/scratch/video/voices"
UA = {"User-Agent": "voice-sample-client/1.0"}
TEXT = ("On Valio Aimo, the chef writes the rules once: up to 800 euros an item, never change an allergen, ask before anything new. "
        "The rules are code, and every item records which rule, or which yes, let it through.")

def key(name):
    with open(ENV, encoding="utf-8") as f:
        for line in f:
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None

def call(url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 method="POST" if body is not None else "GET",
                                 headers=dict(UA, **(headers or {}), **({"Content-Type": "application/json"} if body is not None else {})))
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

NARRATOR = "calm, confident product-demo narrator, clear and warm; say Valio Aimo the Finnish way, VAH-lee-oh EYE-moh, stress on the first syllable of each word"
GEMINI = [  # (voice, style)
    ("Charon", NARRATOR), ("Kore", NARRATOR), ("Sadaltager", NARRATOR), ("Achird", NARRATOR),
    ("Algieba", NARRATOR), ("Schedar", NARRATOR), ("Sulafat", NARRATOR), ("Iapetus", NARRATOR),
    ("Charon", NARRATOR + ", speaking slightly faster, energetic"),
    ("Charon", NARRATOR + ", speaking slowly, deliberate pauses"),
    ("Kore", "keynote presenter on stage, upbeat, emphasis on the numbers"),
]

def gemini(k, results):
    for voice, style in GEMINI:
        name = "gemini-%s-%d.wav" % (voice.lower(), abs(hash(style)) % 1000)
        body = {"model": "gemini-3.8-flash-tts",
                "input": [{"type": "user_input", "content": [{"type": "text", "text": TEXT,
                           "annotations": [{"type": "speech_metadata", "style": style}]}]}],
                "response_format": {"type": "audio"},
                "generation_config": {"speech_config": [{"voice": voice}]}}
        try:
            data = json.loads(call("https://generativelanguage.googleapis.com/v1beta/interactions", body, {"x-goog-api-key": k}))
            audio = [c for s in data.get("steps", []) if s.get("type") == "model_output" for c in s.get("content", []) if c.get("type") == "audio"][-1]
            open(os.path.join(OUT, name), "wb").write(base64.b64decode(audio["data"]))
            results.append(("Gemini 3.8 Flash TTS", voice, style, name)); print("ok", name)
        except urllib.error.HTTPError as e:
            print("gemini", voice, "HTTP", e.code, e.read()[:200].decode("utf-8", "replace"))

ELEVEN_VOICES = [("George", "JBFqnCBsd6RMkjVDRZzb"), ("Adam", "pNInz6obpgDQGcFmaJgB"), ("Daniel", "onwK4e9ZLuTAKqWW03F9"),
                 ("Rachel", "21m00Tcm4TlvDq8ikWAM"), ("Sarah", "EXAVITQu4vr4xnSDxMaL"), ("Charlotte", "XB0fDUnXU5powFXDhCwa")]
ELEVEN_MODELS = ["eleven_v4", "eleven_v3", "eleven_multilingual_v2"]

def eleven(k, results):
    h = {"xi-api-key": k}
    def say(model, vname, vid, speed, stab):
        body = {"text": TEXT, "model_id": model, "voice_settings": {"stability": stab, "similarity_boost": 0.75, "speed": speed}}
        return call("https://api.elevenlabs.io/v1/text-to-speech/%s?output_format=mp3_44100_128" % vid, body, h)
    model = None
    for m in ELEVEN_MODELS:
        try:
            audio = say(m, *ELEVEN_VOICES[0], 1.0, 0.5); model = m; break
        except urllib.error.HTTPError as e:
            print("eleven model", m, "HTTP", e.code, e.read()[:200].decode("utf-8", "replace"))
    if not model:
        return
    print("eleven model", model)
    runs = [(v, 1.0, 0.5) for v in ELEVEN_VOICES] + [(ELEVEN_VOICES[0], 1.12, 0.5), (ELEVEN_VOICES[0], 0.9, 0.5), (ELEVEN_VOICES[0], 1.0, 0.0)]
    for i, ((vname, vid), speed, stab) in enumerate(runs):
        name = "eleven-%s-s%s-st%s.mp3" % (vname.lower(), speed, stab)
        try:
            data = audio if i == 0 else say(model, vname, vid, speed, stab)
            open(os.path.join(OUT, name), "wb").write(data)
            results.append(("ElevenLabs " + model, vname, "speed %s, stability %s" % (speed, stab), name)); print("ok", name)
        except urllib.error.HTTPError as e:
            print("eleven", vname, "HTTP", e.code, e.read()[:200].decode("utf-8", "replace"))

def main():
    os.makedirs(OUT, exist_ok=True)
    results = []
    which = sys.argv[1:] or ["gemini", "eleven"]
    if "gemini" in which:
        k = key("GEMINI_STUDIO_API_KEY"); gemini(k, results) if k else print("no GEMINI_STUDIO_API_KEY")
    if "eleven" in which:
        k = key("ELEVENLABS_API_KEY"); eleven(k, results) if k else print("no ELEVENLABS_API_KEY")
    rows = "".join("<tr><td>%s</td><td><b>%s</b></td><td>%s</td><td><audio controls preload=none src='%s'></audio></td></tr>"
                   % tuple(html.escape(x) for x in r) for r in results)
    open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(
        "<!doctype html><meta charset=utf-8><title>Voice samples</title><style>body{font:15px system-ui;margin:24px}td{padding:6px 12px;border-bottom:1px solid #ddd}</style>"
        "<p>%s</p><table>%s</table>" % (html.escape(TEXT), rows))
    print(len(results), "samples ->", OUT)

main()
