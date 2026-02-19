"""WSGI entry point для продакшену (Render / Heroku / Railway)."""

import os

# На продакшені використовуємо eventlet
if os.environ.get("RENDER") or os.environ.get("DYNO") or os.environ.get("RAILWAY_ENVIRONMENT"):
    try:
        import eventlet
        eventlet.monkey_patch()
    except (ImportError, AttributeError):
        pass

from app import app, socketio

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port)
