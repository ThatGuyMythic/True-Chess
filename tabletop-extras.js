/*
TRUE CHESS — timed objects, floating text blocks, and drawn props.
Load after game.js. This is a complete add-on; game.js is unchanged.

CYCLE RULE
A full cycle ends when the object's OWNER starts their next turn.
Status objects last 1–3 cycles from activation; no-status objects last one.
The same deadline governs their timed status. Destruction removes the object
immediately; an already-applied status can finish its remaining time.

Props and text are decorations, not board objects. They spend no actions and
can be moved by either player, including outside that player's turn.
*/
(() => {
    'use strict';
    if (window.__trueChessTabletopInstalled) return;
    window.__trueChessTabletopInstalled = true;
    const NO_STATUS = '__TRUE_CHESS_NO_STATUS__';
    const prototype = TrueChessGame.prototype;
    const originalCreateObject = prototype.createObject;
    const originalApplyCommand = applyCommand;
    const originalRender = render;
    const originalOpenCreator = openCreator;
    const originalInspectObject = inspectObject;
    const originalUpdateButtons = updateWindowButtons;
    const originalPerform = perform;
    const color = (value, fallback = '#9b69c8') => /^#[0-9a-f]{6}$/i.test(String(value)) ? value : fallback;
    const clone = value => structuredClone(value);
    let draggingItem = null;
    let decorationQueue = Promise.resolve();
    const pendingTextSaves = new Map();

    // ---------------------------------------------------------------------
    // Timed objects and their source-linked statuses
    // ---------------------------------------------------------------------
    function prepareObject(engine, object) {
        if (!object.owner) object.owner = engine.state.current;
        if (!Number.isFinite(object.activeAt)) object.activeAt = engine.state.ownTurns[object.owner] + 1;
        if (object.statusName === NO_STATUS) object.statusName = '';
        if (object.lifecycleVersion === 1) return object;
        const hasStatus = !object.collectible && Boolean(object.statusName?.trim());
        const requested = Number(object.durationCycles ?? object.lingering ?? 1);
        object.durationCycles = hasStatus ? Math.max(1, Math.min(3, Math.floor(requested) || 1)) : 1;
        // Existing saves get a fresh lifetime instead of disappearing on load.
        object.expiresAtOwnerTurn = Math.max(object.activeAt, engine.state.ownTurns[object.owner]) + object.durationCycles;
        object.lifecycleVersion = 1;
        return object;
    }
    function cyclesRemaining(engine, object) {
        prepareObject(engine, object);
        return Math.max(0, object.expiresAtOwnerTurn - Math.max(object.activeAt, engine.state.ownTurns[object.owner]));
    }
    function expireObjects(engine) {
        engine.state.objects = engine.state.objects.filter(object => {
            prepareObject(engine, object);
            if (engine.state.ownTurns[object.owner] < object.expiresAtOwnerTurn) return true;
            engine.log(`${object.name} expires after ${object.durationCycles} full cycle${object.durationCycles === 1 ? '' : 's'}.`);
            return false;
        });
    }
    function updateTimedStatus(engine, status) {
        if (!Array.isArray(status.sourceClocks)) return status.remaining > 0 || status.exposed;
        status.sourceClocks = status.sourceClocks.filter(source =>
            source.expiresAt > engine.state.ownTurns[source.owner]);
        status.remaining = Math.max(0, ...status.sourceClocks.map(source =>
            source.expiresAt - engine.state.ownTurns[source.owner]));
        return status.sourceClocks.length > 0;
    }
    prototype.createObject = function (object, signature) {
        const prepared = {...object};
        if (prepared.statusName === NO_STATUS) prepared.statusName = '';
        prepared.durationCycles = !prepared.collectible && prepared.statusName
            ? Math.max(1, Math.min(3, Number(prepared.durationCycles ?? prepared.lingering) || 1)) : 1;
        prepared.lifecycleVersion = 1;
        prepared.expiresAtOwnerTurn = this.state.ownTurns[this.state.current] + 1 + prepared.durationCycles;
        return originalCreateObject.call(this, prepared, signature);
    };
    prototype.applyStatus = function (piece, object, exposed) {
        if (!object.statusName || object.statusName === NO_STATUS) return;
        prepareObject(this, object);
        let status = piece.statuses.find(entry => entry.name.toLowerCase() === object.statusName.toLowerCase());
        if (!status) {
            status = {name:object.statusName, remaining:0, exposed:false, clock:object.owner, sourceClocks:[]};
            piece.statuses.push(status);
        }
        status.sourceClocks ??= [];
        const clock = {id:object.id, owner:object.owner, expiresAt:object.expiresAtOwnerTurn};
        const previous = status.sourceClocks.find(entry => entry.id === object.id);
        if (previous) Object.assign(previous, clock);
        else status.sourceClocks.push(clock);
        status.color = color(object.statusColor);
        status.clock = object.owner;
        status.exposed = Boolean(exposed || status.exposed);
        updateTimedStatus(this, status);
    };
    prototype.refreshExposure = function () {
        expireObjects(this);
        this.collectOccupied();
        for (const piece of this.state.pieces) {
            for (const status of piece.statuses) status.exposed = false;
            piece.statuses = piece.statuses.filter(status => updateTimedStatus(this, status));
        }
        for (const object of this.state.objects) {
            if (!this.active(object) || object.collectible || !object.statusName) continue;
            for (const piece of this.state.pieces) {
                const inArea = Math.max(Math.abs(piece.row - object.row), Math.abs(piece.col - object.col)) <= object.radius;
                if (piece.alive && piece.color !== object.owner && inArea) this.applyStatus(piece, object, true);
            }
        }
    };
    prototype.nextTurn = function () {
        const state = this.state;
        state.current = Y(state.current);
        state.turn++;
        state.ownTurns[state.current]++;
        state.actions = 2;
        state.acted = [];
        state.terrainUsed = false;
        state.objectUsed = false;
        // Manual statuses keep the existing per-owner countdown convention.
        for (const piece of state.pieces) {
            for (const status of piece.statuses) {
                if (!Array.isArray(status.sourceClocks) && !status.exposed && status.clock === state.current) status.remaining--;
            }
        }
        this.refreshExposure();
        this.log(`${v(state.current)} to play · two actions.`);
    };

    // Add a no-status option without replacing your working drawing editor.
    openCreator = function (kind, initial) {
        originalOpenCreator(kind, initial);
        if (kind !== 'object') return;
        const panel = document.querySelector('[data-window-type="object-creator"]');
        if (!panel || panel.querySelector('#tabletop-no-status')) return;
        const statusInput = panel.querySelector('#creation-status');
        if (!statusInput) return;
        const label = document.createElement('label');
        label.className = 'toggle trigger-options';
        label.innerHTML = '<input id="tabletop-no-status" type="checkbox">No status · disappears one full cycle after activation';
        statusInput.closest('.field').append(label);
        const duration = panel.querySelector('#creation-linger');
        if (duration) {
            duration.min = '1';
            duration.value = Math.max(1, Number(duration.value) || 1);
            const wrapper = duration.closest('label') || duration.previousElementSibling;
            if (wrapper?.firstChild?.nodeType === Node.TEXT_NODE) wrapper.firstChild.textContent = 'Status lifetime (1–3 full cycles)';
        }
        const help = document.createElement('p');
        help.className = 'tabletop-cycle-help';
        help.textContent = 'Objects persist after activation. A full cycle ends on the owner’s next turn. Status lifetime also determines object lifetime; no-status objects last one cycle.';
        panel.querySelector('.window-body').append(help);
        const noStatus = label.querySelector('input');
        noStatus.onchange = () => { statusInput.disabled = noStatus.checked; };
        panel.querySelector('#submit-creation').addEventListener('click', () => {
            if (noStatus.checked && !panel.querySelector('#creation-item')?.checked) statusInput.value = NO_STATUS;
            else if (statusInput.value === NO_STATUS) statusInput.value = '';
        }, true);
    };
    inspectObject = function (object) {
        originalInspectObject(object);
        const panel = document.querySelector('[data-window-type="object-inspector"]');
        if (!panel) return;
        let paragraph = panel.querySelector('.tabletop-cycle-help');
        if (!paragraph) { paragraph = document.createElement('p'); paragraph.className = 'tabletop-cycle-help'; panel.querySelector('.window-body').append(paragraph); }
        paragraph.textContent = game.active(object)
            ? `${cyclesRemaining(game, object)} full cycle(s) remaining. Destroying it removes it immediately.`
            : `Activates on the owner's next turn, then lasts ${cyclesRemaining(game, object)} full cycle(s).`;
    };
    // Timed statuses no longer advertise an additional fresh lifetime on exit.
    const originalStatusDescription = statusDescription;
    statusDescription = function (piece) {
        return originalStatusDescription(piece).replace(/While in an active area; (\d+) lingering cycle(s?) after leaving/g,
            'Active area · $1 cycle$2 remaining');
    };

    // ---------------------------------------------------------------------
    // Shared, undoable decoration commands. No board action cost or turn gate.
    // ---------------------------------------------------------------------
    function items(engine = game) { engine.state.tabletopItems ??= []; return engine.state.tabletopItems; }
    function boundedItem(input) {
        const width = Math.max(100, Math.min(1400, Number(input.width) || 260));
        const height = Math.max(80, Math.min(1200, Number(input.height) || 180));
        return {...input, width, height,
            x:Math.max(0, Number(input.x) || 0), y:Math.max(0, Number(input.y) || 0),
            title:String(input.title || (input.kind === 'prop' ? 'Prop' : 'Text')).slice(0,80),
            text:String(input.text || '').slice(0,10000),
            color:color(input.color, '#eee4c9'), background:color(input.background, '#292929'),
            fontSize:Math.max(10, Math.min(80, Number(input.fontSize) || 18))};
    }
    applyCommand = function (engine, method, args) {
        if (!method.startsWith('tabletop-')) return originalApplyCommand(engine, method, args);
        return engine.commit(() => {
            const list = items(engine);
            if (method === 'tabletop-add') {
                if (list.length >= 60) return {ok:false, message:'The decoration limit is 60. Remove a text block or prop first.'};
                const item = boundedItem(args[0]);
                if (!['text','prop'].includes(item.kind)) return {ok:false, message:'Unknown decoration type.'};
                if (item.kind === 'prop' && !/^data:image\/png;base64,/.test(item.artwork || '')) return {ok:false, message:'Draw or upload a prop first.'};
                list.push({...item, id:crypto.randomUUID()});
                return {ok:true, message:`${item.kind === 'prop' ? 'Prop' : 'Text block'} added. No action spent.`};
            }
            const index = list.findIndex(item => item.id === args[0]);
            if (index < 0) return {ok:false, message:'That decoration no longer exists.'};
            if (method === 'tabletop-delete') list.splice(index, 1);
            else if (method === 'tabletop-update') list[index] = boundedItem({...list[index], ...args[1], id:list[index].id, kind:list[index].kind});
            else return {ok:false, message:'Unknown decoration command.'};
            return {ok:true, message:method === 'tabletop-delete' ? 'Decoration removed.' : 'Decoration updated.'};
        });
    };
    perform = function (method, args = [], shot = null) {
        if (!method.startsWith('tabletop-')) {
            if (method === 'undo') {
                for (const timer of pendingTextSaves.values()) clearTimeout(timer);
                pendingTextSaves.clear();
            }
            return originalPerform(method, args, shot);
        }
        decorationQueue = decorationQueue.then(async () => {
            while (busy) await new Promise(resolve => setTimeout(resolve, 25));
            busy = true;
            try {
                let result;
                if (room) {
                    const currentRoom = room;
                    const record = await roomTransaction(room.code, record => {
                        if (record?.seats[currentRoom.color]?.id !== clientId) throw new Error('Your player seat is no longer active.');
                        const engine = new TrueChessGame(record.state);
                        engine.history = record.history;
                        result = applyCommand(engine, method, args);
                        if (!result.ok) throw new Error(result.message);
                        record.state = engine.state;
                        record.history = engine.history.slice(-30);
                        record.revision++;
                        return record;
                    });
                    game = new TrueChessGame(record.state);
                    room.revision = record.revision;
                    broadcast();
                } else {
                    result = applyCommand(game, method, args);
                    if (!result.ok) throw new Error(result.message);
                    try { localStorage.setItem(localSaveKey, JSON.stringify(game.state)); }
                    catch { notify('Decoration changed, but local autosave failed. Browser storage may be full.', true); }
                }
                render();
                return true;
            } catch (error) { notify(error.message, true); await refreshRoom(); return false; }
            finally { busy = false; renderHeader(); updateWindowButtons(); }
        });
        return decorationQueue;
    };

    // ---------------------------------------------------------------------
    // Floating text / prop rendering
    // ---------------------------------------------------------------------
    const layer = document.createElement('div');
    layer.id = 'tabletop-layer';
    document.body.append(layer);
    function paintItems() {
        const list = items();
        const live = new Set(list.map(item => item.id));
        layer.querySelectorAll('.tabletop-item').forEach(element => {
            if (!live.has(element.dataset.itemId)) element.remove();
        });
        for (const item of list) {
            let element = layer.querySelector(`[data-item-id="${item.id}"]`);
            if (!element) {
                element = document.createElement('section');
                element.className = `tabletop-item ${item.kind === 'text' ? 'tabletop-text-block' : 'tabletop-prop'}`;
                element.dataset.itemId = item.id;
                element.style.zIndex = String(++windowLayer);
                element.innerHTML = `<header class="tabletop-handle"><span class="tabletop-title"></span><nav>
                    <button data-table-item="edit" aria-label="Edit decoration">✎</button>
                    <button data-table-item="delete" aria-label="Delete decoration">×</button></nav></header>
                    ${item.kind === 'text' ? '<textarea class="tabletop-text" aria-label="Text block" spellcheck="false"></textarea>' : '<img class="tabletop-art" draggable="false" alt="Drawn prop">'}
                    <button class="tabletop-resize" aria-label="Resize decoration">◢</button>`;
                layer.append(element);
                const textarea = element.querySelector('textarea');
                if (textarea) textarea.oninput = () => {
                    clearTimeout(pendingTextSaves.get(item.id));
                    pendingTextSaves.set(item.id, setTimeout(() => {
                        pendingTextSaves.delete(item.id);
                        perform('tabletop-update', [item.id, {text:textarea.value}]);
                    }, 500));
                };
            }
            element.querySelector('.tabletop-title').textContent = item.title;
            if (draggingItem?.id !== item.id) {
                element.style.left = `${Math.min(item.x, Math.max(0, innerWidth - 70))}px`;
                element.style.top = `${Math.min(item.y, Math.max(0, innerHeight - 45))}px`;
                element.style.width = `${item.width}px`;
                element.style.height = `${item.height}px`;
            }
            element.style.setProperty('--text-color', item.color);
            element.style.setProperty('--text-background', item.background);
            element.style.setProperty('--text-size', `${item.fontSize}px`);
            element.classList.toggle('transparent-prop', item.kind === 'prop' && !item.frame);
            const textarea = element.querySelector('textarea');
            if (textarea && document.activeElement !== textarea && !pendingTextSaves.has(item.id)) textarea.value = item.text;
            const image = element.querySelector('img');
            if (image && image.getAttribute('src') !== item.artwork) image.src = item.artwork;
        }
    }
    render = function () {
        game.refreshExposure();
        originalRender();
        paintItems();
        addButtons();
    };
    function addButtons() {
        const toolbar = document.querySelector('.top-actions');
        if (toolbar && !toolbar.querySelector('[data-table-action]')) {
            toolbar.insertAdjacentHTML('afterbegin', '<button data-table-action="text">Text</button><button data-table-action="prop">Props</button>');
        }
        updateWindowButtons();
    }
    updateWindowButtons = function () {
        originalUpdateButtons();
        document.querySelectorAll('[data-table-action]').forEach(button => {
            const type = button.dataset.tableAction === 'text' ? 'tabletop-text-create' : 'tabletop-prop-create';
            button.disabled = Boolean(openWindows.get(type)?.isConnected);
        });
    };
    function itemAtElement(element) { return items().find(item => item.id === element.closest('.tabletop-item')?.dataset.itemId); }
    function openTextEditor(item = null) {
        const editing = Boolean(item);
        const panel = floatingWindow(editing ? 'Edit decoration' : 'Add text block', `
            <div class="form-grid">
                <label class="full">Title<input id="tabletop-title" maxlength="80" value="${escapeHTML(item?.title || 'Text')}"></label>
                ${!item || item.kind === 'text' ? `<label class="full">Text<textarea id="tabletop-content">${escapeHTML(item?.text || '')}</textarea></label>
                <label class="color-field">Text color<input id="tabletop-color" type="color" value="${color(item?.color, '#eee4c9')}"></label>
                <label>Text size<input id="tabletop-size" type="number" min="10" max="80" value="${item?.fontSize || 18}"></label>` : ''}
                <label class="color-field full">Background / frame color<input id="tabletop-background" type="color" value="${color(item?.background, '#292929')}"></label>
                ${item?.kind === 'prop' ? `<label class="toggle full"><input id="tabletop-frame" type="checkbox" ${item.frame ? 'checked' : ''}>Show a frame behind this prop</label>` : ''}
            </div>`, '<button id="tabletop-save" class="primary">Save</button>', false,
            editing ? 'tabletop-item-edit' : 'tabletop-text-create');
        if (!panel) return;
        panel.querySelector('#tabletop-save').onclick = async () => {
            const value = id => panel.querySelector(`#${id}`)?.value;
            const details = {
                title:value('tabletop-title'), text:value('tabletop-content') ?? item?.text ?? '',
                color:value('tabletop-color') || item?.color || '#eee4c9',
                background:value('tabletop-background'), fontSize:Number(value('tabletop-size')) || item?.fontSize || 18,
                frame:Boolean(panel.querySelector('#tabletop-frame')?.checked)
            };
            if (!editing) Object.assign(details, {kind:'text', x:90, y:110, width:280, height:210});
            const success = await perform(editing ? 'tabletop-update' : 'tabletop-add', editing ? [item.id, details] : [details]);
            if (success) closeWindow(panel);
        };
    }
    function openPropCreator() {
        const panel = floatingWindow('Draw a floating prop', `
            <p>Decoration only: no board square, health, status effect, or action cost. Drag its top bar to move it; drag its bottom-right corner to resize.</p>
            <label>Name<input id="prop-name" value="Prop" maxlength="80"></label>
            <canvas id="prop-canvas" class="draw-canvas" width="384" height="384" aria-label="Draw a prop"></canvas>
            <div class="drawing-tools"><input id="prop-color" type="color" value="#e4d39d" aria-label="Brush color">
                <input id="prop-brush" type="range" min="1" max="40" value="7" aria-label="Brush size">
                <button id="prop-erase">Eraser</button><button id="prop-clear">Clear</button></div>
            <label class="upload-button">Upload artwork<input id="prop-upload" type="file" accept="image/png,image/jpeg,image/webp"></label>
            <p id="prop-error" class="field-error"></p>`, '<button id="prop-create" class="primary">Add prop</button>', false, 'tabletop-prop-create');
        if (!panel) return;
        const canvas = panel.querySelector('canvas');
        const context = canvas.getContext('2d');
        let painting = false, erasing = false, hasArt = false;
        const point = event => { const rectangle = canvas.getBoundingClientRect(); return {x:(event.clientX - rectangle.x) * 384 / rectangle.width, y:(event.clientY - rectangle.y) * 384 / rectangle.height}; };
        canvas.onpointerdown = event => {
            if (event.button !== 0) return;
            painting = true; canvas.setPointerCapture(event.pointerId);
            const location = point(event);
            context.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
            context.strokeStyle = panel.querySelector('#prop-color').value;
            context.lineWidth = Number(panel.querySelector('#prop-brush').value);
            context.lineCap = context.lineJoin = 'round';
            context.beginPath(); context.moveTo(location.x, location.y); context.lineTo(location.x + .1, location.y + .1); context.stroke();
            hasArt = true;
        };
        canvas.onpointermove = event => { if (painting) { const location = point(event); context.lineTo(location.x, location.y); context.stroke(); } };
        canvas.onpointerup = canvas.onpointercancel = () => { painting = false; };
        panel.querySelector('#prop-erase').onclick = event => { erasing = !erasing; event.target.textContent = erasing ? 'Paint' : 'Eraser'; };
        panel.querySelector('#prop-clear').onclick = () => { context.clearRect(0, 0, 384, 384); hasArt = false; };
        panel.querySelector('#prop-upload').onchange = event => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 6 * 1024 * 1024) { panel.querySelector('#prop-error').textContent = 'Use an image smaller than 6 MB.'; return; }
            const reader = new FileReader();
            reader.onload = () => {
                const image = new Image();
                image.onload = () => {
                    context.clearRect(0, 0, 384, 384); context.globalCompositeOperation = 'source-over';
                    const scale = Math.min(370 / image.width, 370 / image.height);
                    context.drawImage(image, (384 - image.width * scale) / 2, (384 - image.height * scale) / 2, image.width * scale, image.height * scale); hasArt = true;
                };
                image.onerror = () => { panel.querySelector('#prop-error').textContent = 'This image could not be read.'; };
                image.src = String(reader.result);
            };
            reader.readAsDataURL(file);
        };
        panel.querySelector('#prop-create').onclick = async () => {
            if (!hasArt) { panel.querySelector('#prop-error').textContent = 'Draw or upload the prop first.'; return; }
            const success = await perform('tabletop-add', [{kind:'prop', title:panel.querySelector('#prop-name').value,
                artwork:canvas.toDataURL('image/png'), x:150, y:130, width:210, height:230, frame:false}]);
            if (success) closeWindow(panel);
        };
    }

    // Dragging and resizing decorations commit only on release, not every frame.
    layer.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const element = event.target.closest('.tabletop-item');
        if (!element) return;
        element.style.zIndex = String(++windowLayer);
        if (event.target.closest('textarea, [data-table-item]')) return;
        if (!event.target.closest('.tabletop-handle, .tabletop-art, .tabletop-resize')) return;
        const item = itemAtElement(element);
        if (!item) return;
        event.preventDefault(); event.stopPropagation();
        const rectangle = element.getBoundingClientRect();
        element.style.zIndex = String(++windowLayer);
        draggingItem = {id:item.id, pointerId:event.pointerId, element,
            resizing:Boolean(event.target.closest('.tabletop-resize')), startX:event.clientX, startY:event.clientY,
            x:rectangle.x, y:rectangle.y, width:rectangle.width, height:rectangle.height};
        element.setPointerCapture(event.pointerId);
    });
    layer.addEventListener('pointermove', event => {
        if (!draggingItem || event.pointerId !== draggingItem.pointerId) return;
        const drag = draggingItem;
        const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
        if (drag.resizing) {
            drag.element.style.width = `${Math.max(100, Math.min(1400, drag.width + dx))}px`;
            drag.element.style.height = `${Math.max(80, Math.min(1200, drag.height + dy))}px`;
        } else {
            drag.element.style.left = `${Math.max(0, Math.min(innerWidth - 70, drag.x + dx))}px`;
            drag.element.style.top = `${Math.max(0, Math.min(innerHeight - 45, drag.y + dy))}px`;
        }
    });
    function finishItemDrag(event) {
        if (!draggingItem || event.pointerId !== draggingItem.pointerId) return;
        const drag = draggingItem; draggingItem = null;
        const rectangle = drag.element.getBoundingClientRect();
        perform('tabletop-update', [drag.id, {x:rectangle.x, y:rectangle.y, width:rectangle.width, height:rectangle.height}]);
    }
    layer.addEventListener('pointerup', finishItemDrag);
    layer.addEventListener('pointercancel', () => { draggingItem = null; paintItems(); });
    window.addEventListener('blur', () => { draggingItem = null; paintItems(); });
    window.addEventListener('resize', paintItems);
    document.addEventListener('click', event => {
        const add = event.target.closest('[data-table-action]');
        if (add) {
            event.preventDefault(); event.stopImmediatePropagation();
            if (add.dataset.tableAction === 'text') openTextEditor(); else openPropCreator();
            return;
        }
        const action = event.target.closest('[data-table-item]');
        if (!action) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const item = itemAtElement(action);
        if (!item) return;
        if (action.dataset.tableItem === 'edit') openTextEditor(item);
        else {
            clearTimeout(pendingTextSaves.get(item.id)); pendingTextSaves.delete(item.id);
            perform('tabletop-delete', [item.id]);
        }
    }, true);
    render();
})();
