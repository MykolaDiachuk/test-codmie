"""WSGI entry point для продакшену (Render / Heroku / Railway)."""

from app import app, socketio

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port)
