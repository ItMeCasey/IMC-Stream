"""Long-running Kokoro text-to-speech worker. Reads one JSON request per line on stdin, writes one JSON answer per line on stdout.
Started by tts.js with the Python inside server/kokoro/venv. Usage: python kokoro_worker.py <model.onnx> <voices.bin>"""
import json
import sys

sys.stdin.reconfigure(encoding="utf-8")
LANG = {"a": "en-us", "b": "en-gb", "e": "es", "f": "fr-fr", "h": "hi", "i": "it", "p": "pt-br"}   # j / z (Japanese, Chinese) need extra packages


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


try:
    from kokoro_onnx import Kokoro
    import soundfile as sf
    k = Kokoro(sys.argv[1], sys.argv[2])
    voices = [v for v in k.get_voices() if v[:1] in LANG]
    out({"ready": True, "voices": voices})
except Exception as e:  # missing package, bad model file...
    out({"ready": False, "error": str(e)})
    sys.exit(1)

for line in sys.stdin:
    try:
        req = json.loads(line)
        voice = req.get("voice") if req.get("voice") in voices else "af_heart"
        samples, rate = k.create(req["text"], voice=voice, speed=float(req.get("speed", 1.0)), lang=LANG.get(voice[:1], "en-us"))
        sf.write(req["out"], samples, rate)
        out({"id": req.get("id"), "ok": True, "seconds": len(samples) / rate})
    except Exception as e:
        out({"id": (locals().get("req") or {}).get("id"), "ok": False, "error": str(e)})
