"""
Хрестики-Нолики — веб-гра на Flask + Flask-SocketIO.
Режими:
  • PvP (локальний)
  • PvE (AI мінімакс)
  • Online — мультиплеєр через WebSocket (кімнати)

Готовий до деплою на Render / Heroku.
"""

from flask import Flask, render_template, request, jsonify, session
from flask_socketio import SocketIO, emit, join_room, leave_room
import copy
import random
import os
import string
import time

# ──────────────────────────────────────────────
#  Flask + SocketIO
# ──────────────────────────────────────────────

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", os.urandom(24))

# Визначаємо async_mode: gevent для продакшену, threading для локальної розробки
_async_mode = "threading"
try:
    import gevent
    _async_mode = "gevent"
except ImportError:
    _async_mode = "threading"

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode=_async_mode,
    logger=False,
    engineio_logger=False,
)
print(f"[SocketIO] async_mode = {_async_mode}")

# ──────────────────────────────────────────────
#  Ігрова логіка
# ──────────────────────────────────────────────

EMPTY = ""
X = "X"
O = "O"


def empty_board():
    return [["" for _ in range(3)] for _ in range(3)]


def check_winner(board):
    """
    Повертає:
      "X" / "O"  — переможець
      "draw"     — нічия
      None       — гра продовжується
    Також повертає список координат виграшної лінії.
    """
    lines = []
    for r in range(3):
        lines.append([(r, 0), (r, 1), (r, 2)])
    for c in range(3):
        lines.append([(0, c), (1, c), (2, c)])
    lines.append([(0, 0), (1, 1), (2, 2)])
    lines.append([(0, 2), (1, 1), (2, 0)])

    for line in lines:
        vals = [board[r][c] for r, c in line]
        if vals[0] == vals[1] == vals[2] and vals[0] != EMPTY:
            return vals[0], line

    if all(board[r][c] != EMPTY for r in range(3) for c in range(3)):
        return "draw", []

    return None, []


# ──────────────────────────────────────────────
#  AI — Мінімакс
# ──────────────────────────────────────────────

def minimax(board, is_maximizing):
    result, _ = check_winner(board)
    if result == O:
        return 1
    if result == X:
        return -1
    if result == "draw":
        return 0

    if is_maximizing:
        best = -float("inf")
        for r in range(3):
            for c in range(3):
                if board[r][c] == EMPTY:
                    board[r][c] = O
                    score = minimax(board, False)
                    board[r][c] = EMPTY
                    best = max(best, score)
        return best
    else:
        best = float("inf")
        for r in range(3):
            for c in range(3):
                if board[r][c] == EMPTY:
                    board[r][c] = X
                    score = minimax(board, True)
                    board[r][c] = EMPTY
                    best = min(best, score)
        return best


def ai_move(board):
    best_score = -float("inf")
    best_moves = []
    for r in range(3):
        for c in range(3):
            if board[r][c] == EMPTY:
                board[r][c] = O
                score = minimax(board, False)
                board[r][c] = EMPTY
                if score > best_score:
                    best_score = score
                    best_moves = [(r, c)]
                elif score == best_score:
                    best_moves.append((r, c))
    return random.choice(best_moves) if best_moves else None


# ──────────────────────────────────────────────
#  Онлайн кімнати (in-memory)
# ──────────────────────────────────────────────

rooms = {}  # room_code -> { ... }

"""
Структура кімнати:
{
    "board": [[...]],
    "turn": "X",
    "players": { "X": sid, "O": sid },
    "winner": None,
    "win_line": [],
    "created_at": timestamp,
    "scores": { "X": 0, "O": 0, "draw": 0 },
}
"""


def generate_room_code():
    """Генерує унікальний 6-символьний код кімнати."""
    while True:
        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if code not in rooms:
            return code


def cleanup_old_rooms(max_age=3600):
    """Видаляє кімнати старіші за max_age секунд."""
    now = time.time()
    to_delete = [
        code for code, room in rooms.items()
        if now - room.get("created_at", now) > max_age
    ]
    for code in to_delete:
        del rooms[code]


# ──────────────────────────────────────────────
#  HTTP Маршрути
# ──────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/new_game", methods=["POST"])
def new_game():
    data = request.get_json()
    mode = data.get("mode", "pvp")

    session["board"] = empty_board()
    session["current_turn"] = X
    session["mode"] = mode
    session["game_over"] = False
    session["winner"] = None

    return jsonify({
        "board": session["board"],
        "current_turn": session["current_turn"],
        "mode": mode,
        "game_over": False,
        "winner": None,
    })


@app.route("/api/move", methods=["POST"])
def make_move():
    data = request.get_json()
    row = data.get("row")
    col = data.get("col")

    board = session.get("board", empty_board())
    current_turn = session.get("current_turn", X)
    mode = session.get("mode", "pvp")
    game_over = session.get("game_over", False)

    if game_over:
        return jsonify({"error": "Гра вже завершена!"}), 400
    if board[row][col] != EMPTY:
        return jsonify({"error": "Ця клітинка вже зайнята!"}), 400

    board[row][col] = current_turn
    winner, win_line = check_winner(board)

    ai_row, ai_col = None, None

    if winner:
        game_over = True
    else:
        current_turn = O if current_turn == X else X

        if mode == "pve" and current_turn == O and not game_over:
            move = ai_move(board)
            if move:
                ai_row, ai_col = move
                board[ai_row][ai_col] = O
                winner, win_line = check_winner(board)
                if winner:
                    game_over = True
                else:
                    current_turn = X

    session["board"] = board
    session["current_turn"] = current_turn
    session["game_over"] = game_over
    session["winner"] = winner

    response = {
        "board": board,
        "current_turn": current_turn,
        "game_over": game_over,
        "winner": winner,
        "win_line": [[r, c] for r, c in win_line] if win_line else [],
    }

    if ai_row is not None:
        response["ai_move"] = {"row": ai_row, "col": ai_col}

    return jsonify(response)


# ──────────────────────────────────────────────
#  SocketIO — Онлайн мультиплеєр
# ──────────────────────────────────────────────

@socketio.on("connect")
def on_connect():
    print(f"[WS] Клієнт підключився: {request.sid}")


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    print(f"[WS] Клієнт від'єднався: {sid}")

    # Шукаємо кімнату цього гравця і сповіщаємо опонента
    for code, room in list(rooms.items()):
        players = room.get("players", {})
        for symbol, player_sid in list(players.items()):
            if player_sid == sid:
                del players[symbol]
                emit("opponent_left", {"message": "Суперник від'єднався 😢"}, room=code)
                # Якщо кімната порожня — видалити
                if not players:
                    del rooms[code]
                return


@socketio.on("create_room")
def on_create_room():
    cleanup_old_rooms()
    code = generate_room_code()
    rooms[code] = {
        "board": empty_board(),
        "turn": X,
        "players": {X: request.sid},
        "winner": None,
        "win_line": [],
        "created_at": time.time(),
        "scores": {X: 0, O: 0, "draw": 0},
    }
    join_room(code)
    emit("room_created", {
        "room_code": code,
        "symbol": X,
        "message": f"Кімната {code} створена! Чекаємо суперника…",
    })
    print(f"[WS] Кімната створена: {code} гравцем {request.sid}")


@socketio.on("join_room")
def on_join_room(data):
    code = data.get("room_code", "").upper().strip()

    if code not in rooms:
        emit("error", {"message": f"Кімната «{code}» не знайдена!"})
        return

    room = rooms[code]
    players = room["players"]

    # Перевірка: вже в кімнаті?
    if request.sid in players.values():
        emit("error", {"message": "Ви вже в цій кімнаті!"})
        return

    if len(players) >= 2:
        emit("error", {"message": "Кімната вже повна!"})
        return

    # Визначаємо символ
    symbol = O if X in players else X
    players[symbol] = request.sid
    join_room(code)

    # Скидаємо дошку для нової гри
    room["board"] = empty_board()
    room["turn"] = X
    room["winner"] = None
    room["win_line"] = []

    emit("room_joined", {
        "room_code": code,
        "symbol": symbol,
        "message": f"Ви приєдналися як {symbol}!",
    })

    # Повідомити обох — гра починається
    emit("game_start", {
        "board": room["board"],
        "turn": room["turn"],
        "scores": room["scores"],
    }, room=code)

    print(f"[WS] Гравець {request.sid} приєднався до кімнати {code} як {symbol}")


@socketio.on("online_move")
def on_online_move(data):
    code = data.get("room_code", "").upper().strip()
    row = data.get("row")
    col = data.get("col")

    if code not in rooms:
        emit("error", {"message": "Кімната не знайдена!"})
        return

    room = rooms[code]
    board = room["board"]
    turn = room["turn"]
    players = room["players"]

    # Перевірка: хід робить правильний гравець?
    if players.get(turn) != request.sid:
        emit("error", {"message": "Зараз не ваш хід!"})
        return

    if room["winner"]:
        emit("error", {"message": "Гра вже завершена!"})
        return

    if board[row][col] != EMPTY:
        emit("error", {"message": "Клітинка зайнята!"})
        return

    # Робимо хід
    board[row][col] = turn
    winner, win_line = check_winner(board)

    if winner:
        room["winner"] = winner
        room["win_line"] = win_line
        if winner in ("X", "O"):
            room["scores"][winner] += 1
        else:
            room["scores"]["draw"] += 1
    else:
        room["turn"] = O if turn == X else X

    emit("game_update", {
        "board": room["board"],
        "turn": room["turn"],
        "winner": room["winner"],
        "win_line": [[r, c] for r, c in room["win_line"]] if room["win_line"] else [],
        "last_move": {"row": row, "col": col, "symbol": turn},
        "scores": room["scores"],
    }, room=code)


@socketio.on("request_rematch")
def on_request_rematch(data):
    code = data.get("room_code", "").upper().strip()

    if code not in rooms:
        emit("error", {"message": "Кімната не знайдена!"})
        return

    room = rooms[code]

    # Ініціалізація rematch tracking
    if "rematch_requests" not in room:
        room["rematch_requests"] = set()

    room["rematch_requests"].add(request.sid)

    players = room["players"]

    # Сповіщаємо суперника про запит
    emit("rematch_requested", {
        "message": "Суперник хоче зіграти ще!"
    }, room=code, include_self=False)

    # Якщо обидва натиснули — нова гра
    if len(room["rematch_requests"]) >= 2:
        room["board"] = empty_board()
        room["turn"] = X
        room["winner"] = None
        room["win_line"] = []
        room["rematch_requests"] = set()

        emit("game_start", {
            "board": room["board"],
            "turn": room["turn"],
            "scores": room["scores"],
        }, room=code)


@socketio.on("leave_room_event")
def on_leave_room_event(data):
    code = data.get("room_code", "").upper().strip()
    if code in rooms:
        players = rooms[code].get("players", {})
        for symbol, sid in list(players.items()):
            if sid == request.sid:
                del players[symbol]
                break
        leave_room(code)
        emit("opponent_left", {"message": "Суперник покинув кімнату 😢"}, room=code)
        if not players:
            del rooms[code]


# ──────────────────────────────────────────────
#  Запуск
# ──────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port, debug=True)
