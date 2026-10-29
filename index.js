/* Complete entry point for True Chess + Render multiplayer. */
(() => {
    function reportError(message) {
        const notice = document.createElement('p');
        notice.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#702b22;color:white;padding:12px;z-index:10000;margin:0;font:14px monospace';
        notice.textContent = message; document.body.append(notice);
    }
    function loadScript(filename) {
        return new Promise((resolve,reject) => {
            const script = document.createElement('script'); script.src = filename;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Could not load ${filename}. Copy ALL existing game files and the Render update into the same project folder.`));
            document.head.append(script);
        });
    }
    async function start() {
        const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = 'tabletop-extras.css';
        document.head.append(stylesheet);
        const back = document.getElementById('back-to-game');
        if (back) back.onclick = () => { document.getElementById('menu').hidden = true; };
        if (location.protocol === 'file:') reportError('Start the server with npm start, then open http://localhost:3000. Online rooms do not work by double-clicking HTML.');
        try {
            await loadScript('game.js');
            await loadScript('tabletop-extras.js');
            await loadScript('render-online.js');
            await loadScript('piece-inertia.js');
        } catch (error) { reportError(error.message); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
    else start();
})();
