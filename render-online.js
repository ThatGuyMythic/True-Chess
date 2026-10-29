/* TRUE CHESS — real internet rooms for the existing game interface.
   Loaded AFTER game.js and tabletop-extras.js, BEFORE piece-inertia.js.
   Local practice remains local. Online mutations go to server.cjs.
*/
(() => {
    'use strict';
    if (window.__trueChessRenderOnlineInstalled) return;
    window.__trueChessRenderOnlineInstalled = true;
    if (typeof game === 'undefined' || typeof perform !== 'function' || typeof createRoom !== 'function') {
        throw new Error('Render online needs the latest standalone game.js from this project.');
    }
    const savedSeatKey = 'true-chess-render-seat-v1';
    const baseURL = new URL(window.TRUE_CHESS_SERVER_URL || location.origin);
    if (!['http:','https:'].includes(baseURL.protocol)) throw new Error('Online server URL must use HTTPS (or HTTP for localhost).');
    const apiBase = baseURL.origin;
    const localPerform = perform;
    const localLeaveRoom = leaveRoom;
    const localRefreshRoom = refreshRoom;
    const localRoomTransaction = roomTransaction;
    const localRenderHeader = renderHeader;
    const localHandleAction = handleAction;
    let connection = null;
    let commandQueue = Promise.resolve();
    let statusMessage = 'Not connected';
    const online = () => room?.network === 'render';

    function readSavedSeat() {
        try {
            const seat = JSON.parse(sessionStorage.getItem(savedSeatKey) || 'null');
            return seat && seat.server === apiBase && /^[A-Z2-9]{6}$/.test(seat.code)
                && ['white','black'].includes(seat.color) && /^[a-f0-9]{64}$/.test(seat.token) ? seat : null;
        } catch { return null; }
    }
    function saveSeat(seat) {
        try { sessionStorage.setItem(savedSeatKey, JSON.stringify({...seat,server:apiBase})); }
        catch { notify('Room works, but this browser cannot save your seat for refresh/reconnect.',true); }
    }
    function setStatus(message) {
        statusMessage = message;
        if (online()) {
            const line = document.querySelector('#connection');
            if (line) line.textContent = `ROOM ${room.code} · YOU: ${room.color.toUpperCase()} · ${message}`;
        }
    }
    async function request(path, body = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 90000);
        try {
            const response = await fetch(new URL(path,apiBase), {
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify(body), signal:controller.signal, cache:'no-store', credentials:'omit'
            });
            let data;
            try { data = await response.json(); }
            catch { throw new Error('The server did not return JSON. Check that this is a Render Web Service, not a Static Site.'); }
            if (!response.ok) { const error = new Error(data.error || 'Online request failed.'); error.status = response.status; throw error; }
            return data;
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('The server took too long to wake up. Wait a minute and try again.');
            throw error;
        } finally { clearTimeout(timer); }
    }

    // The old local-room heartbeat still exists in game.js. Give only that
    // legacy heartbeat an inert mirror: it cannot write the actual online room.
    // All real changes below travel through the authenticated WebSocket.
    roomTransaction = async function (code, change) {
        if (!online() || code !== room.code) return localRoomTransaction(code,change);
        const record = {code,state:structuredClone(game.state),history:[],revision:room.revision,
            seats:{[room.color]:{id:clientId,seen:Date.now()},[Y(room.color)]:{id:'online-opponent',seen:0}}};
        return change ? change(record) : record;
    };
    refreshRoom = async function (shot) {
        if (!online()) return localRefreshRoom(shot);
        if (connection?.ready) renderHeader();
    };
    renderHeader = function () {
        localRenderHeader();
        if (online()) setStatus(statusMessage);
    };

    function updateMenu() {
        document.querySelectorAll('[data-action="create-room"]').forEach(button => { button.textContent = 'Create online room'; });
        document.querySelectorAll('[data-action="join-room"]').forEach(button => { button.textContent = 'Join online room'; });
        const note = document.querySelector('.menu-note');
        if (note) note.textContent = 'Play with a friend on another computer using an online room code. Local practice is also available.';
        const buttons = document.querySelector('.menu-buttons');
        if (buttons && !buttons.querySelector('[data-online-action="resume"]')) {
            const button = document.createElement('button');
            button.dataset.onlineAction = 'resume';
            button.textContent = 'Return to online room';
            buttons.append(button);
        }
        document.querySelectorAll('[data-online-action="resume"]').forEach(button => { button.hidden = !readSavedSeat(); });
    }
    function releaseConnection(message = 'Left room') {
        const previous = connection;
        connection = null;
        if (!previous) return;
        previous.stopped = true;
        clearTimeout(previous.reconnectTimer);
        clearInterval(previous.retryTimer);
        previous.socket?.close(1000,'Leaving room');
        if (previous.pending) previous.pending.resolve(false);
        previous.pending = null;
        busy = false;
        statusMessage = message;
    }
    leaveRoom = async function () {
        if (!online()) return localLeaveRoom();
        releaseConnection();
        room = null;
        busy = false;
    };
    function installSeat(seat) {
        releaseConnection();
        saveSeat(seat);
        room = {code:seat.code,color:seat.color,revision:-1,network:'render'};
        connection = {seat,socket:null,ready:false,stopped:false,retries:0,pending:null,
            reconnectTimer:null,retryTimer:null,generation:crypto.randomUUID()};
        selectedId = null;
        mode = 'move';
        pendingObject = null;
        terrainSelection = [];
        busy = true;
        closeAllWindows();
        document.querySelector('#menu').hidden = true;
        setStatus('Connecting…');
        connectSocket(connection);
        updateMenu();
    }
    function failConnection(current,message) {
        if (connection !== current) return;
        current.stopped = true;
        current.ready = false;
        clearTimeout(current.reconnectTimer);
        clearInterval(current.retryTimer);
        current.socket?.close();
        if (current.pending) current.pending.resolve(false);
        current.pending = null;
        busy = true;
        setStatus(message);
        notify(message,true);
        renderHeader();
    }
    function receiveSnapshot(current,message) {
        if (connection !== current || current.stopped || !online() || message.code !== room.code) return;
        if (!message.state?.pieces || message.you !== room.color || !Number.isInteger(message.revision)) return;
        const first = !current.ready;
        const oldTurn = game.state.turn;
        const changed = room.revision !== message.revision;
        if (changed) {
            game = new TrueChessGame(message.state);
            room.revision = message.revision;
            if (!selectedPiece()?.alive && mode !== 'return') selectedId = null;
        }
        current.ready = true;
        current.retries = 0;
        const pending = current.pending;
        const answered = pending && message.requestId === pending.requestId;
        if (first || oldTurn !== game.state.turn || (answered && message.accepted && !pending.method.startsWith('tabletop-'))) {
            mode = 'move'; terrainSelection = []; pendingObject = null;
            if (oldTurn !== game.state.turn) selectedId = null;
        }
        if (answered) {
            current.pending = null;
            busy = false;
            pending.resolve(message.accepted === true);
        } else if (!current.pending) busy = false;
        setStatus(message.connected?.[Y(room.color)] ? 'Opponent connected' : 'Waiting for opponent');
        if (changed || first || answered) render();
        else renderHeader();
        if (message.notice && (answered || message.method === 'wheel-result')) notify(message.notice,message.accepted === false);
        if (message.shot && changed) animateProjectile(message.shot);
        // If the connection dropped after the server applied a command but before
        // its reply arrived, replay the SAME request ID. Server deduplication
        // acknowledges it without applying it a second time.
        if (first && current.pending) sendPending(current);
    }
    function sendPending(current) {
        if (current !== connection || !current.ready || !current.pending || current.socket?.readyState !== WebSocket.OPEN) return;
        const pending = current.pending;
        pending.lastSent = Date.now();
        pending.sends++;
        current.socket.send(JSON.stringify({type:'command',method:pending.method,args:pending.args,
            revision:pending.revision,requestId:pending.requestId}));
    }
    function connectSocket(current) {
        if (connection !== current || current.stopped) return;
        const address = new URL(`/api/rooms/${current.seat.code}/socket`,apiBase);
        address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:';
        address.searchParams.set('token',current.seat.token);
        const socket = new WebSocket(address);
        current.socket = socket;
        current.ready = false;
        busy = true;
        setStatus(current.retries ? 'Reconnecting…' : 'Connecting…');
        renderHeader();
        socket.onmessage = event => {
            if (current !== connection || socket !== current.socket) return;
            let message;
            try { message = JSON.parse(event.data); } catch { return; }
            if (message.type === 'snapshot') receiveSnapshot(current,message);
            else if (message.type === 'error') notify(message.message || 'Online error.',true);
        };
        socket.onerror = () => {};
        socket.onclose = async event => {
            if (current !== connection || current.stopped || socket !== current.socket) return;
            current.ready = false;
            busy = true;
            if (event.code === 4001) { failConnection(current,'Your seat was opened in another tab. Use Return to online room to reclaim it.'); return; }
            setStatus('Disconnected — reconnecting. Board changes are paused.');
            renderHeader();
            current.retries++;
            if (current.retries % 3 === 0) {
                try { await request(`/api/rooms/${current.seat.code}/resume`,{token:current.seat.token}); }
                catch (error) {
                    if ([403,404].includes(error.status)) { failConnection(current,error.message); return; }
                }
                if (current !== connection || current.stopped) return;
            }
            current.reconnectTimer = setTimeout(() => connectSocket(current),Math.min(12000,700 * 2 ** Math.min(current.retries,4)));
        };
        if (!current.retryTimer) current.retryTimer = setInterval(() => {
            if (current !== connection || current.stopped) return;
            if (current.ready && current.pending && Date.now() - current.pending.lastSent > 7000) {
                if (current.pending.sends > 4) current.socket?.close();
                else sendPending(current);
            }
        },1000);
    }

    createRoom = async function () {
        try {
            notify('Creating online room. A sleeping free server may need a minute to wake up.');
            const seat = await request('/api/rooms');
            await leaveRoom();
            installSeat(seat);
        } catch (error) { notify(error.message,true); }
    };
    openJoinRoom = function (initialCode = '') {
        const panel = floatingWindow('Join online room', `
            <p>Enter the room code from your friend. This works across different computers.</p>
            <label>Room code<input id="online-code" maxlength="6" autocomplete="off" value="${escapeHTML(initialCode)}"></label>
            <p class="field-error" id="online-error"></p>`,
            '<button id="online-join" class="primary">Join as Black</button>',false,'join-room');
        if (!panel) return;
        const button = panel.querySelector('#online-join');
        const join = async () => {
            const code = panel.querySelector('#online-code').value.trim().toUpperCase();
            if (!/^[A-Z2-9]{6}$/.test(code)) { panel.querySelector('#online-error').textContent = 'Enter a six-character room code.'; return; }
            button.disabled = true; button.textContent = 'Connecting…';
            try {
                const saved = readSavedSeat();
                let seat;
                if (saved?.code === code) {
                    await request(`/api/rooms/${code}/resume`,{token:saved.token}); seat = saved;
                } else seat = await request(`/api/rooms/${code}/join`);
                await leaveRoom();
                installSeat(seat);
            } catch (error) {
                panel.querySelector('#online-error').textContent = error.message;
                button.disabled = false; button.textContent = 'Join as Black';
            }
        };
        button.onclick = join;
        panel.querySelector('#online-code').onkeydown = event => { if (event.key === 'Enter') join(); };
    };
    async function resumeRoom() {
        const seat = readSavedSeat();
        if (!seat) return notify('No saved online seat in this tab. Join using a room code.',true);
        try {
            await request(`/api/rooms/${seat.code}/resume`,{token:seat.token});
            await leaveRoom(); installSeat(seat);
        } catch (error) {
            notify(error.message,true);
            if ([403,404].includes(error.status)) { try { sessionStorage.removeItem(savedSeatKey); } catch {} updateMenu(); }
        }
    }
    perform = function (method,args = [],shot = null) {
        if (!online()) return localPerform(method,args,shot);
        const expectedConnection = connection;
        commandQueue = commandQueue.then(() => {
            const current = connection;
            if (current !== expectedConnection || !current?.ready || current.stopped || current.socket?.readyState !== WebSocket.OPEN) {
                notify('Not connected. Wait for reconnection or use Return to online room.',true);
                return false;
            }
            return new Promise(resolve => {
                busy = true;
                current.pending = {method,args,requestId:crypto.randomUUID(),revision:room.revision,
                    resolve,lastSent:0,sends:0};
                sendPending(current);
                renderHeader();
            });
        }).catch(error => { notify(error.message,true); busy = false; return false; });
        return commandQueue;
    };
    function onlineRoomInfo() {
        if (!online()) return notify('Create or join an online room from the main menu.');
        const invite = new URL('/',apiBase); invite.searchParams.set('room',room.code);
        const panel = floatingWindow(`Online room ${room.code}`, `
            <p>You play ${v(room.color)}. ${escapeHTML(statusMessage)}.</p>
            <p>Share the code, not your private player token.</p>
            <label>Room code<input id="online-share-code" readonly value="${room.code}"></label>
            <label>Invite link<input id="online-share-link" readonly value="${escapeHTML(invite.href)}"></label>
            <p>Seats are saved in this tab. Refresh, then use Return to online room. Server restarts erase test rooms.</p>
            <p id="online-copy-status"></p>`,
            `<button id="online-copy">Copy invite</button>${room.color === 'white' ? '<button id="online-reset">Reset room match</button>' : ''}`,
            false,'online-room-info');
        if (!panel) return;
        panel.querySelector('#online-copy').onclick = async () => {
            try { await navigator.clipboard.writeText(invite.href); panel.querySelector('#online-copy-status').textContent = 'Invite copied.'; }
            catch { panel.querySelector('#online-share-link').select(); panel.querySelector('#online-copy-status').textContent = 'Select and copy the invite link manually.'; }
        };
        panel.querySelector('#online-reset')?.addEventListener('click',() => {
            closeWindow(panel);
            const confirmation = floatingWindow('Reset this online match?', '<p>This resets the shared board and decorations for both players. Undo is available afterward.</p>',
                '<button id="online-reset-confirm" class="primary">Reset shared match</button>',false,'online-reset');
            if (confirmation) confirmation.querySelector('#online-reset-confirm').onclick = async () => {
                if (await perform('replay')) closeWindow(confirmation);
            };
        });
    }
    handleAction = function (action) {
        if (action === 'room-info') return onlineRoomInfo();
        return localHandleAction(action);
    };
    document.addEventListener('click',event => {
        const button = event.target.closest('[data-online-action="resume"]');
        if (!button) return;
        event.preventDefault(); event.stopImmediatePropagation(); resumeRoom();
    },true);
    updateMenu();
    const invitation = new URL(location.href).searchParams.get('room')?.toUpperCase();
    if (invitation && /^[A-Z2-9]{6}$/.test(invitation)) openJoinRoom(invitation);
})();
