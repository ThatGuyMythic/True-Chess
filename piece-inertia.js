/*
TRUE CHESS — complete replacement piece-inertia.js

Top-grip fidget with angular momentum, NOT a cursor-facing tilt.
  - Cursor moves left -> the piece's bottom trails to the right.
  - Circling the cursor drives rotation in that same direction.
  - Releasing the motion does not reset angular velocity.
  - Raising the cursor does not contain any special "stop" behavior.

This intentionally favors a satisfying fidget over exact laboratory physics.
Fast spins reduce the restoring pull so they can coast through full turns.
*/
(() => {
    'use strict';
    if (window.__trueChessTopGripInstalled) return;
    window.__trueChessTopGripInstalled = true;
    const SETTINGS = {
        gravity:1100,
        fingerStrength:.28,
        airResistance:.9,
        angularDamping:.48,
        circularDrive:9,
        velocitySmoothing:22,
        spinThreshold:2.8,
        dragThreshold:5,
        maxAngularSpeed:55,
        maxPointerSpeed:5000,
        maxAcceleration:24000
    };
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const style = document.createElement('style');
    style.textContent = `
        #top-grip-ghost{position:fixed;z-index:2500;pointer-events:none;will-change:left,top,transform;user-select:none}
        #top-grip-ghost .piece{width:100%;height:100%;visibility:visible;pointer-events:none}
        #top-grip-ghost .piece img{width:100%;height:100%;object-fit:contain}
        #top-grip-ghost .grip-ring{position:absolute;width:5px;height:5px;transform:translate(-50%,-50%);border:1px solid #e4d39daa;border-radius:50%;pointer-events:none}
        .top-grip-source{visibility:hidden!important}
    `;
    document.head.append(style);
    let held = null;
    let frameId = 0;
    let blockClickUntil = 0;
    const imageCache = new Map();

    function artworkBounds(image) {
        if (!image?.complete || !image.naturalWidth) return null;
        const key = image.currentSrc || image.src;
        if (imageCache.has(key)) return imageCache.get(key);
        try {
            const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
            const width = Math.max(1, Math.round(image.naturalWidth * scale));
            const height = Math.max(1, Math.round(image.naturalHeight * scale));
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            const context = canvas.getContext('2d', {willReadFrequently:true});
            context.drawImage(image, 0, 0, width, height);
            const pixels = context.getImageData(0, 0, width, height).data;
            let top = height, mass = 0, weightedY = 0;
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                const alpha = pixels[(y * width + x) * 4 + 3];
                if (alpha <= 24) continue;
                top = Math.min(top, y); mass += alpha; weightedY += (y + .5) * alpha;
            }
            if (!mass) return null;
            let left = width, right = 0;
            for (let y = top; y <= Math.min(height - 1, top + 2); y++) for (let x = 0; x < width; x++) {
                if (pixels[(y * width + x) * 4 + 3] > 24) { left = Math.min(left, x); right = Math.max(right, x + 1); }
            }
            const result = {x:(left + right) / (2 * width), y:top / height, centerY:weightedY / mass / height,
                width:image.naturalWidth, height:image.naturalHeight};
            if (imageCache.size > 100) imageCache.clear();
            imageCache.set(key, result);
            return result;
        } catch { return null; }
    }
    function gripGeometry(image, width, height) {
        const bounds = artworkBounds(image);
        if (!bounds) return {x:width / 2, y:height * .08, length:Math.max(16, height * .45)};
        const scale = Math.min(width / bounds.width, height / bounds.height);
        const fittedWidth = bounds.width * scale, fittedHeight = bounds.height * scale;
        return {
            x:(width - fittedWidth) / 2 + bounds.x * fittedWidth,
            y:(height - fittedHeight) / 2 + bounds.y * fittedHeight,
            length:Math.max(16, (bounds.centerY - bounds.y) * fittedHeight)
        };
    }
    function pointerDown(event) {
        if (held || event.button !== 0 || !event.isPrimary) return;
        const tile = event.target.closest('#board .tile');
        const captured = event.target.closest('#captured [data-return]');
        if (!tile && !captured) return;
        if (!captured && !['move', 'edit-move'].includes(mode)) return;
        if (!canPlay()) return;
        const piece = captured ? game.piece(captured.dataset.return) : game.pieceAt(tilePosition(tile));
        if (!piece || (!captured && mode === 'move' && !game.canAct(piece))) return;
        event.stopImmediatePropagation();
        const rectangle = (tile || document.querySelector('#board .tile')).getBoundingClientRect();
        const width = rectangle.width * .82, height = rectangle.height * .88;
        const image = (captured || tile).querySelector('.piece img');
        held = {id:piece.id, pointerId:event.pointerId, captured:Boolean(captured), initialMode:mode,
            startX:event.clientX, startY:event.clientY, targetX:event.clientX, targetY:event.clientY,
            previousX:event.clientX, previousY:event.clientY, velocityX:0, velocityY:0,
            angle:0, angularVelocity:0, turnRate:0, turnSign:0, curveConfidence:0, lastCurve:-Infinity, lastFrame:0,
            width, height, grip:gripGeometry(image, width, height), active:false, ghost:null};
    }
    function beginSwing() {
        const state = held;
        state.active = true;
        selectedId = state.id;
        if (state.captured) mode = 'return';
        render();
        const source = state.captured
            ? document.querySelector(`#captured [data-return="${state.id}"] .piece`)
            : document.querySelector('#board .piece.chosen');
        source?.classList.add('top-grip-source');
        const ghost = document.createElement('div');
        ghost.id = 'top-grip-ghost';
        ghost.style.width = `${state.width}px`; ghost.style.height = `${state.height}px`;
        ghost.style.transformOrigin = `${state.grip.x}px ${state.grip.y}px`;
        ghost.innerHTML = pieceMarkup(game.piece(state.id));
        const ring = document.createElement('span'); ring.className = 'grip-ring';
        ring.style.left = `${state.grip.x}px`; ring.style.top = `${state.grip.y}px`;
        ghost.append(ring); document.body.append(ghost);
        state.ghost = ghost; state.lastFrame = performance.now();
        positionGhost(state); frameId = requestAnimationFrame(animate);
    }
    function pointerMove(event) {
        if (!held || event.pointerId !== held.pointerId) return;
        event.stopImmediatePropagation();
        held.targetX = event.clientX; held.targetY = event.clientY;
        if (!held.active && Math.hypot(event.clientX - held.startX, event.clientY - held.startY) > SETTINGS.dragThreshold) beginSwing();
        if (held?.active) event.preventDefault();
    }
    function positionGhost(state) {
        if (!state.ghost) return;
        state.ghost.style.left = `${state.targetX}px`; state.ghost.style.top = `${state.targetY}px`;
        state.ghost.style.transform = `translate(${-state.grip.x}px, ${-state.grip.y}px) rotate(${state.angle}rad)`;
        state.ghost.dataset.rotation = state.angle;
        state.ghost.dataset.angularVelocity = state.angularVelocity;
        state.ghost.dataset.gripX = state.grip.x;
        state.ghost.dataset.gripY = state.grip.y;
    }
    function animate(now) {
        const state = held;
        if (!state?.active) return;
        const seconds = clamp((now - state.lastFrame) / 1000, .001, .032);
        state.lastFrame = now;
        const rawX = clamp((state.targetX - state.previousX) / seconds, -SETTINGS.maxPointerSpeed, SETTINGS.maxPointerSpeed);
        const rawY = clamp((state.targetY - state.previousY) / seconds, -SETTINGS.maxPointerSpeed, SETTINGS.maxPointerSpeed);
        state.previousX = state.targetX; state.previousY = state.targetY;
        const blend = 1 - Math.exp(-SETTINGS.velocitySmoothing * seconds);
        const oldX = state.velocityX, oldY = state.velocityY;
        const vx = oldX + (rawX - oldX) * blend, vy = oldY + (rawY - oldY) * blend;
        const ax = clamp((vx - oldX) / seconds, -SETTINGS.maxAcceleration, SETTINGS.maxAcceleration);
        const ay = clamp((vy - oldY) / seconds, -SETTINGS.maxAcceleration, SETTINGS.maxAcceleration);
        state.velocityX = vx; state.velocityY = vy;

        // Remember the direction of the mouse path, not the direction to the cursor.
        // Positive cross product is clockwise in screen coordinates, matching CSS.
        const turn = Math.atan2(oldX * vy - oldY * vx, oldX * vx + oldY * vy);
        const rawSpeed = Math.hypot(rawX, rawY);
        if (Math.hypot(oldX, oldY) > 90 && Math.hypot(vx, vy) > 90
            && rawSpeed > 90 && Math.abs(turn) > .006 && Math.abs(turn) < Math.PI / 2) {
            const measuredRate = clamp(turn / seconds, -25, 25);
            const smoothing = 1 - Math.exp(-14 * seconds);
            const direction = Math.sign(measuredRate);
            if (direction !== state.turnSign) state.curveConfidence = 0;
            state.turnSign = direction;
            state.curveConfidence = Math.min(.5, state.curveConfidence + seconds);
            state.turnRate += (measuredRate - state.turnRate) * smoothing;
            state.lastCurve = now;
        } else {
            state.curveConfidence = Math.max(0, state.curveConfidence - seconds * 3);
        }
        const followingCircle = state.curveConfidence >= .18 && rawSpeed > 90 && now - state.lastCurve < 65;
        const coastingAfterCircle = !followingCircle && now - state.lastCurve < 350
            && Math.abs(state.angularVelocity) > SETTINGS.spinThreshold;
        const steps = Math.max(1, Math.ceil(seconds / (1 / 120)));
        const dt = seconds / steps;
        for (let step = 0; step < steps; step++) {
            const sine = Math.sin(state.angle), cosine = Math.cos(state.angle);
            const speedRatio = Math.abs(state.angularVelocity) / SETTINGS.spinThreshold;
            const gravityScale = 1 / (1 + Math.pow(speedRatio, 6));
            const fastSpin = Math.abs(state.angularVelocity) > SETTINGS.spinThreshold;
            const inputScale = fastSpin ? .015 : followingCircle || coastingAfterCircle ? .08 : 1;
            // CSS angle > 0 moves a downward-hanging body LEFT.
            // Thus a rightward finger acceleration must add POSITIVE angular speed.
            const gravityTorque = -SETTINGS.gravity / state.grip.length * sine * gravityScale;
            const fingerTorque = SETTINGS.fingerStrength * inputScale * (ax * cosine + ay * sine) / state.grip.length;
            const airTorque = SETTINGS.airResistance * (fastSpin ? .05 : followingCircle ? .15 : 1) * (vx * cosine + vy * sine) / state.grip.length;
            const frictionTorque = -SETTINGS.angularDamping * state.angularVelocity;
            state.angularVelocity += (gravityTorque + fingerTorque + airTorque + frictionTorque) * dt;
            if (followingCircle) state.angularVelocity += (state.turnRate - state.angularVelocity) * (1 - Math.exp(-SETTINGS.circularDrive * dt));
            state.angularVelocity = clamp(state.angularVelocity, -SETTINGS.maxAngularSpeed, SETTINGS.maxAngularSpeed);
            state.angle += state.angularVelocity * dt;
        }
        // No angle clamp, no vertical-motion reset, and no snap to upright.
        positionGhost(state); frameId = requestAnimationFrame(animate);
    }
    function cleanUp() {
        cancelAnimationFrame(frameId); held?.ghost?.remove();
        document.querySelectorAll('.top-grip-source').forEach(element => element.classList.remove('top-grip-source'));
        held = null;
    }
    async function pointerUp(event) {
        if (!held || event.pointerId !== held.pointerId) return;
        const state = held; event.stopImmediatePropagation(); cleanUp();
        if (!state.active) return;
        blockClickUntil = performance.now() + 220; event.preventDefault();
        const tile = document.elementFromPoint(event.clientX, event.clientY)?.closest('#board .tile');
        if (!tile) { render(); return; }
        const target = tilePosition(tile), piece = game.piece(state.id);
        if (!piece || (piece.alive && G(piece, target))) { render(); return; }
        await perform(state.captured ? 'resurrect' : state.initialMode === 'edit-move' ? 'reposition' : 'move', [state.id, target]);
        render();
    }
    function cancelHeldPiece() {
        if (!held) return;
        const wasActive = held.active; cleanUp(); if (wasActive) render();
    }
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('pointermove', pointerMove, {capture:true, passive:false});
    document.addEventListener('pointerup', pointerUp, {capture:true, passive:false});
    document.addEventListener('pointercancel', cancelHeldPiece, true);
    document.addEventListener('click', event => {
        if (performance.now() < blockClickUntil && event.target.closest('#board .tile, #captured [data-return]')) {
            event.preventDefault(); event.stopImmediatePropagation();
        }
    }, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') cancelHeldPiece(); }, true);
    window.addEventListener('blur', cancelHeldPiece);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelHeldPiece(); });
})();
