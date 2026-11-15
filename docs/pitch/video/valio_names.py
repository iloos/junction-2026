"""Pronunciation candidates for "Valio Aimo" with Soniox TTS: respellings in the TTS input only.

Reads only SONIOX_API_KEY from the main checkout's .env inside this process; the value is never printed or written.
Writes scratch/video/vo/valio-*.wav and valio.json.
"""
import io, json, os, sys, urllib.request, urllib.error, wave

ENV = r"C:/Users/jiaqi/Documents/.ai/hackathon/Junc26/.env"
OUT = r"C:/Users/jiaqi/Documents/.ai/hackathon/Junc26/scratch/video/vo"
TTS = "https://tts-rt.eu.soniox.com/tts"
UA = {"User-Agent": "tts-draft-client/1.0"}
VOICE = sys.argv[1] if len(sys.argv) > 1 else "Adrian"
LINE = "On %s, the chef writes the rules once."
VALIO = {"vahlyo": "Vahlyo", "valjo": "Valjo", "vahleeoh": "Vah-lee-oh"}
AIMO = {"ajmo": "Ajmo", "aimoh": "Aimoh", "eyemoh": "Eye-moh"}

def key():
    with open(ENV, encoding="utf-8") as f:
        for line in f:
            if line.startswith("SONIOX_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("SONIOX_API_KEY not found")

def tts(k, text, lang="en"):
    body = {"model": "tts-rt-v2", "language": lang, "voice": VOICE, "audio_format": "wav", "sample_rate": 24000,
            "text": text, "reduce_silence": True}
    req = urllib.request.Request(TTS, data=json.dumps(body).encode(), method="POST",
                                 headers=dict(UA, Authorization="Bearer " + k, **{"Content-Type": "application/json"}))
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

def save(audio, name):
    with wave.open(io.BytesIO(audio)) as w:
        ch, sw, rate = w.getnchannels(), w.getsampwidth(), w.getframerate()
    pcm = audio[audio.index(b"data") + 8:]
    pcm = pcm[: len(pcm) - (len(pcm) % (sw * ch))]
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(ch); w.setsampwidth(sw); w.setframerate(rate); w.writeframes(pcm)
    return round(len(pcm) / float(sw * ch * rate), 2)

def main():
    os.makedirs(OUT, exist_ok=True)
    k, rows = key(), []
    jobs = [("valio-%s-%s.wav" % (a, b), LINE % ("%s %s" % (va, vb)), "en") for a, va in VALIO.items() for b, vb in AIMO.items()]
    jobs += [("valio-fi-name.wav", "Valio Aimo.", "fi"), ("valio-fi-line.wav", "Valio Aimo, keittiön säännöt.", "fi"),
             ("valio-plain.wav", LINE % "Valio Aimo", "en")]
    for name, text, lang in jobs:
        try:
            rows.append({"file": name, "lang": lang, "text": text, "s": save(tts(k, text, lang), name)}); print("ok", name)
        except urllib.error.HTTPError as e:
            print(name, "HTTP", e.code, e.read()[:200].decode("utf-8", "replace"))
    json.dump({"voice": VOICE, "clips": rows}, open(os.path.join(OUT, "valio.json"), "w", encoding="utf-8"), indent=1)

main()
