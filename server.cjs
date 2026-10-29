/* TRUE CHESS — Render web service and authoritative WebSocket room server.
   Run: npm install && npm start
   This service serves the existing game files AND the online room endpoint.
   Active rooms are in memory. Restarts erase them; do not mistake this for
   permanent storage. See READ-ME-FIRST.md before publishing.
*/
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {WebSocketServer, WebSocket} = require('ws');
const {TrueChessGame, inside} = require('./engine.cjs');

const ROOT = __dirname;
const PORT = Number(process.env.PORT ?? 3000);
const MAX_MESSAGE = 1100 * 1024;
const MAX_STATE = 2 * 1024 * 1024;
const MAX_HISTORY_BYTES = 6 * 1024 * 1024;
const MAX_ROOMS = 20;
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const ROOM_IDLE_MS = 2 * 60 * 60 * 1000;
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
const rooms = new Map();
const httpRates = new Map();
const colors = ['white', 'black'];

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected an object.'); return value; }
function text(value, maximum, required = true) {
    if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) fail(`Invalid text (maximum ${maximum} characters).`);
    return value.trim();
}
function integer(value, minimum, maximum) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) fail(`Expected a whole number from ${minimum} to ${maximum}.`);
    return value;
}
function number(value, minimum, maximum) {
    if (!Number.isFinite(value) || value < minimum || value > maximum) fail(`Expected a number from ${minimum} to ${maximum}.`);
    return value;
}
function color(value) { if (!/^#[0-9a-f]{6}$/i.test(String(value))) fail('Invalid color.'); return value.toLowerCase(); }
function position(value) { object(value); if (!inside(value)) fail('Position is outside the board boundary.'); return {row:value.row, col:value.col}; }
function positions(value, maximum = 256) {
    if (!Array.isArray(value) || !value.length || value.length > maximum) fail('Select a valid number of tiles.');
    return value.map(position);
}
function id(value) { return text(value, 100); }
function artwork(value) {
    if (typeof value !== 'string' || value.length > 900000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) fail('Artwork must be a PNG produced by the drawing editor (under 900 KB encoded).');
    const bytes = Buffer.from(value.split(',')[1], 'base64');
    if (bytes.length < 24 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') fail('Invalid PNG artwork.');
    if (bytes.readUInt32BE(16) > 1024 || bytes.readUInt32BE(20) > 1024 || !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20)) fail('Artwork dimensions are too large.');
    return value;
}
function safeEqual(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const a = Buffer.from(left), b = Buffer.from(right);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function seatForToken(room, token) { return colors.find(color => safeEqual(room.seats[color]?.token, token)); }
function token() { return crypto.randomBytes(32).toString('hex'); }
function originAllowed(request) {
    const origin = request.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === request.headers.host || allowedOrigins.has(origin); }
    catch { return false; }
}
function limitHttp(request) {
    const address = String(request.headers['x-forwarded-for'] || request.socket.remoteAddress).split(',')[0].trim();
    const now = Date.now();
    let bucket = httpRates.get(address);
    if (!bucket || now - bucket.start > 60000) { bucket = {start:now, count:0}; httpRates.set(address, bucket); }
    if (++bucket.count > 60) fail('Too many room requests. Wait a minute.', 429);
}
function json(response, status, value) {
    response.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
    response.end(JSON.stringify(value));
}
async function readBody(request) {
    if (!String(request.headers['content-type'] || '').startsWith('application/json')) fail('Use application/json.', 415);
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
        size += chunk.length;
        if (size > 16384) fail('Request is too large.', 413);
        chunks.push(chunk);
    }
    try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
    catch { fail('Invalid JSON.'); }
}
function newCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do { code = Array.from(crypto.randomBytes(6), value => alphabet[value % alphabet.length]).join(''); } while (rooms.has(code));
    return code;
}
function roomBytes(room) { return room.stateBytes * 2 + room.history.reduce((sum, buffer) => sum + buffer.length, 0); }
function capacity(extraBytes = 0) {
    return [...rooms.values()].reduce((sum, room) => sum + roomBytes(room), extraBytes) <= MAX_TOTAL_BYTES;
}
function send(peer, data) {
    if (peer.readyState !== WebSocket.OPEN) return;
    if (peer.bufferedAmount > 6 * 1024 * 1024) { peer.close(1013, 'Connection too slow; reconnect for the latest board.'); return; }
    peer.send(JSON.stringify(data));
}
function snapshot(room, peer, extra = {}) {
    send(peer, {type:'snapshot', code:room.code, you:peer.color, revision:room.revision,
        state:room.state, connected:{white:room.sockets.white?.readyState === WebSocket.OPEN,
        black:room.sockets.black?.readyState === WebSocket.OPEN}, ...extra});
}
function broadcast(room, extra = {}) { for (const peer of Object.values(room.sockets)) if (peer) snapshot(room, peer, extra); }

// All public commands are rebuilt from allowed fields, never applied as client snapshots.
function sanitizeCommand(engine, method, args, actingColor) {
    if (!Array.isArray(args) || args.length > 4) fail('Invalid command arguments.');
    switch (method) {
        case 'move': case 'reposition': case 'resurrect': return [id(args[0]), position(args[1])];
        case 'attack': return [id(args[0]), position(args[1]), args[2] === true];
        case 'transform': {
            const proposal = object(args[1]);
            const result = {name:text(proposal.name,48), description:text(proposal.description,2500),
                artwork:artwork(proposal.artwork), projectile:proposal.projectile === true,
                keepStatuses:proposal.keepStatuses !== false};
            result.signature = JSON.stringify({name:result.name, description:result.description, projectile:result.projectile});
            return [id(args[0]), result];
        }
        case 'edit': {
            const pieceId = id(args[0]), edit = object(args[1]);
            if (!Array.isArray(edit.statuses) || edit.statuses.length > 24) fail('Use at most 24 named statuses.');
            const existingPiece = engine.piece(pieceId);
            const statusNames = new Set();
            const statuses = edit.statuses.map(entry => {
                object(entry);
                const name = text(entry.name,80), remaining = integer(entry.remaining,0,3);
                if (statusNames.has(name.toLowerCase())) fail('Use each status name only once.');
                statusNames.add(name.toLowerCase());
                const previous = existingPiece?.statuses.find(status => status.name.toLowerCase() === name.toLowerCase());
                const unchangedDuration = previous?.remaining === remaining;
                const result = {name, remaining, exposed:previous?.exposed || false,
                    clock:unchangedDuration ? previous.clock : engine.state.current,
                    color:color(entry.color || previous?.color || '#9b69c8')};
                if (unchangedDuration && Array.isArray(previous.sourceClocks)) result.sourceClocks = structuredClone(previous.sourceClocks);
                return result;
            });
            return [pieceId, {...position(edit), hp:integer(edit.hp,0,100), shields:integer(edit.shields,0,99), statuses}];
        }
        case 'remove': return [id(args[0])];
        case 'promote': {
            if (!['queen','rook','bishop','knight'].includes(args[1])) fail('Invalid promotion type.');
            return [id(args[0]), args[1]];
        }
        case 'castle': return [id(args[0]), id(args[1])];
        case 'terrainAction': {
            if (!['floor','mountain','hole'].includes(args[0])) fail('Invalid terrain.');
            return [args[0], positions(args[1],8)];
        }
        case 'paintTiles': return [positions(args[0]), args[1] === null ? null : color(args[1])];
        case 'setAppearance': return [{background:color(object(args[0]).background)}];
        case 'createObject': {
            const proposal = object(args[0]);
            const collectible = proposal.collectible === true;
            let statusName = text(proposal.statusName || '',80,false);
            if (statusName === '__TRUE_CHESS_NO_STATUS__' || collectible) statusName = '';
            const result = {...position(proposal), name:text(proposal.name,48), description:text(proposal.description,2500),
                artwork:artwork(proposal.artwork), collectible, consumable:collectible && proposal.consumable === true,
                resurrection:collectible && proposal.resurrection === true,
                uses:integer(proposal.uses ?? 1,1,3), radius:integer(proposal.radius ?? 0,0,2),
                statusName, statusColor:color(proposal.statusColor || '#9b69c8'),
                lingering:integer(proposal.lingering ?? 1,0,3), onDestroy:!collectible && proposal.onDestroy === true};
            result.durationCycles = !collectible && statusName ? Math.max(1,result.lingering) : 1;
            return [result, JSON.stringify({name:result.name,description:result.description,statusName})];
        }
        case 'useItem': return [integer(args[0],0,2)];
        case 'surrender': if (args[0] !== actingColor) fail('You may surrender only your own side.'); return [actingColor];
        case 'wheel-result': return [text(args[0],60)];
        case 'skip': case 'draw': case 'undo': case 'replay': return [];
        case 'tabletop-add': return [sanitizeDecoration(object(args[0]), false)];
        case 'tabletop-update': return [id(args[0]), sanitizeDecoration(object(args[1]), true)];
        case 'tabletop-delete': return [id(args[0])];
        default: fail('Unknown command.');
    }
}
function sanitizeDecoration(value, patch) {
    const result = {};
    function copy(key, validator, defaultValue) {
        if (Object.hasOwn(value,key)) result[key] = validator(value[key]);
        else if (!patch) result[key] = defaultValue;
    }
    if (!patch) {
        if (!['text','prop'].includes(value.kind)) fail('Invalid decoration type.');
        result.kind = value.kind;
        result.id = crypto.randomUUID();
        if (result.kind === 'prop') result.artwork = artwork(value.artwork);
    }
    copy('title', v => text(v,80,false), value.kind === 'prop' ? 'Prop' : 'Text');
    copy('text', v => { if (typeof v !== 'string' || v.length > 10000) fail('Text block is too long.'); return v; }, '');
    copy('x', v => number(v,0,5000), 90);
    copy('y', v => number(v,0,5000), 110);
    copy('width', v => number(v,100,1400), 280);
    copy('height', v => number(v,80,1200), 210);
    copy('fontSize', v => number(v,10,80), 18);
    copy('color', color, '#eee4c9');
    copy('background', color, '#292929');
    copy('frame', v => v === true, false);
    return result;
}
function execute(engine, method, args) {
    if (method.startsWith('tabletop-')) {
        return engine.commit(() => {
            const list = engine.state.tabletopItems;
            if (method === 'tabletop-add') {
                if (list.length >= 60) return {ok:false,message:'Remove a decoration first: the limit is 60.'};
                list.push(args[0]);
            } else {
                const index = list.findIndex(item => item.id === args[0]);
                if (index < 0) return {ok:false,message:'That decoration no longer exists.'};
                if (method === 'tabletop-delete') list.splice(index,1);
                else list[index] = {...list[index], ...args[1]};
            }
            return {ok:true,message:'Decoration updated. No action spent.'};
        });
    }
    if (method === 'wheel-result') return engine.commit(() => {
        engine.log(`Wheel: ${args[0]}`); return {ok:true,message:`Wheel: ${args[0]}`};
    });
    return engine[method](...args);
}
function handleCommand(room, peer, raw) {
    const now = Date.now();
    if (now - peer.rateStart > 1000) { peer.rateStart = now; peer.rateCount = 0; }
    if (++peer.rateCount > 20) { peer.close(1008,'Too many commands.'); return; }
    let message;
    try { message = object(JSON.parse(raw.toString('utf8'))); }
    catch { send(peer,{type:'error',message:'Invalid command JSON.'}); return; }
    const requestId = typeof message.requestId === 'string' && /^[a-f0-9-]{36}$/i.test(message.requestId) ? message.requestId : null;
    if (!requestId) { send(peer,{type:'error',message:'A valid request ID is required.'}); return; }
    try {
        if (room.sockets[peer.color] !== peer) fail('This seat is open in another tab.');
        const cacheKey = `${peer.color}:${requestId}`;
        if (room.processed.has(cacheKey)) {
            snapshot(room,peer,{requestId,accepted:true,actor:peer.color,method:room.processed.get(cacheKey)});
            return;
        }
        const method = text(message.method,40);
        const freelyShared = method.startsWith('tabletop-') || ['undo','wheel-result','replay'].includes(method);
        if (method === 'replay' && peer.color !== 'white') fail('Only the room creator can reset the match.');
        if (!freelyShared && room.state.current !== peer.color) fail('Wait for your turn.');
        // Decoration changes merge onto the latest state. Board changes must match
        // the revision the player actually saw, preventing accidental double moves.
        if (!method.startsWith('tabletop-') && message.revision !== room.revision) fail('The board changed. Review the updated board and try again.');
        const before = JSON.stringify(room.state);
        let nextState, history = room.history.slice(), notice, shot = null;
        if (method === 'undo') {
            sanitizeCommand(new TrueChessGame(room.state),method,message.args,peer.color);
            if (!history.length) fail('Nothing to undo.');
            nextState = JSON.parse(zlib.gunzipSync(history.pop()).toString('utf8'));
            notice = 'Previous change restored.';
        } else if (method === 'replay') {
            sanitizeCommand(new TrueChessGame(room.state),method,message.args,peer.color);
            nextState = new TrueChessGame().state;
            notice = 'New online match started.';
            history.push(zlib.gzipSync(before));
        } else {
            const engine = new TrueChessGame(structuredClone(room.state));
            const args = sanitizeCommand(engine,method,message.args,peer.color);
            if (method === 'attack' && args[2]) {
                const piece = engine.piece(args[0]);
                if (piece) shot = {from:{row:piece.row,col:piece.col},to:args[1]};
            }
            const result = execute(engine,method,args);
            if (!result.ok) fail(result.message);
            nextState = engine.state;
            notice = result.message;
            history.push(zlib.gzipSync(before));
        }
        while (history.length > 25 || history.reduce((sum,buffer) => sum + buffer.length,0) > MAX_HISTORY_BYTES) history.shift();
        const nextBytes = Buffer.byteLength(JSON.stringify(nextState));
        if (nextBytes > MAX_STATE) fail('This room has reached its artwork/state size limit. Remove a prop or use simpler artwork.');
        const oldBytes = roomBytes(room);
        const newBytes = nextBytes * 2 + history.reduce((sum,buffer) => sum + buffer.length,0);
        if (!capacity(newBytes - oldBytes)) fail('Server memory allowance is full. Try again after inactive rooms close.');
        room.state = nextState; room.stateBytes = nextBytes; room.history = history;
        room.revision++; room.lastActive = now;
        room.processed.set(cacheKey,method);
        if (room.processed.size > 256) room.processed.delete(room.processed.keys().next().value);
        broadcast(room,{requestId,accepted:true,actor:peer.color,method,notice,shot});
    } catch (error) {
        snapshot(room,peer,{requestId,accepted:false,notice:error.message});
    }
}

const staticScripts = new Set(['index.js','game.js','piece-inertia.js','tabletop-extras.js','render-online.js']);
const mimeTypes = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
    '.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon',
    '.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.woff2':'font/woff2'};
async function serveStatic(request,response,pathname) {
    if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { response.writeHead(400); response.end(); return; }
    const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
    if (relative.split('/').some(part => !part || part.startsWith('.') || part === 'node_modules') || relative.includes('\\')) { response.writeHead(404); response.end(); return; }
    const filename = path.resolve(ROOT,relative), extension = path.extname(filename).toLowerCase();
    const publicFile = extension === '.js' ? staticScripts.has(relative)
        : extension === '.html' ? ['index.html','game.html'].includes(relative)
        : extension === '.css' ? ['game.css','tabletop-extras.css'].includes(relative)
        : Object.hasOwn(mimeTypes,extension);
    if (!filename.startsWith(ROOT + path.sep) || !publicFile) { response.writeHead(404); response.end('Not found'); return; }
    try {
        const info = await fs.promises.stat(filename);
        if (!info.isFile()) throw new Error('not a file');
        response.writeHead(200,{'Content-Type':mimeTypes[extension], 'Content-Length':info.size,
            'Cache-Control':['.js','.css','.html'].includes(extension) ? 'no-cache' : 'public, max-age=3600',
            'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
        if (request.method === 'HEAD') response.end();
        else { const stream = fs.createReadStream(filename); stream.on('error',()=>response.destroy()); stream.pipe(response); }
    } catch {
        response.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});
        response.end(relative === 'index.html' ? 'Your game files are missing. Copy index.html, game.js, game.css, your add-ons, and artwork into this project folder. See READ-ME-FIRST.md.' : 'Not found');
    }
}
const server = http.createServer(async (request,response) => {
    try {
        const url = new URL(request.url,'http://localhost');
        if (url.pathname === '/health') { json(response,200,{ok:true,service:'true-chess-online',rooms:rooms.size}); return; }
        if (!url.pathname.startsWith('/api/')) { await serveStatic(request,response,url.pathname); return; }
        if (!originAllowed(request)) fail('This website origin is not allowed.',403);
        if (request.headers.origin) { response.setHeader('Access-Control-Allow-Origin',request.headers.origin); response.setHeader('Vary','Origin'); }
        if (request.method === 'OPTIONS') {
            response.writeHead(204,{'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}); response.end(); return;
        }
        if (request.method !== 'POST') fail('Use POST.',405);
        limitHttp(request);
        const body = await readBody(request);
        if (url.pathname === '/api/rooms') {
            if (rooms.size >= MAX_ROOMS || !capacity(102400)) fail('The test server is full. Try again later.',503);
            const code = newCode(), whiteToken = token(), state = new TrueChessGame().state;
            rooms.set(code,{code,state,stateBytes:Buffer.byteLength(JSON.stringify(state)),revision:0,history:[],
                seats:{white:{token:whiteToken}},sockets:{},processed:new Map(),lastActive:Date.now()});
            json(response,201,{code,color:'white',token:whiteToken}); return;
        }
        const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/(join|resume)$/);
        if (!match) fail('Unknown endpoint.',404);
        const room = rooms.get(match[1]);
        if (!room) fail('Room expired or the server restarted. Create a new room.',404);
        room.lastActive = Date.now();
        if (match[2] === 'resume') {
            const seat = seatForToken(room,body.token);
            if (!seat) fail('The saved room seat is invalid.',403);
            json(response,200,{code:room.code,color:seat}); return;
        }
        if (room.seats.black) fail('This room already has a Black player. Use Return to online room in that player’s original tab.',409);
        const blackToken = token(); room.seats.black = {token:blackToken};
        json(response,200,{code:room.code,color:'black',token:blackToken});
    } catch (error) {
        if (!response.headersSent) json(response,error.status || 400,{error:error.message || 'Request failed.'});
        else response.end();
    }
});
const sockets = new WebSocketServer({noServer:true,maxPayload:MAX_MESSAGE,perMessageDeflate:false});
server.on('upgrade',(request,socket,head) => {
    try {
        if (!originAllowed(request)) fail('Forbidden origin.',403);
        const url = new URL(request.url,'http://localhost');
        const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/socket$/);
        if (!match) fail('Not found.',404);
        const room = rooms.get(match[1]);
        if (!room) fail('Room expired.',404);
        const seat = seatForToken(room,url.searchParams.get('token'));
        if (!seat) fail('Invalid player token.',403);
        sockets.handleUpgrade(request,socket,head,peer => {
            peer.color = seat; peer.alive = true; peer.rateStart = Date.now(); peer.rateCount = 0;
            const previous = room.sockets[seat]; room.sockets[seat] = peer;
            if (previous && previous !== peer) previous.close(4001,'This seat was opened in another tab.');
            room.lastActive = Date.now();
            peer.on('pong',()=>{peer.alive = true;});
            peer.on('error',()=>{});
            peer.on('message',(data,isBinary)=>{ if (isBinary) {peer.close(1003,'Text JSON only.');return;} handleCommand(room,peer,data); });
            peer.on('close',()=>{if(room.sockets[seat]===peer){delete room.sockets[seat];room.lastActive=Date.now();broadcast(room);}});
            broadcast(room);
        });
    } catch (error) {
        socket.write(`HTTP/1.1 ${error.status || 400} Rejected\r\nConnection: close\r\n\r\n`); socket.destroy();
    }
});
const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [code,room] of rooms) {
        let connected = false;
        for (const peer of Object.values(room.sockets)) {
            if (!peer || peer.readyState !== WebSocket.OPEN) continue;
            connected = true;
            if (!peer.alive) peer.terminate(); else {peer.alive=false;peer.ping();}
        }
        if (!connected && now - room.lastActive > ROOM_IDLE_MS) rooms.delete(code);
    }
    for (const [key,bucket] of httpRates) if (now - bucket.start > 120000) httpRates.delete(key);
},25000);
heartbeat.unref();
server.listen(PORT,'0.0.0.0',()=>console.log(`True Chess online server listening on port ${server.address().port}`));
function shutdown() {
    clearInterval(heartbeat);
    for (const peer of sockets.clients) peer.close(1012,'Server restarting. Rooms must be recreated after a restart.');
    server.close(()=>process.exit(0));
    setTimeout(()=>process.exit(0),2000).unref();
}
process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
