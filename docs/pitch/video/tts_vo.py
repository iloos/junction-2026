"""Draft voice-over with Soniox TTS, one WAV per clip, plus sentence-timed captions.

Reads only SONIOX_API_KEY from the main checkout's .env inside this process; the value is never printed or written.
"""
import json, os, re, sys, urllib.request, wave, io

ENV = r"C:/Users/jiaqi/Documents/.ai/hackathon/Junc26/.env"
OUT = os.environ.get("VO_OUT", r"C:/Users/jiaqi/Documents/.ai/hackathon/Junc26/scratch/video/vo")
VOICE = sys.argv[1] if len(sys.argv) > 1 else "Adrian"
SPEED = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0

def key():
    with open(ENV, encoding="utf-8") as f:
        for line in f:
            if line.startswith("SONIOX_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("SONIOX_API_KEY not found")

CLIPS = [
    ("d1-cover", 7, "Mandate decides what a kitchen's buying agent may order by itself, and what has to wait for the chef."),
    ("d3-case", 18.5, "A hotel kitchen has a Christmas buffet for 140 on Saturday. That's 21 items to buy from Valio Aimo. The ham is out of stock, and orders close Friday at five. The chef should only have to make three decisions here. Which of the rest can an agent buy alone?"),
    ("d4-rules", 18.5, "The chef sets the rules once. Here the agent may spend up to 800 euros an item. It may never swap in a different allergen, and it asks before buying anything new. The rules run as code, and each item keeps a record of the rule or the approval behind it."),
    ("A-words-live", 26, "Now a new menu, from one sentence: a no-meat dinner for 120 with a peach dessert. Gemini drafts the menu, and the plan turns each ingredient into a Valio product with a price. All of them are new to this kitchen, and the rules say to ask first, so the agent asks once. The chef's yes covers exactly these items, and the order goes to Valio Aimo."),
    ("B-buffet-live", 14, "Back to the buffet. Three items fit the rules, so the agent orders them. Another three can't be ordered, and each one says why. The other fifteen wait for the chef, grouped into three decisions."),
    ("d8-consent", 13, "Other agents can use Mandate too. Here Claude plans a dinner through it. Nothing gets ordered until the chef says yes, and an outside agent that tries to approve is refused."),
    ("d9-next", 16, "Valio Aimo's catalogue and prices are real, and it runs on Gemini and Aiven. The order is simulated, and the app says so. Valio Aimo gets each kitchen's demand before the cut-off. Next, a pilot with one hotel."),
    ("d10-close", 7, "Your agent does the buying. Your rules decide what. app dot mandate dot kitchen."),
]

REGION = os.environ.get("SONIOX_REGION", "eu")
API = "https://api.%s.soniox.com/v1" % REGION if REGION else "https://api.soniox.com/v1"
TTS = "https://tts-rt.%s.soniox.com/tts" % REGION if REGION else "https://tts-rt.soniox.com/tts"
UA = {"User-Agent": "tts-draft-client/1.0"}
MODEL = {"id": "tts-rt-v1", "silence": False}

def pick_model(k):
    req = urllib.request.Request(API + "/tts-models", headers=dict(UA, Authorization="Bearer " + k))
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    models = data.get("models", data if isinstance(data, list) else [])
    ids = [m.get("id") for m in models]
    print("models:", ids)
    best = sorted([m for m in models if not m.get("aliased_model_id")], key=lambda m: m.get("id", ""))[-1]
    MODEL["id"] = best["id"]
    MODEL["silence"] = bool(best.get("supports_silence_reduction"))
    print("using", MODEL)

ELEVEN = {"George": "JBFqnCBsd6RMkjVDRZzb", "Charlotte": "XB0fDUnXU5powFXDhCwa"}

def eleven_key():
    with open(ENV, encoding="utf-8") as f:
        for line in f:
            if line.startswith("ELEVENLABS_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("ELEVENLABS_API_KEY not found")

def tts_eleven(k, text):
    """PCM 24 kHz from ElevenLabs v4, wrapped as WAV so the rest of the pipeline is unchanged."""
    body = {"text": text, "model_id": "eleven_v4", "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "speed": SPEED}}
    req = urllib.request.Request("https://api.elevenlabs.io/v1/text-to-speech/%s?output_format=pcm_24000" % ELEVEN[VOICE.split(":")[1]],
                                 data=json.dumps(body).encode(), method="POST", headers=dict(UA, **{"xi-api-key": k, "Content-Type": "application/json"}))
    with urllib.request.urlopen(req, timeout=120) as r:
        pcm = r.read()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(pcm)
    return buf.getvalue()

def tts(k, text):
    payload = {"model": MODEL["id"], "language": "en", "voice": VOICE, "audio_format": "wav", "sample_rate": 24000, "speed": SPEED, "text": text}
    if MODEL["silence"]:
        payload["reduce_silence"] = True
    body = json.dumps(payload).encode()
    req = urllib.request.Request(TTS, data=body, method="POST",
                                 headers=dict(UA, **{"Authorization": "Bearer " + k, "Content-Type": "application/json", "Accept": "audio/wav, */*"}))
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

def main():
    os.makedirs(OUT, exist_ok=True)
    if VOICE.startswith("eleven:"):
        k = eleven_key(); say = tts_eleven
    else:
        k = key(); say = tts
        try:
            pick_model(k)
        except urllib.error.HTTPError as e:
            raise SystemExit("Soniox models HTTP %s: %s" % (e.code, e.read()[:300].decode("utf-8", "replace")))
    report = []
    for cid, slot, text in CLIPS:
        try:
            audio = say(k, text)
        except urllib.error.HTTPError as e:
            raise SystemExit("Soniox HTTP %s on %s: %s" % (e.code, cid, e.read()[:300].decode("utf-8", "replace")))
        path = os.path.join(OUT, cid + ".wav")
        with wave.open(io.BytesIO(audio)) as w:
            ch, sw, rate = w.getnchannels(), w.getsampwidth(), w.getframerate()
        pcm = audio[audio.index(b"data") + 8:]
        pcm = pcm[: len(pcm) - (len(pcm) % (sw * ch))]
        with wave.open(path, "wb") as w:
            w.setnchannels(ch); w.setsampwidth(sw); w.setframerate(rate); w.writeframes(pcm)
        dur = len(pcm) / float(sw * ch * rate)
        sentences = [s for s in re.split(r"(?<=[.?!:])\s+", text) if s]
        total = sum(len(s) for s in sentences)
        t, caps = 0.0, []
        for s in sentences:
            d = dur * len(s) / total
            caps.append({"start": round(t, 2), "end": round(t + d, 2), "text": s})
            t += d
        report.append({"clip": cid, "slotS": slot, "audioS": round(dur, 2), "fits": dur <= slot, "file": path, "captions": caps})
        print("%-14s audio %5.1fs  slot %4.1fs  %s" % (cid, dur, slot, "ok" if dur <= slot else "OVER"))
    with open(os.path.join(OUT, "vo.json"), "w", encoding="utf-8") as f:
        json.dump({"voice": VOICE, "speed": SPEED, "clips": report}, f, indent=1)
    print("total audio %.1fs" % sum(r["audioS"] for r in report))

main()
