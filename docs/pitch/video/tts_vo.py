"""Draft voice-over with Soniox TTS, one WAV per clip, plus sentence-timed captions.

Reads only SONIOX_API_KEY from the main checkout's .env inside this process; the value is never printed or written.
"""
import json, os, re, sys, urllib.request, wave, io

ENV = r"C:/Users/jiaqi/Documents/.ai/hackathon/Junc26/.env"
OUT = r"C:/Users/jiaqi/Documents/.ai/hackathon/Junc26/scratch/video/vo"
VOICE = sys.argv[1] if len(sys.argv) > 1 else "Adrian"
SPEED = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0

def key():
    with open(ENV, encoding="utf-8") as f:
        for line in f:
            if line.startswith("SONIOX_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("SONIOX_API_KEY not found")

CLIPS = [
    ("d1-cover", 6, "Mandate. Every item an agent wants to buy is ordered, held for the chef, or refused."),
    ("d3-case", 14, "A hotel kitchen. A buffet for 140 is booked, Valio is out of the ham, and the cut-off is Friday at five. An agent could sort this out. But what may it buy without the chef?"),
    ("d4-rules", 14, "The chef writes the rules once: up to 800 euros an item, never change an allergen, ask before anything new. The rules are code, so no model and no agent can bend them."),
    ("A-words-live", 38, "Now from words. One sentence: a no-meat dinner for 120 with a peach dessert. Gemini proposes the menu. Plan it: every ingredient becomes a Valio product with a price. A new menu means new products, and this hotel's rules say ask me first, so the agent asks once. One yes covers exactly these items, and the order lands on Valio's side."),
    ("B-buffet-live", 18, "On the buffet, the same rules sort the order: three items go through alone, three are impossible and say why, and the rest come down to three decisions for the chef."),
    ("d8-consent", 14, "Any agent can plan: the chef's own assistant, a hotel chain's system. Only the chef can say yes, in the app or when their own assistant asks. Anything else that tries is refused and logged."),
    ("d9-next", 10, "Real Valio data, Gemini and Aiven. The order itself is simulated and labelled. Next: a pilot with one hotel."),
    ("d10-close", 6, "Your agent does the buying. Your rules decide what. app dot mandate dot kitchen."),
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
    k = key()
    try:
        pick_model(k)
    except urllib.error.HTTPError as e:
        raise SystemExit("Soniox models HTTP %s: %s" % (e.code, e.read()[:300].decode("utf-8", "replace")))
    report = []
    for cid, slot, text in CLIPS:
        try:
            audio = tts(k, text)
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
        print("%-14s audio %5.1fs  slot %2ds  %s" % (cid, dur, slot, "ok" if dur <= slot else "OVER"))
    with open(os.path.join(OUT, "vo.json"), "w", encoding="utf-8") as f:
        json.dump({"voice": VOICE, "speed": SPEED, "clips": report}, f, indent=1)
    print("total audio %.1fs" % sum(r["audioS"] for r in report))

main()
