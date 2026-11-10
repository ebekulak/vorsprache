"""Runs the practice app on this computer, with listening and feedback. Reachable only from this computer."""
import os
import pathlib
import re
import sys
import threading

# No usage statistics to Hugging Face. Set before any model library is imported.
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")
os.environ.setdefault("DO_NOT_TRACK", "1")

from flask import Flask, abort, jsonify, request, send_from_directory

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import evaluate  # noqa: E402
import speech  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 4173
STATIC = {"content.js", "engine.js", "app.js", "audio-manifest.js"}
CSP = ("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; "
       "media-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 40 * 1024 * 1024


@app.before_request
def only_this_computer():
    # Stops other websites open in the browser from calling this server.
    allowed = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
    if request.host not in allowed:
        abort(403)
    origin = request.headers.get("Origin")
    if origin and re.sub(r"^https?://", "", origin) not in allowed:
        abort(403)


@app.after_request
def privacy_headers(response):
    response.headers["Content-Security-Policy"] = CSP
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Permissions-Policy"] = "microphone=(self), camera=(), geolocation=()"
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/")
def page():
    return send_from_directory(ROOT, "index.html", max_age=0)


@app.get("/<name>")
def static_file(name):
    if name not in STATIC:
        abort(404)
    return send_from_directory(ROOT, name, max_age=0)


@app.get("/fonts/<name>")
def font(name):
    return send_from_directory(ROOT / "fonts", name)


@app.get("/audio/<name>")
def clip(name):
    return send_from_directory(ROOT / "audio", name)


@app.get("/api/health")
def health():
    return jsonify({**speech.status, "claude": bool(evaluate.CLAUDE)})


@app.post("/api/listen")
def listen():
    if speech.status["pronunciation"] != "ready":
        return jsonify({"error": "models_loading"}), 503
    upload = request.files.get("audio")
    if not upload:
        return jsonify({"error": "no_audio"}), 400
    try:
        return jsonify(speech.analyze(upload.read(), request.form.get("reference") or None, request.form.get("context")))
    except Exception as err:
        app.logger.exception("analysis failed")
        return jsonify({"error": "analysis_failed", "detail": str(err)[:200]}), 500


@app.post("/api/evaluate")
def feedback():
    payload = request.get_json(silent=True) or {}
    if not payload.get("transcript"):
        return jsonify({"error": "no_transcript"}), 400
    try:
        return jsonify(evaluate.evaluate(payload))
    except Exception as err:
        app.logger.exception("feedback failed")
        return jsonify({"error": "feedback_failed", "detail": str(err)[:200]}), 502


if __name__ == "__main__":
    threading.Thread(target=speech.load_models, daemon=True).start()
    print(f"\n  Vorsprache is running: http://localhost:{PORT}\n  Only this computer can reach it. Keep this window open while you practise. Close it to stop.\n", flush=True)
    app.run(host="127.0.0.1", port=PORT, threaded=True)
