/* ============================================
   Хрестики-Нолики — Клієнтська логіка
   (PvP, PvE, Online через Socket.IO)
   ============================================ */

// ── Стан гри ─────────────────────────────
let currentMode = "pvp";   // "pvp" | "pve" | "online"
let gameOver = false;
let currentTurn = "X";
let boardState = [["","",""],["","",""],["","",""]];

// Лічильник
let scores = { X: 0, O: 0, draw: 0 };

// Онлайн стан
let socket = null;
let mySymbol = null;     // "X" або "O" в онлайн грі
let roomCode = null;
let rematchRequested = false;

// ── DOM-елементи ─────────────────────────
const menuEl          = document.getElementById("menu");
const gameEl          = document.getElementById("game");
const boardEl         = document.getElementById("board");
const statusEl        = document.getElementById("status");
const modeBadgeEl     = document.getElementById("mode-badge");
const resultOverlay   = document.getElementById("result-overlay");
const resultEmoji     = document.getElementById("result-emoji");
const resultText      = document.getElementById("result-text");
const rematchStatusEl = document.getElementById("rematch-status");
const onlineLobby     = document.getElementById("online-lobby");
const lobbyCreate     = document.getElementById("lobby-create");
const lobbyJoin       = document.getElementById("lobby-join");
const lobbyStatus     = document.getElementById("lobby-status");
const lobbySpinner    = document.getElementById("lobby-spinner");
const roomCodeText    = document.getElementById("room-code-text");
const joinCodeInput   = document.getElementById("join-code-input");
const joinError       = document.getElementById("join-error");
const onlineInfo      = document.getElementById("online-info");
const yourSymbolEl    = document.getElementById("your-symbol");
const onlineRoomCodeEl = document.getElementById("online-room-code");
const toastEl         = document.getElementById("toast");


// ══════════════════════════════════════════
//  Socket.IO — ініціалізація
// ══════════════════════════════════════════

function initSocket() {
    if (socket && socket.connected) return;

    socket = io({
        transports: ["websocket", "polling"],
    });

    // ── Кімната створена ──
    socket.on("room_created", (data) => {
        roomCode = data.room_code;
        mySymbol = data.symbol;
        roomCodeText.textContent = data.room_code;
        lobbyStatus.textContent = "⏳ Чекаємо суперника…";
        lobbySpinner.classList.add("active");
    });

    // ── Приєднався до кімнати ──
    socket.on("room_joined", (data) => {
        roomCode = data.room_code;
        mySymbol = data.symbol;
        showToast(data.message, "success");
    });

    // ── Гра починається ──
    socket.on("game_start", (data) => {
        boardState = data.board;
        currentTurn = data.turn;
        gameOver = false;
        rematchRequested = false;

        scores = data.scores || scores;
        updateScoreboard();

        // Переходимо з лобі на ігровий екран
        hideAll();
        gameEl.classList.remove("hidden");
        resultOverlay.classList.add("hidden");
        rematchStatusEl.classList.add("hidden");

        currentMode = "online";
        modeBadgeEl.textContent = "🌐 Online";
        onlineInfo.classList.remove("hidden");
        yourSymbolEl.textContent = `Ви: ${mySymbol === "X" ? "✕" : "◯"} (${mySymbol})`;
        yourSymbolEl.className = `your-symbol ${mySymbol === "X" ? "sym-x" : "sym-o"}`;
        onlineRoomCodeEl.textContent = `Кімната: ${roomCode}`;

        buildBoard();
        updateStatus();
        showToast("Гра почалася! 🎮", "success");
    });

    // ── Оновлення гри ──
    socket.on("game_update", (data) => {
        boardState = data.board;
        currentTurn = data.turn;
        gameOver = !!data.winner;

        if (data.scores) {
            scores = data.scores;
            updateScoreboard();
        }

        renderBoard(data.win_line || []);
        updateStatus();

        if (data.winner) {
            showResult(data.winner);
        }
    });

    // ── Суперник попросив реванш ──
    socket.on("rematch_requested", (data) => {
        showToast("Суперник хоче зіграти ще! 🔄", "info");
        rematchStatusEl.textContent = "Суперник хоче зіграти ще!";
        rematchStatusEl.classList.remove("hidden");
    });

    // ── Суперник від'єднався ──
    socket.on("opponent_left", (data) => {
        showToast(data.message, "error");
        gameOver = true;
        statusEl.textContent = "Суперник від'єднався";
        statusEl.classList.remove("turn-x", "turn-o");
    });

    // ── Помилка ──
    socket.on("error", (data) => {
        showToast(data.message, "error");
        if (joinError) {
            joinError.textContent = data.message;
            joinError.classList.remove("hidden");
        }
    });
}


// ══════════════════════════════════════════
//  Онлайн лобі
// ══════════════════════════════════════════

function showOnlineMenu(type) {
    initSocket();
    hideAll();
    onlineLobby.classList.remove("hidden");
    lobbyCreate.classList.add("hidden");
    lobbyJoin.classList.add("hidden");
    joinError.classList.add("hidden");

    if (type === "create") {
        lobbyCreate.classList.remove("hidden");
        socket.emit("create_room");
    } else {
        lobbyJoin.classList.remove("hidden");
        joinCodeInput.value = "";
        joinCodeInput.focus();
    }
}

function joinRoom() {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (code.length < 3) {
        joinError.textContent = "Введіть код кімнати!";
        joinError.classList.remove("hidden");
        return;
    }
    joinError.classList.add("hidden");
    socket.emit("join_room", { room_code: code });
}

function copyRoomCode() {
    if (roomCode) {
        navigator.clipboard.writeText(roomCode).then(() => {
            showToast("Код скопійовано! 📋", "success");
        });
    }
}

// Enter для підключення
document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !lobbyJoin.classList.contains("hidden")) {
        joinRoom();
    }
});


// ══════════════════════════════════════════
//  Локальні режими (PvP / PvE)
// ══════════════════════════════════════════

async function startGame(mode) {
    currentMode = mode;

    const res = await fetch("/api/new_game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
    });
    const data = await res.json();

    boardState = data.board;
    currentTurn = data.current_turn;
    gameOver = false;

    hideAll();
    gameEl.classList.remove("hidden");
    resultOverlay.classList.add("hidden");
    onlineInfo.classList.add("hidden");
    modeBadgeEl.textContent = mode === "pvp" ? "👥 PvP" : "🤖 PvE";

    buildBoard();
    updateStatus();
}


// ══════════════════════════════════════════
//  Дошка та ходи
// ══════════════════════════════════════════

function buildBoard() {
    boardEl.innerHTML = "";
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            const cell = document.createElement("div");
            cell.classList.add("cell");
            cell.dataset.row = r;
            cell.dataset.col = c;
            cell.addEventListener("click", () => onCellClick(r, c));
            boardEl.appendChild(cell);
        }
    }
}

async function onCellClick(row, col) {
    if (gameOver) return;
    if (boardState[row][col] !== "") return;

    // ── Онлайн хід ──
    if (currentMode === "online") {
        if (currentTurn !== mySymbol) return; // не мій хід
        socket.emit("online_move", { room_code: roomCode, row, col });
        return;
    }

    // ── PvE — блокуємо під час ходу AI ──
    if (currentMode === "pve" && currentTurn === "O") return;

    // ── Локальний хід (PvP/PvE) ──
    const res = await fetch("/api/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row, col }),
    });

    if (!res.ok) return;
    const data = await res.json();

    boardState = data.board;
    currentTurn = data.current_turn;
    gameOver = data.game_over;

    renderBoard(data.win_line || []);
    updateStatus();

    if (data.winner) {
        showResult(data.winner);
    }
}


// ══════════════════════════════════════════
//  Рендеринг
// ══════════════════════════════════════════

function renderBoard(winLine = []) {
    const cells = boardEl.querySelectorAll(".cell");
    const winSet = new Set(winLine.map(([r, c]) => `${r}-${c}`));

    cells.forEach(cell => {
        const r = +cell.dataset.row;
        const c = +cell.dataset.col;
        const val = boardState[r][c];

        cell.textContent = val === "X" ? "✕" : val === "O" ? "◯" : "";
        cell.classList.remove("x", "o", "taken", "game-over", "winner-cell");

        if (val === "X") cell.classList.add("x", "taken");
        if (val === "O") cell.classList.add("o", "taken");
        if (gameOver) cell.classList.add("game-over");
        if (winSet.has(`${r}-${c}`)) cell.classList.add("winner-cell");
    });
}

function updateStatus() {
    if (gameOver) return;

    if (currentMode === "online") {
        const isMy = currentTurn === mySymbol;
        statusEl.textContent = isMy ? "Ваш хід!" : "Хід суперника…";
    } else {
        statusEl.textContent = `Хід: ${currentTurn}`;
    }

    statusEl.classList.remove("turn-x", "turn-o");
    statusEl.classList.add(currentTurn === "X" ? "turn-x" : "turn-o");
}


// ══════════════════════════════════════════
//  Результат
// ══════════════════════════════════════════

function showResult(winner) {
    if (winner === "draw") {
        resultEmoji.textContent = "🤝";
        resultText.textContent = "Нічия!";
        resultText.style.color = "";
        scores.draw++;
    } else if (winner === "X") {
        resultEmoji.textContent = "🎉";
        resultText.style.color = "var(--color-x)";
        scores.X++;
        if (currentMode === "online") {
            resultText.textContent = mySymbol === "X" ? "Ви перемогли! 🏆" : "Суперник переміг!";
        } else if (currentMode === "pve") {
            resultText.textContent = "Ви перемогли!";
        } else {
            resultText.textContent = "Переміг X!";
        }
    } else {
        resultEmoji.textContent = currentMode === "pve" ? "🤖" : "🎉";
        resultText.style.color = "var(--color-o)";
        scores.O++;
        if (currentMode === "online") {
            resultText.textContent = mySymbol === "O" ? "Ви перемогли! 🏆" : "Суперник переміг!";
        } else if (currentMode === "pve") {
            resultText.textContent = "Комп'ютер переміг!";
        } else {
            resultText.textContent = "Переміг O!";
        }
    }

    // Не оновлюємо scoreboard для online — scores приходять із сервера
    if (currentMode !== "online") {
        updateScoreboard();
    }

    setTimeout(() => {
        resultOverlay.classList.remove("hidden");
    }, 400);

    statusEl.textContent = winner === "draw" ? "Нічия!" : `Переміг ${winner}!`;
    statusEl.classList.remove("turn-x", "turn-o");
}


// ══════════════════════════════════════════
//  Управління
// ══════════════════════════════════════════

function restartGame() {
    resultText.style.color = "";
    rematchStatusEl.classList.add("hidden");

    if (currentMode === "online") {
        if (!rematchRequested) {
            socket.emit("request_rematch", { room_code: roomCode });
            rematchRequested = true;
            rematchStatusEl.textContent = "Чекаємо згоди суперника… ⏳";
            rematchStatusEl.classList.remove("hidden");
            showToast("Запит на реванш відправлено! ⏳", "info");
        }
        return;
    }

    startGame(currentMode);
}

function backToMenu() {
    resultText.style.color = "";

    // Якщо в онлайн грі — покинути кімнату
    if (currentMode === "online" && socket && roomCode) {
        socket.emit("leave_room_event", { room_code: roomCode });
        roomCode = null;
        mySymbol = null;
    }

    hideAll();
    menuEl.classList.remove("hidden");
    scores = { X: 0, O: 0, draw: 0 };
    updateScoreboard();
    currentMode = "pvp";
}

function hideAll() {
    menuEl.classList.add("hidden");
    gameEl.classList.add("hidden");
    onlineLobby.classList.add("hidden");
    resultOverlay.classList.add("hidden");
}


// ══════════════════════════════════════════
//  Scoreboard & Toast
// ══════════════════════════════════════════

function updateScoreboard() {
    document.getElementById("score-x").textContent = scores.X;
    document.getElementById("score-o").textContent = scores.O;
    document.getElementById("score-draw").textContent = scores.draw;
}

let toastTimeout = null;

function showToast(message, type = "info") {
    toastEl.textContent = message;
    toastEl.className = `toast toast-${type}`;
    toastEl.classList.remove("hidden");

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toastEl.classList.add("hidden");
    }, 3500);
}
