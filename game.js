/*
TRUE CHESS — complete standalone game.js

CONTENTS
  1. Rules engine (retained from your existing game)
  2. Visual state and undoable appearance changes
  3. Application state and two-tab room storage
  4. Board, piece images, status areas, and sidebar
  5. Context menu, commands, dragging, and projectiles
  6. One-per-type floating windows and editors
  7. Drawing editor, optional wheel, and event wiring

Assets (relative to the HTML page):
  main-menu.png
  images/{w,b}{p,n,b,r,q,k}.png

Two-tab rooms are same-browser rooms, NOT internet multiplayer.
Custom ability descriptions are player instructions, not executable effects.
*/
const PIECE_STATS= {
    pawn: {
        hp:2,dmg:1,range:1
    }
    ,knight: {
        hp:4,dmg:6,range:4
    }
    ,bishop: {
        hp:2,dmg:8,range:5
    }
    ,rook: {
        hp:10,dmg:2,range:5
    }
    ,queen: {
        hp:10,dmg:4,range:6
    }
    ,king: {
        hp:5,dmg:1,range:1
    }
}
,Y=o=>o==="white"?"black":"white",v=o=>o.charAt(0).toUpperCase()+o.slice(1),oe=o=>`${o.row},${o.col}`,G=(o,e)=>o.row===e.row&&o.col===e.col,V=o=>o.col>=0&&o.col<8&&o.row>=0&&o.row<8?`${"abcdefgh"[o.col]}${8-o.row}`:`(${o.col+1}, ${8-o.row})`,PIECE_DESCRIPTIONS= {
    pawn:"Moves forward. Captures diagonally, ignoring HP. Its first move can cover two squares.",knight:"Jumps in an L shape, over pieces and terrain. Captures instantly, ignoring HP.",bishop:"Moves and captures along diagonals. Its transformed projectile pierces enemies.",rook:"Moves and captures along straight lines. Transforming grants two Shields.",queen:"Moves along straight lines and diagonals. Attacks without moving, dealing 4 melee damage.",king:"Moves one square in any direction. Deals stationary melee damage. Protected while any original ally survives."
}
;
function createInitialGameState() {
    const o=[],e= {
    }
    ,t=["rook","knight","bishop","queen","king","bishop","knight","rook"];
    for(let a=0;
    a<8;
    a+=1)for(let s=0;
    s<8;
    s+=1)e[oe( {
        row:a,col:s
    }
    )]="floor";
    for(const a of["black","white"])for(let s=0;
    s<8;
    s+=1)for(const r of[!1,!0]) {
        const n=r?"pawn":t[s],i=PIECE_STATS[n];
        o.push( {
            id:`${a}-${r?"pawn":n}-${s}`,color:a,type:n,form:"OG",row:a==="white"?r?6:7:r?1:0,col:s,spawnCol:s,hp:i.hp,maxHp:i.hp,dmg:i.dmg,range:i.range,shields:0,alive:!0,moved:!1,resurrected:!1,original:!0,name:v(n),description:PIECE_DESCRIPTIONS[n],artwork:"",projectile:!1,statuses:[],transformedOnce:!1
        }
        )
    }
    return {
        pieces:o,tiles:e,objects:[],inventory: {
            white:[],black:[]
        }
        ,current:"white",actions:2,acted:[],turn:1,ownTurns: {
            white:1,black:0
        }
        ,terrainUsed:!1,objectUsed:!1,result:null,log:["A new match begins. White has two actions."],lastMove:[],projectileRounding:"nearest-down",agreedKingRange:2,approved:[]
    }
}
class TrueChessGame {
    state;
    history=[];
    constructor(e) {
        this.state=e??createInitialGameState();
        this.state.tileColors ??= {};
        this.state.appearance ??= {background: "#151515"};
        this.state.projectileRounding ??= "nearest-down";
        this.state.agreedKingRange ??= 2;
        for(const t of[...this.state.objects,...this.state.inventory.white,...this.state.inventory.black])t.resurrection=t.collectible&&t.resurrection===!0
    }
    pieceAt(e) {
        return this.state.pieces.find(t=>t.alive&&G(t,e))
    }
    piece(e) {
        return this.state.pieces.find(t=>t.id===e)
    }
    objectAt(e) {
        return this.state.objects.find(t=>G(t,e))
    }
    terrain(e) {
        return this.state.tiles[oe(e)]??"hole"
    }
    immortal(e) {
        return e.type==="king"&&this.state.pieces.some(t=>t.alive&&t.original&&t.color===e.color&&t.type!=="king")
    }
    canAct(e) {
        return!this.state.result&&e.alive&&e.color===this.state.current&&this.state.actions>0&&!this.state.acted.includes(e.id)
    }
    instant(e) {
        return e.form==="OG"&&e.type!=="queen"&&e.type!=="king"
    }
    combat(e) {
        return this.instant(e)?"capture":e.form==="T"&&e.projectile?"ranged":"melee"
    }
    log(e) {
        this.state.log.push(e),this.state.log.length>100&&this.state.log.shift()
    }
    commit(e) {
        const t=structuredClone(this.state),a=e();
        return a.ok?(this.history.push(t),this.history.length>100&&this.history.shift(),this.refreshExposure(),this.checkEnding()):this.state=t,a
    }
    undo() {
        const e=this.history.pop();
        return e?(this.state=e, {
            ok:!0,message:"Previous change restored."
        }
        ): {
            ok:!1,message:"Nothing to undo."
        }
    }
    finishAction(e) {
        e&&this.state.acted.push(e.id),this.state.actions=Math.max(0,this.state.actions-1),this.refreshExposure(),this.checkEnding(),this.state.actions===0&&!this.state.result&&this.nextTurn()
    }
    nextTurn() {
        this.state.current=Y(this.state.current),this.state.turn+=1,this.state.ownTurns[this.state.current]+=1,this.state.actions=2,this.state.acted=[],this.state.terrainUsed=!1,this.state.objectUsed=!1,this.refreshExposure();
        for(const e of this.state.pieces) {
            for(const t of e.statuses)!t.exposed&&t.clock===this.state.current&&(t.remaining-=1);
            e.statuses=e.statuses.filter(t=>t.exposed||t.remaining>0)
        }
        this.log(`${v(this.state.current)} to play · two actions.`)
    }
    skip() {
        return this.commit(()=>this.state.result?{
            ok:!1,message:"This match has ended."
        }
        :(this.log(`${v(this.state.current)} passes ${this.state.actions} unused action${this.state.actions===1?"":"s"}.`),this.nextTurn(), {
            ok:!0,message:`${v(this.state.current)} to play.`
        }
        ))
    }
    rayClear(e,t,a=!1) {
        const s=t.row-e.row,r=t.col-e.col;
        if(!(s===0||r===0||Math.abs(s)===Math.abs(r)))return!1;
        const n=Math.max(Math.abs(s),Math.abs(r));
        for(let i=1;
        i<n;
        i+=1) {
            const d= {
                row:e.row+Math.sign(s)*i,col:e.col+Math.sign(r)*i
            }
            ;
            if(this.terrain(d)==="mountain"||this.pieceAt(d)||a&&this.objectAt(d))return!1
        }
        return!0
    }
    legalMove(e,t) {
        if(!this.canAct(e)||!Number.isInteger(t.row)||!Number.isInteger(t.col)||G(e,t)||t.row<-4||t.row>11||t.col<-4||t.col>11||this.terrain(t)==="mountain"||this.immortal(e)&&this.terrain(t)==="hole")return!1;
        const a=this.pieceAt(t);
        if(a&&(a.color===e.color||!this.instant(e)))return!1;
        const s=t.row-e.row,r=t.col-e.col,n=Math.max(Math.abs(s),Math.abs(r));
        if(e.form==="T")return n<=e.range&&this.rayClear(e,t);
        switch(e.type) {
            case"pawn": {
                const i=e.color==="white"?-1:1;
                return a?s===i&&Math.abs(r)===1:r!==0?!1:s===i?!0:s===i*2&&!e.moved&&!e.resurrected&&e.row===(e.color==="white"?6:1)&&!this.pieceAt( {
                    row:e.row+i,col:e.col
                }
                )&&this.terrain( {
                    row:e.row+i,col:e.col
                }
                )!=="mountain"
            }
            case"knight":return Math.abs(s)*Math.abs(r)===2;
            case"bishop":return Math.abs(s)===Math.abs(r)&&this.rayClear(e,t);
            case"rook":return(s===0||r===0)&&this.rayClear(e,t);
            case"queen":return this.rayClear(e,t);
            case"king":return n===1
        }
    }
    kill(e,t) {
        e.alive=!1,e.hp=0,this.log(`${v(e.color)} ${e.name} ${t}.`)
    }
    landing(e) {
        if(this.terrain(e)==="hole") {
            this.kill(e,"falls into the abyss");
            return
        }
        this.collectOccupied()
    }
    collectOccupied() {
        for(const e of[...this.state.objects]) {
            if(!e.collectible||!this.active(e))continue;
            const t=this.pieceAt(e);
            t&&this.state.inventory[t.color].length<3&&(this.state.objects=this.state.objects.filter(a=>a.id!==e.id),this.state.inventory[t.color].push(e),this.log(`${v(t.color)} automatically collects ${e.name}.`))
        }
    }
    shieldFallback(e,t) {
        const a= {
            row:e.row,col:e.col
        }
        ,s=t.row-a.row,r=t.col-a.col;
        if(e.type!=="pawn") {
            if(e.type==="knight") {
                const n=Math.abs(s)===2?{
                    row:a.row+s,col:a.col
                }
                : {
                    row:a.row,col:a.col+r
                }
                ,i=Math.abs(s)===1?{
                    row:a.row+s,col:a.col
                }
                : {
                    row:a.row,col:a.col+r
                }
                ,d=[n,i,a].find(c=>!this.pieceAt(c)||G(c,a))??a;
                e.row=d.row,e.col=d.col
            }
            else e.row=t.row-Math.sign(s),e.col=t.col-Math.sign(r);
            e.moved=!0,this.state.lastMove=[a, {
                row:e.row,col:e.col
            }
            ],this.landing(e)
        }
    }
    move(e,t) {
        return this.commit(()=> {
            const a=this.piece(e);
            if(!a||!this.legalMove(a,t))return {
                ok:!1,message:"That is not a legal move."
            }
            ;
            const s= {
                row:a.row,col:a.col
            }
            ,r=this.pieceAt(t);
            return r&&this.immortal(r)?(this.log(`${a.name} attacks ${r.name}, but the king is immortal.`),this.finishAction(a), {
                ok:!0,message:"The king is protected. Your action is spent."
            }
            ):r&&r.shields>0?(r.shields-=1,this.shieldFallback(a,r),this.log(`${r.name} blocks the capture with a Shield.`),this.finishAction(a), {
                ok:!0,message:"Shield broken. Capture blocked; action spent."
            }
            ):(r&&this.kill(r,`is captured by ${a.name}`),a.row=t.row,a.col=t.col,a.moved=!0,this.state.lastMove=[s,t],this.log(`${v(a.color)} ${a.name} · ${V(s)} → ${V(t)}${r?" · capture":""}.`),this.landing(a),this.finishAction(a), {
                ok:!0,message:a.alive?`${a.name} moved to ${V(t)}.`:`${a.name} fell into the abyss.`
            }
            )
        }
        )
    }
    projectileDamage(e,t) {
        const a=t+1;
        if(a<=e.range)return e.dmg;
        let s=e.dmg,r=e.range+1;
        const n=i=>this.state.projectileRounding==="nearest-down"?Math.ceil(i-.5):Math.floor(i);
        for(;
        s>1;
        ) {
            if(s=n(s/2),s<=1)return s===1&&a<r+4?1:0;
            if(a<r+2)return s;
            r+=2
        }
        return s===1&&a<r+4?1:0
    }
    legalAttack(e,t,a=!1) {
        if(!this.canAct(e)||this.instant(e)||G(e,t)||!Number.isInteger(t.row)||!Number.isInteger(t.col)||t.row<-4||t.row>11||t.col<-4||t.col>11||a!==(this.combat(e)==="ranged")||a&&e.type!=="bishop"&&!this.state.projectileRounding||e.form==="T"&&e.type==="king"&&this.state.agreedKingRange===null||this.terrain(t)==="mountain")return!1;
        const s=t.row-e.row,r=t.col-e.col;
        if(!(s===0||r===0||Math.abs(s)===Math.abs(r)))return!1;
        const n=Math.max(Math.abs(s),Math.abs(r));
        if(e.type==="king"&&e.form==="T"&&n>(this.state.agreedKingRange??0))return!1;
        const i=this.pieceAt(t),d=this.objectAt(t);
        if(!i&&!d)return!1;
        if(!a)return n<=e.range&&(!i||i.color!==e.color)&&this.rayClear(e,t,!0);
        if(e.type!=="bishop")return(!i||i.color!==e.color)&&this.projectileDamage(e,n)>0&&this.rayClear(e,t,!0);
        let c=e.dmg;
        for(let g=1;
        g<=n;
        g+=1) {
            const w= {
                row:e.row+Math.sign(s)*g,col:e.col+Math.sign(r)*g
            }
            ;
            if(this.terrain(w)==="mountain"||c<=0)return!1;
            const p=this.pieceAt(w),b=this.objectAt(w);
            if(g===n)return(!!(p&&p.color!==e.color)||!!b)&&c>0;
            p&&p.color!==e.color&&(c=Math.ceil(c/2-.5)),b&&c>0&&(c=Math.ceil(c/2-.5))
        }
        return!1
    }
    damage(e,t) {
        if(this.immortal(e)) {
            this.log(`${e.name} is immortal · no damage.`);
            return
        }
        if(e.shields>0) {
            e.shields-=1,this.log(`${e.name} blocks the action with a Shield.`);
            return
        }
        e.hp=Math.max(0,e.hp-t),this.log(`${v(e.color)} ${e.name} takes ${t} damage · ${e.hp}/${e.maxHp} HP.`),e.hp===0&&this.kill(e,"is defeated")
    }
    destroy(e) {
        if(this.state.objects=this.state.objects.filter(t=>t.id!==e.id),this.log(`${e.name} is destroyed.`),e.onDestroy&&e.statusName&&!e.collectible&&this.active(e))for(const t of this.state.pieces.filter(a=>a.alive&&a.color!==e.owner&&Math.max(Math.abs(a.row-e.row),Math.abs(a.col-e.col))<=e.radius))this.applyStatus(t,e,!1)
    }
    attack(e,t,a=!1) {
        return this.commit(()=> {
            const s=this.piece(e);
            if(!s||!this.legalAttack(s,t,a))return {
                ok:!1,message:"No legal target in that direction."
            }
            ;
            const r=t.row-s.row,n=t.col-s.col;
            if(this.log(`${v(s.color)} ${s.name} uses ${a?"a projectile":"melee"}.`),a&&s.type==="bishop") {
                let i=s.dmg;
                for(let d=1;
                d<=24&&i>0;
                d+=1) {
                    const c= {
                        row:s.row+Math.sign(r)*d,col:s.col+Math.sign(n)*d
                    }
                    ;
                    if(c.row<-4||c.row>11||c.col<-4||c.col>11||this.terrain(c)==="mountain")break;
                    const g=this.pieceAt(c),w=this.objectAt(c);
                    g&&g.color!==s.color&&(this.damage(g,i),i=Math.ceil(i/2-.5)),w&&i>0&&(this.destroy(w),i=Math.ceil(i/2-.5))
                }
            }
            else {
                const i=this.pieceAt(t),d=this.objectAt(t),c=a?this.projectileDamage(s,Math.max(Math.abs(r),Math.abs(n))):s.dmg;
                i?this.damage(i,c):d&&this.destroy(d)
            }
            return this.state.lastMove=[ {
                row:s.row,col:s.col
            }
            ,t],this.finishAction(s), {
                ok:!0,message:"Attack resolved. Check the chronicle for damage."
            }
        }
        )
    }
    transform(e,t) {
        return this.commit(()=> {
            const a=this.piece(e);
            return!a||!this.canAct(a)||a.form==="T"||a.transformedOnce?{
                ok:!1,message:"Each individual piece may transform only once."
            }
            :(a.form="T",a.transformedOnce=!0,a.name=t.name,a.description=t.description,a.artwork=t.artwork,a.projectile=t.projectile,t.keepStatuses||(a.statuses=[]),a.type==="rook"&&(a.shields=2),this.state.approved.includes(t.signature)||this.state.approved.push(t.signature),this.log(`${v(a.color)} ${v(a.type)} transforms into ${a.name}. Base stats are preserved.`),this.finishAction(a), {
                ok:!0,message:`${a.name} is now permanently transformed.`
            }
            )
        }
        )
    }
    promote(e,t) {
        return this.commit(()=> {
            const a=this.piece(e);
            if(!a||!a.alive||a.type!=="pawn"||a.row!==(a.color==="white"?0:7)||t==="king"||t==="pawn")return {
                ok:!1,message:"This pawn cannot promote to that type."
            }
            ;
            const s=PIECE_STATS[t];
            return a.type=t,a.form="OG",a.hp=s.hp,a.maxHp=s.hp,a.dmg=s.dmg,a.range=s.range,a.shields=0,a.name=v(t),a.description=PIECE_DESCRIPTIONS[t],a.artwork="",a.projectile=!1,this.log(`${v(a.color)} promotes to ${a.name} · free, full HP.`), {
                ok:!0,message:"Promoted at no action cost."
            }
        }
        )
    }
    legalReposition(e,t) {
        return!e.alive||this.state.result||G(e,t)||!Number.isInteger(t.row)||!Number.isInteger(t.col)||t.row<-4||t.row>11||t.col<-4||t.col>11||this.pieceAt(t)?!1:!this.immortal(e)||this.terrain(t)!=="hole"
    }
    reposition(e,t) {
        const a=this.piece(e);
        return!a||!this.legalReposition(a,t)?{
            ok:!1,message:"Choose an unoccupied tile inside the board boundary. Protected kings cannot enter holes."
        }
        :this.edit(e, {
            ...t,hp:a.hp,shields:a.shields,statuses:structuredClone(a.statuses)
        }
        )
    }
    edit(e,t) {
        return this.commit(()=> {
            const a=this.piece(e);
            if(!a||!a.alive)return {
                ok:!1,message:"Select a surviving piece."
            }
            ;
            if(!Number.isInteger(t.hp)||t.hp<0||t.hp>a.maxHp)return {
                ok:!1,message:`HP must be a whole number from 0 to ${a.maxHp}.`
            }
            ;
            if(!Number.isInteger(t.shields)||t.shields<0)return {
                ok:!1,message:"Shields must be a non-negative whole number."
            }
            ;
            if(this.immortal(a)&&t.hp<a.hp)return {
                ok:!1,message:"An immortal king’s HP cannot be reduced."
            }
            ;
            if(!Number.isInteger(t.row)||!Number.isInteger(t.col)||t.row<-4||t.row>11||t.col<-4||t.col>11)return {
                ok:!1,message:"Position must be inside the 16 × 16 boundary."
            }
            ;
            const s=this.pieceAt(t);
            return s&&s.id!==e?{
                ok:!1,message:"That square already contains a piece."
            }
            :this.immortal(a)&&this.terrain(t)==="hole"?{
                ok:!1,message:"A protected king cannot be placed over the abyss."
            }
            :(a.hp=t.hp,a.row=t.row,a.col=t.col,a.statuses=t.statuses,a.shields=Math.max(0,Math.floor(t.shields)),a.hp===0?this.kill(a,"is removed by a manual HP change"):this.landing(a),this.log(`${v(a.color)} ${a.name} edited · no action spent.`), {
                ok:!0,message:"Manual changes applied for free."
            }
            )
        }
        )
    }
    remove(e) {
        return this.commit(()=> {
            const t=this.piece(e);
            return t?.alive&&!this.immortal(t)?(this.kill(t,"is manually removed"), {
                ok:!0,message:"Piece removed. King protection recalculated."
            }
            ): {
                ok:!1,message:"Piece is absent or is a protected king."
            }
        }
        )
    }
    // Free manual return: players decide which written ability permits it.
    resurrect(pieceId, target) {
        return this.commit(() => {
            const piece = this.piece(pieceId);
            const inside = Number.isInteger(target.row) && Number.isInteger(target.col)
                && target.row >= -4 && target.row <= 11 && target.col >= -4 && target.col <= 11;
            if (!inside || !piece || piece.alive || this.pieceAt(target)
                || this.objectAt(target) || this.terrain(target) !== "floor") {
                return {ok: false, message: "Choose an empty floor tile inside the board boundary."};
            }
            piece.alive = true;
            piece.hp = piece.maxHp;
            piece.row = target.row;
            piece.col = target.col;
            piece.resurrected = true;
            piece.moved = true;
            this.state.result = null;
            this.log(`${piece.name} returned by a manual effect.`);
            return {ok: true, message: `${piece.name} returned. No action spent.`};
        });
    }
    castle(e,t) {
        return this.commit(()=> {
            const a=this.piece(e),s=this.piece(t);
            if(!a||!s||a.type!=="king"||s.type!=="rook"||s.color!==a.color||!this.canAct(a)||!this.canAct(s)||a.moved||s.moved||s.resurrected||a.row!==s.row||a.col===s.col)return {
                ok:!1,message:"Both king and rook must be unmoved and eligible to act."
            }
            ;
            const r=Math.sign(s.col-a.col);
            for(let w=a.col+r;
            w!==s.col;
            w+=r)if(this.pieceAt( {
                row:a.row,col:w
            }
            ))return {
                ok:!1,message:"Pieces stand between the king and rook."
            }
            ;
            const n= {
                row:a.row,col:a.col
            }
            ,i= {
                row:s.row,col:s.col
            }
            ,d=(w,p,b)=> {
                const $=Array.from( {
                    length:16
                }
                ,(h,u)=>u-4).filter(h=> {
                    const u=this.pieceAt( {
                        row:a.row,col:h
                    }
                    );
                    return h!==b&&(!u||u.id===a.id||u.id===s.id)
                }
                );
                return $.sort((h,u)=>Math.abs(h-w)-Math.abs(u-w)||Math.abs(h-p)-Math.abs(u-p)),$[0]
            }
            ,c=d(a.col+r*2,s.col),g=d(a.col+r,a.col,c);
            return c===void 0||g===void 0?{
                ok:!1,message:"No free castling placement."
            }
            :this.immortal(a)&&this.terrain( {
                row:a.row,col:c
            }
            )==="hole"?{
                ok:!1,message:"Castling cannot place an immortal king over a hole."
            }
            :(a.col=c,s.col=g,a.moved=!0,s.moved=!0,this.state.acted.push(s.id),this.state.lastMove=[n,i, {
                row:a.row,col:a.col
            }
            , {
                row:s.row,col:s.col
            }
            ],this.landing(s),this.landing(a),this.log(`${v(a.color)} castles · one action, both pieces have acted.`),this.finishAction(a), {
                ok:!0,message:"Castling complete."
            }
            )
        }
        )
    }
    terrainAction(e,t) {
        return this.commit(()=> {
            if(this.state.result||this.state.terrainUsed||this.state.actions<1)return {
                ok:!1,message:"Only one terrain action per turn."
            }
            ;
            const a=[...new Map(t.map(r=>[oe(r),r])).values()];
            if(!a.length||a.length>(e==="floor"?8:1))return {
                ok:!1,message:e==="floor"?"Choose up to eight connected floor tiles.":"Change exactly one tile."
            }
            ;
            for(const r of a)if(!Number.isInteger(r.row)||!Number.isInteger(r.col)||r.row<-4||r.row>11||r.col<-4||r.col>11||this.pieceAt(r)||this.objectAt(r))return {
                ok:!1,message:"Terrain needs an empty tile inside the board boundary."
            }
            ;
            const s=e==="floor"&&a.some(r=>this.terrain(r)==="hole");
            if(s) {
                if(a.some(d=>this.terrain(d)!=="hole"))return {
                    ok:!1,message:"Floor creation cannot also change existing terrain."
                }
                ;
                const r=[...a],n=new Set(Object.entries(this.state.tiles).filter(([,d])=>d!=="hole").map(([d])=>d));
                let i=!0;
                for(;
                r.length&&i;
                ) {
                    i=!1;
                    for(let d=r.length-1;
                    d>=0;
                    d-=1) {
                        const c=r[d];
                        [ {
                            row:c.row-1,col:c.col
                        }
                        , {
                            row:c.row+1,col:c.col
                        }
                        , {
                            row:c.row,col:c.col-1
                        }
                        , {
                            row:c.row,col:c.col+1
                        }
                        ].some(g=>n.has(oe(g)))&&(n.add(oe(c)),r.splice(d,1),i=!0)
                    }
                }
                if(r.length)return {
                    ok:!1,message:"All new floor must connect by shared edges to the board and each other."
                }
            }
            else if(a.length!==1||this.terrain(a[0])==="hole"||this.terrain(a[0])===e)return {
                ok:!1,message:"Change one existing tile. Fill holes with floor creation."
            }
            ;
            for(const r of a)this.state.tiles[oe(r)]=e;
            return this.state.terrainUsed=!0,this.log(`${v(this.state.current)} ${s?`adds ${a.length} floor tile${a.length===1?"":"s"}`:`changes ${V(a[0])} to ${e}`} · one action.`),this.finishAction(), {
                ok:!0,message:"Terrain updated."
            }
        }
        )
    }
    createObject(e,t) {
        return this.commit(()=> {
            if(this.state.result||this.state.objectUsed||this.state.actions<1)return {
                ok:!1,message:"Only one object creation per turn."
            }
            ;
            if(this.state.objects.length>=4)return {
                ok:!1,message:"The board already holds four objects."
            }
            ;
            if(!Number.isInteger(e.row)||!Number.isInteger(e.col)||e.row<-4||e.row>11||e.col<-4||e.col>11)return {
                ok:!1,message:"Place the object within the board boundary."
            }
            ;
            if(![0,1,2].includes(e.radius)||!Number.isInteger(e.lingering)||e.lingering<0||e.lingering>3||!Number.isInteger(e.uses)||e.uses<1||e.uses>3)return {
                ok:!1,message:"Invalid object area, duration, or uses."
            }
            ;
            if(!e.collectible&&e.resurrection)return {
                ok:!1,message:"Only collectible items can be used for resurrection."
            }
            ;
            if(this.terrain(e)!=="floor"||this.pieceAt(e)||this.objectAt(e))return {
                ok:!1,message:"Place a new object on an open floor tile."
            }
            ;
            const a=this.state.current;
            return this.state.objects.push( {
                ...e,id:`object-${Date.now()}-${this.state.turn}`,hp:1,owner:a,activeAt:this.state.ownTurns[a]+1
            }
            ),this.state.approved.includes(t)||this.state.approved.push(t),this.state.objectUsed=!0,this.log(`${v(a)} creates ${e.name} at ${V(e)}. Activates on ${v(a)}’s next turn.`),this.finishAction(), {
                ok:!0,message:"Object placed. It is inactive for one full cycle."
            }
        }
        )
    }
    active(e) {
        return this.state.ownTurns[e.owner]>=e.activeAt
    }
    applyStatus(piece, object, exposed) {
        const existing = piece.statuses.find(status =>
            status.name.toLowerCase() === object.statusName.toLowerCase());
        const details = {
            name: object.statusName,
            remaining: object.lingering,
            clock: object.owner,
            exposed,
            color: normalizeColor(object.statusColor, "#9b69c8")
        };
        if (existing) Object.assign(existing, details, {exposed: exposed || existing.exposed});
        else piece.statuses.push(details);
    }
    refreshExposure() {
        this.collectOccupied();
        const previouslyExposed = new Set();
        for (const piece of this.state.pieces) {
            for (const status of piece.statuses) {
                if (status.exposed) previouslyExposed.add(`${piece.id}:${status.name.toLowerCase()}`);
                status.exposed = false;
            }
        }
        for (const object of this.state.objects) {
            if (!this.active(object) || object.collectible || !object.statusName) continue;
            for (const piece of this.state.pieces) {
                if (!piece.alive || piece.color === object.owner || !withinArea(piece, object)) continue;
                const key = `${piece.id}:${object.statusName.toLowerCase()}`;
                this.applyStatus(piece, object, true);
                if (!previouslyExposed.has(key)) this.log(`${piece.name}: ${object.statusName}. Resolve written effects with Edit.`);
            }
        }
        for (const piece of this.state.pieces) {
            for (const status of piece.statuses) {
                const key = `${piece.id}:${status.name.toLowerCase()}`;
                if (!status.exposed && previouslyExposed.has(key)) status.clock = this.state.current;
            }
            piece.statuses = piece.statuses.filter(status => status.exposed || status.remaining > 0);
        }
    }
    useItem(e) {
        return this.commit(()=> {
            const t=this.state.inventory[this.state.current][e];
            return!t||this.state.result||this.state.actions<1?{
                ok:!1,message:"No item is available to use."
            }
            :(this.log(`${v(this.state.current)} uses ${t.name}. Resolve its written ability using free Edit.`),this.consumeItem(t),this.finishAction(), {
                ok:!0,message:`${t.name} used. Apply custom effects with Edit.`
            }
            )
        }
        )
    }
    consumeItem(e) {
        e.consumable&&(e.uses-=1,e.uses<=0&&(this.state.inventory[this.state.current]=this.state.inventory[this.state.current].filter(t=>t.id!==e.id)))
    }
    surrender(e) {
        return this.commit(()=>this.state.result?{
            ok:!1,message:"Match already ended."
        }
        :(this.state.result=Y(e),this.log(`${v(e)} surrenders. ${v(Y(e))} wins.`), {
            ok:!0,message:`${v(Y(e))} wins.`
        }
        ))
    }
    draw() {
        return this.commit(()=>this.state.result||this.state.pieces.filter(e=>e.type==="king").some(e=>this.immortal(e))?{
            ok:!1,message:"Both kings must be mortal to record a draw."
        }
        :(this.state.result="draw",this.log("Both players record a simultaneous defeat. Draw."), {
            ok:!0,message:"Match drawn."
        }
        ))
    }
    checkEnding() {
        if(this.state.result)return;
        const e=this.state.pieces.filter(s=>s.type==="king"),t=e.some(s=>s.color==="white"&&(!s.alive||s.hp===0)),a=e.some(s=>s.color==="black"&&(!s.alive||s.hp===0));
        (t||a)&&(this.state.result=t&&a?"draw":t?"black":"white",this.log(this.state.result==="draw"?"Both kings fall. Draw.":`${v(this.state.result)} wins · the opposing king has fallen.`))
    }
}
const PIECE_SVG_SHAPES= {
    pawn:'<circle cx="32" cy="15" r="8"/><path d="M26 25h12l-2 11 7 10H21l7-10z"/><path d="M20 47h24l3 7H17z"/>',rook:'<path d="M17 9h7v7h5V9h6v7h5V9h7v16l-7 5 2 17H22l2-17-7-5z"/><path d="M19 47h26l3 7H16z"/><path d="M24 25h16" fill="none"/>',bishop:'<path d="M32 6c-1 5-13 11-13 20 0 6 5 10 13 10s13-4 13-10C45 17 33 11 32 6z"/><path d="m34 16-8 11" fill="none"/><path d="M27 35h10l3 12H24z"/><path d="M21 47h22l5 7H16z"/>',knight:'<path d="m23 10 7 5 7-6 5 12 6 8-3 11-9-6-5 5 8 8H21l-1-13 9-12-11 5-5-6z"/><path d="m24 13 9 7" fill="none"/><circle cx="35" cy="24" r="2" fill="currentColor" stroke="none"/><path d="M19 47h25l4 7H16z"/>',queen:'<path d="m16 19 9 7 7-15 7 15 9-7-7 24H23z"/><circle cx="16" cy="16" r="4"/><circle cx="32" cy="9" r="4"/><circle cx="48" cy="16" r="4"/><path d="M23 40h18v7H23z"/><path d="M20 47h24l4 7H16z"/>',king:'<path d="M29 6h6v6h6v6h-6v8h-6v-8h-6v-6h6z"/><path d="M23 27c-12-10-17 7-5 15h28c12-8 7-25-5-15l-9 5z"/><path d="M23 41h18v6H23z"/><path d="M20 47h24l4 7H16z"/>'
}
;
function createPieceSvg(o) {
    return`<svg class="piece-svg" viewBox="0 0 64 64" aria-hidden="true"><g stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">${PIECE_SVG_SHAPES[o.type]}</g></svg>`
}

// ============================================================================
// Visual state and free manual appearance changes
// ============================================================================
function normalizeColor(value, fallback = "#9b69c8") {
    return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toLowerCase() : fallback;
}
function withinArea(position, object) {
    return Math.max(Math.abs(position.row - object.row), Math.abs(position.col - object.col)) <= object.radius;
}
TrueChessGame.prototype.paintTiles = function (positions, color) {
    return this.commit(() => {
        if (!Array.isArray(positions) || !positions.length) return {ok:false, message:"Select at least one tile."};
        if (color !== null && !/^#[0-9a-f]{6}$/i.test(String(color))) return {ok:false, message:"Choose a valid color."};
        for (const position of positions) {
            if (!Number.isInteger(position.row) || !Number.isInteger(position.col)
                || position.row < -4 || position.row > 11 || position.col < -4 || position.col > 11) {
                return {ok:false, message:"Tile is outside the board boundary."};
            }
        }
        for (const position of positions) {
            if (color === null) delete this.state.tileColors[oe(position)];
            else this.state.tileColors[oe(position)] = normalizeColor(color);
        }
        return {ok:true, message:"Tile colors updated. No action spent; terrain rules are unchanged."};
    });
};
TrueChessGame.prototype.setAppearance = function (appearance) {
    return this.commit(() => {
        this.state.appearance = {background:normalizeColor(appearance.background, "#151515")};
        return {ok:true, message:"Background color saved for this match."};
    });
};

// ============================================================================
// Application state
// ============================================================================
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const localSaveKey = 'true-chess-rebuild-local-v2';
const clientId = crypto.randomUUID();
const pieceImageLetters = {pawn:'p', knight:'n', bishop:'b', rook:'r', queen:'q', king:'k'};

let game = new TrueChessGame();
let selectedId = null;
let selectedTile = null;
let mode = 'move';
let zoom = 0.85;
let terrainKind = 'floor';
let terrainSelection = [];
let terrainColor = '#75946b';
let pendingObject = null;
let room = null;
let busy = false;
let wheelRows = [{name:'Yes', weight:1}, {name:'No', weight:1}];
let toastTimer;

const selectedPiece = () => game.piece(selectedId);
const myColor = () => room?.color ?? game.state.current;
const canPlay = () => !busy && (!room || room.color === game.state.current);

function notify(message, error = false) {
    $('#toast').textContent = message;
    $('#toast').className = error ? 'visible error' : 'visible';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('#toast').className = ''; }, 4500);
}

// ============================================================================
// Room storage — one IndexedDB transaction per committed command
// ============================================================================
const databaseReady = new Promise((resolve, reject) => {
    const request = indexedDB.open('true-chess-rebuild', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('rooms', {keyPath:'code'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});
// Suppress an unhandled startup rejection; room operations report the error.
databaseReady.catch(() => {});
const channel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('true-chess-rebuild') : null;

async function roomTransaction(code, change = null) {
    const database = await databaseReady;
    return new Promise((resolve, reject) => {
        const transaction = database.transaction('rooms', change ? 'readwrite' : 'readonly');
        const store = transaction.objectStore('rooms');
        const request = store.get(code);
        let result;
        request.onsuccess = () => {
            try {
                result = change ? change(request.result) : request.result;
                if (change) store.put(result);
            } catch (error) {
                transaction.abort();
                reject(error);
            }
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error || new Error('Room save failed.'));
        transaction.onabort = () => reject(transaction.error || new Error('Room change canceled.'));
    });
}
function broadcast(details = {}) {
    if (room) channel?.postMessage({code:room.code, ...details});
}
async function refreshRoom(shot = null) {
    if (!room) return;
    const activeRoom = room;
    try {
        const record = await roomTransaction(activeRoom.code);
        if (room !== activeRoom) return;
        if (!record) throw new Error('Room no longer exists.');
        if (record.revision !== room.revision) {
            game = new TrueChessGame(record.state);
            room.revision = record.revision;
            if (!selectedPiece()?.alive && mode !== 'return') selectedId = null;
            render();
        }
        const opponentPresent = Date.now() - (record.seats[Y(room.color)]?.seen ?? 0) < 20000;
        $('#connection').textContent = `ROOM ${room.code} · YOU: ${room.color.toUpperCase()} · ${opponentPresent ? 'opponent connected' : 'waiting for opponent'}`;
        if (shot) animateProjectile(shot);
    } catch (error) { notify(error.message, true); }
}
channel?.addEventListener('message', event => {
    if (!room || event.data.code !== room.code) return;
    refreshRoom(event.data.shot);
    if (event.data.notice) notify(event.data.notice);
});
setInterval(async () => {
    if (!room || busy) return;
    const activeRoom = room;
    try {
        await roomTransaction(activeRoom.code, record => {
            if (record?.seats[activeRoom.color]?.id !== clientId) throw new Error('Your seat was replaced.');
            record.seats[activeRoom.color].seen = Date.now();
            return record;
        });
        await refreshRoom();
    } catch (error) { notify(error.message, true); }
}, 5000);

async function leaveRoom() {
    if (!room) return;
    const previous = room;
    try {
        await roomTransaction(previous.code, record => {
            if (!record) throw new Error('Room no longer exists.');
            if (record.seats[previous.color]?.id === clientId) record.seats[previous.color].seen = 0;
            return record;
        });
        broadcast();
    } catch (error) { console.warn(error); }
    room = null;
}
async function startLocal(reset = false) {
    await leaveRoom();
    let saved = null;
    try {
        if (reset) localStorage.removeItem(localSaveKey);
        else saved = JSON.parse(localStorage.getItem(localSaveKey));
    } catch (error) { notify('Local save could not be read.', true); }
    game = new TrueChessGame(saved?.pieces?.length === 32 ? saved : undefined);
    selectedId = null;
    selectedTile = null;
    mode = 'move';
    pendingObject = null;
    zoom = 0.85;
    closeAllWindows();
    $('#menu').hidden = true;
    render();
}
async function createRoom() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const random = crypto.getRandomValues(new Uint32Array(6));
    const code = Array.from(random, number => alphabet[number % alphabet.length]).join('');
    try {
        await leaveRoom();
        await roomTransaction(code, existing => {
            if (existing) throw new Error('Code collision. Please create another room.');
            return {code, state:createInitialGameState(), history:[], revision:0,
                seats:{white:{id:clientId, seen:Date.now()}}};
        });
        room = {code, color:'white', revision:-1};
        closeAllWindows();
        $('#menu').hidden = true;
        selectedId = null;
        mode = 'move';
        await refreshRoom();
        broadcast();
        notify(`Room ${code}. Open another tab and join as Black.`);
    } catch (error) { notify(error.message, true); }
}
function openJoinRoom() {
    const panel = floatingWindow('Join a two-tab room', `
        <p>Open this same site in the same browser profile in both tabs.</p>
        <label>Room code<input id="join-code" maxlength="6" autocomplete="off"></label>
        <p id="join-error" class="field-error"></p>`,
        '<button id="join-confirm" class="primary">Join as Black</button>', false, 'join-room');
    if (!panel) return;
    panel.querySelector('#join-confirm').onclick = async () => {
        try {
            const code = panel.querySelector('#join-code').value.trim().toUpperCase();
            if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('Enter a six-character code.');
            // Validate the room before giving up any existing seat.
            const existing = await roomTransaction(code);
            if (!existing) throw new Error('No room with that code in this browser.');
            if (existing.seats.white.id === clientId) throw new Error('Join from your other tab.');
            await leaveRoom();
            await roomTransaction(code, record => {
                const blackSeat = record.seats.black;
                if (blackSeat && blackSeat.id !== clientId && Date.now() - blackSeat.seen < 20000) {
                    throw new Error('Black is already connected. Wait 20 seconds after closing that tab.');
                }
                record.seats.black = {id:clientId, seen:Date.now()};
                return record;
            });
            room = {code, color:'black', revision:-1};
            closeAllWindows();
            $('#menu').hidden = true;
            selectedId = null;
            mode = 'move';
            await refreshRoom();
            broadcast();
        } catch (error) { panel.querySelector('#join-error').textContent = error.message; }
    };
}

// All mutations, including visual changes, pass through this shared command path.
function applyCommand(engine, method, args) {
    if (method === 'wheel-result') {
        return engine.commit(() => {
            engine.log(`Wheel: ${args[0]}`);
            return {ok:true, message:`Wheel: ${args[0]}`};
        });
    }
    const allowed = ['move','attack','transform','edit','remove','reposition','resurrect',
        'terrainAction','createObject','useItem','skip','undo','promote','castle',
        'surrender','draw','paintTiles','setAppearance'];
    if (!allowed.includes(method)) return {ok:false, message:'Unknown action.'};
    return engine[method](...args);
}
async function perform(method, args = [], shot = null) {
    if (busy) return false;
    const allowedOffTurn = ['undo', 'wheel-result'];
    if (!canPlay() && !allowedOffTurn.includes(method)) {
        notify('Wait for your turn.', true);
        return false;
    }
    busy = true;
    let success = false;
    try {
        let result;
        if (room) {
            const activeRoom = room;
            const revision = room.revision;
            const record = await roomTransaction(room.code, record => {
                if (record.seats[activeRoom.color]?.id !== clientId) throw new Error('You no longer hold this seat.');
                if (record.revision !== revision) throw new Error('The board changed. Try again on the updated board.');
                if (record.state.current !== activeRoom.color && !allowedOffTurn.includes(method)) throw new Error('Wait for your turn.');
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
            broadcast({shot, notice:method === 'wheel-result' ? result.message : null});
        } else {
            result = applyCommand(game, method, args);
            if (!result.ok) throw new Error(result.message);
        }
        mode = 'move';
        terrainSelection = [];
        pendingObject = null;
        if (!room) {
            try { localStorage.setItem(localSaveKey, JSON.stringify(game.state)); }
            catch { notify('Change applied, but local autosave failed: browser storage is full.', true); }
        }
        render();
        if (shot) animateProjectile(shot);
        notify(result.message);
        success = true;
    } catch (error) {
        notify(error.message, true);
        await refreshRoom();
    } finally {
        busy = false;
        renderHeader();
        updateWindowButtons();
    }
    return success;
}

// ============================================================================
// Rendering — identical square tracks, images, custom colors, and status areas
// ============================================================================
function pieceMarkup(piece) {
    const file = `${piece.color === 'white' ? 'w' : 'b'}${pieceImageLetters[piece.type]}.png`;
    const image = piece.artwork || `images/${file}`;
    return `<span class="piece ${piece.color} ${piece.id === selectedId ? 'chosen' : ''}">
        <img draggable="false" src="${escapeHTML(image)}" alt="${escapeHTML(piece.name)}">
        ${piece.shields ? `<span class="shield-count">${piece.shields}</span>` : ''}
    </span>`;
}
function boardBounds() {
    if (mode === 'edit-move') return {minRow:-4, maxRow:11, minCol:-4, maxCol:11};
    const points = Object.keys(game.state.tiles).map(key => {
        const [row, col] = key.split(',').map(Number);
        return {row, col};
    });
    points.push(...game.state.pieces.filter(piece => piece.alive));
    const margin = mode === 'terrain' ? 1 : 0;
    return {
        minRow:Math.max(-4, Math.min(0, ...points.map(point => point.row)) - margin),
        maxRow:Math.min(11, Math.max(7, ...points.map(point => point.row)) + margin),
        minCol:Math.max(-4, Math.min(0, ...points.map(point => point.col)) - margin),
        maxCol:Math.min(11, Math.max(7, ...points.map(point => point.col)) + margin)
    };
}
function renderHeader() {
    const state = game.state;
    $('#turn').textContent = state.result
        ? (state.result === 'draw' ? 'Draw' : `${v(state.result)} wins — Undo remains available`)
        : `${v(state.current)} · ${state.actions}/2 actions · Turn ${state.turn}`;
    if (!room) $('#connection').textContent = 'LOCAL · both sides on this board';
    $('#end-turn').disabled = !canPlay() || Boolean(state.result);
    $('#zoom-value').textContent = `${Math.round(zoom * 100)}%`;
    const prompts = {
        move:'Drag or click to move · Right-click a piece for other actions',
        return:'Place the captured piece on an empty floor tile',
        terrain:'Select tiles, then change terrain or paint their color',
        object:'Place your object on empty floor',
        'edit-move':'Free placement: click a destination'
    };
    $('#mode').textContent = prompts[mode] || `Choose a ${mode} target`;
}
function statusAreaMarkup(position) {
    return game.state.objects
        .filter(object => game.active(object) && !object.collectible && object.statusName && withinArea(position, object))
        .map(object => `<span class="status-area" style="--status-color:${normalizeColor(object.statusColor)}" aria-hidden="true"></span>`)
        .join('');
}
function objectMarkup(object) {
    const classes = `board-object ${object.collectible ? 'collectible' : 'centered-object'} ${game.active(object) ? '' : 'inactive'}`;
    return `<span class="${classes}">${object.artwork
        ? `<img draggable="false" src="${escapeHTML(object.artwork)}" alt="${escapeHTML(object.name)}">`
        : '◆'}</span>`;
}
function render() {
    document.documentElement.style.setProperty('--game-background', normalizeColor(game.state.appearance.background, '#151515'));
    renderHeader();
    const bounds = boardBounds();
    const rows = bounds.maxRow - bounds.minRow + 1;
    const columns = bounds.maxCol - bounds.minCol + 1;
    const board = $('#board');
    board.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    board.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    board.dataset.rows = rows;
    board.dataset.cols = columns;
    const tiles = [];
    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
            const position = {row, col};
            const piece = game.pieceAt(position);
            const object = game.objectAt(position);
            const terrain = game.terrain(position);
            const tilePicked = (!piece && selectedTile && G(position, selectedTile))
                || terrainSelection.some(tile => G(position, tile));
            const paint = game.state.tileColors[oe(position)];
            const customStyle = paint ? `style="--tile-color:${normalizeColor(paint)}"` : '';
            const title = `${V(position)} · ${piece?.name || object?.name || terrain}`;
            tiles.push(`<button class="tile ${(row + col) % 2 ? 'dark' : 'light'} ${terrain} ${tilePicked ? 'tile-picked' : ''}"
                data-row="${row}" data-col="${col}" ${customStyle}
                title="${escapeHTML(title)}" aria-label="${escapeHTML(title)}">
                ${statusAreaMarkup(position)}
                ${terrain === 'mountain' ? '<span class="mountain">▲</span>' : ''}
                ${piece ? pieceMarkup(piece) : ''}
                ${object ? objectMarkup(object) : ''}
            </button>`);
        }
    }
    board.innerHTML = tiles.join('');
    renderSidebar();
    fitBoard();
    updateWindowButtons();
}
function fitBoard() {
    const stage = $('#board-stage');
    const board = $('#board');
    const rows = Number(board.dataset.rows) || 8;
    const columns = Number(board.dataset.cols) || 8;
    const cell = Math.max(12, Math.min((stage.clientWidth - 60) / columns, (stage.clientHeight - 60) / rows)) * zoom;
    board.style.width = `${cell * columns}px`;
    board.style.height = `${cell * rows}px`;
    stage.style.justifyContent = cell * columns + 40 > stage.clientWidth ? 'flex-start' : 'center';
    stage.style.alignItems = cell * rows + 40 > stage.clientHeight ? 'flex-start' : 'center';
    $('#zoom-value').textContent = `${Math.round(zoom * 100)}%`;
}
function statusDescription(piece) {
    if (!piece.statuses.length) return '';
    return `<div class="piece-statuses"><h3>Status effects</h3>${piece.statuses.map(status => {
        const duration = status.exposed
            ? `While in an active area; ${status.remaining} lingering cycle${status.remaining === 1 ? '' : 's'} after leaving`
            : `${status.remaining} cycle${status.remaining === 1 ? '' : 's'} remaining`;
        const clock = status.clock ? ` · ticks when ${v(status.clock)}'s turn begins` : '';
        return `<p class="status-description" style="--status-color:${normalizeColor(status.color)}">
            <span class="status-swatch"></span><span>${escapeHTML(status.name)}<small>${escapeHTML(duration + clock)}</small></span></p>`;
    }).join('')}</div>`;
}
function renderSidebar() {
    const piece = selectedPiece();
    $('#piece-info').hidden = !piece?.alive;
    $('#piece-info').innerHTML = piece?.alive ? `
        <div class="portrait">${pieceMarkup(piece)}</div>
        <div><h2>${escapeHTML(piece.name)}</h2>
            <p class="description">${escapeHTML(piece.description)}</p>${statusDescription(piece)}</div>` : '';
    if (mode === 'terrain') {
        $('#world-actions').innerHTML = `
            <h3>Terrain & tile colors</h3>
            <p>Terrain: one action, empty tiles only. Paint: free, any selected tiles; changes appearance only.</p>
            <div class="button-row terrain-buttons">${['floor','mountain','hole'].map(kind =>
                `<button data-terrain="${kind}" class="${terrainKind === kind ? 'active' : ''}">${v(kind)}</button>`).join('')}</div>
            <label class="color-field">Tile color<input type="color" id="terrain-color" value="${terrainColor}"></label>
            <p>${terrainSelection.length} selected</p>
            <div class="world-buttons">
                <button data-action="terrain-apply">Change terrain</button>
                <button data-action="paint-tiles">Paint only</button>
                <button data-action="clear-paint">Clear paint</button>
                <button data-action="cancel">Cancel</button>
            </div>`;
    } else {
        $('#world-actions').innerHTML = `
            <h3>${piece?.alive ? 'Battlefield' : 'Your battlefield'}</h3>
            <div class="world-buttons">
                <button data-action="terrain">Terrain</button>
                <button data-action="object">Objects</button>
                <button data-action="edit">Edit${piece?.alive ? ' piece' : ''}</button>
                <button data-action="undo">Undo</button>
                <button data-action="appearance">Background color</button>
            </div>
            ${pendingObject ? '<p>Click empty floor to place the object.</p><button data-action="cancel">Cancel placement</button>' : ''}`;
    }
    $('#captured').innerHTML = game.state.pieces.filter(piece => !piece.alive).map(piece =>
        `<button class="captured-piece" data-return="${piece.id}" title="Return ${escapeHTML(piece.name)}">${pieceMarkup(piece)}</button>`
    ).join('') || '<small>No captured pieces</small>';
    const inventory = game.state.inventory[myColor()];
    $('#inventory').innerHTML = [0,1,2].map(index => {
        const item = inventory[index];
        return `<button class="inventory-slot" ${item ? `data-item="${index}" title="${escapeHTML(item.name)}"` : 'disabled aria-label="Empty inventory slot"'}>
            ${item ? (item.artwork ? `<img src="${escapeHTML(item.artwork)}" alt="${escapeHTML(item.name)}">` : '◆') : ''}</button>`;
    }).join('');
}

// ============================================================================
// Board interaction and action dispatch
// ============================================================================
function tilePosition(element) {
    return {row:Number(element.dataset.row), col:Number(element.dataset.col)};
}
async function clickTile(position) {
    if (mode === 'terrain') {
        const index = terrainSelection.findIndex(tile => G(tile, position));
        if (index >= 0) terrainSelection.splice(index, 1);
        else terrainSelection.push(position);
        render();
        return;
    }
    const piece = selectedPiece();
    if (mode === 'object' && pendingObject) return perform('createObject', [{...pendingObject, ...position}, pendingObject.signature || '']);
    if (mode === 'return' && piece) return perform('resurrect', [piece.id, position]);
    if (mode === 'edit-move' && piece) return perform('reposition', [piece.id, position]);
    if (['melee','projectile'].includes(mode) && piece) {
        const shot = mode === 'projectile' ? {from:{row:piece.row, col:piece.col}, to:position} : null;
        return perform('attack', [piece.id, position, mode === 'projectile'], shot);
    }
    const target = game.pieceAt(position);
    if (piece?.alive && target?.id !== piece.id && game.legalMove(piece, position)) {
        return perform('move', [piece.id, position]);
    }
    selectedId = target?.id ?? null;
    selectedTile = target ? null : position;
    mode = 'move';
    render();
    if (!target) {
        const object = game.objectAt(position);
        if (object) inspectObject(object);
    }
}
function closeContext() { $('#context-menu')?.remove(); }
function contextMenu(event) {
    const tile = event.target.closest('.tile');
    if (!tile) return;
    event.preventDefault();
    closeContext();
    const position = tilePosition(tile);
    const piece = game.pieceAt(position);
    if (!piece) {
        selectedId = null;
        selectedTile = position;
        render();
        return;
    }
    selectedId = piece.id;
    mode = 'move';
    render();
    const options = [['move','Move']];
    // Exactly one damage-combat option, never melee AND projectiles.
    if (!game.instant(piece)) {
        options.push(game.combat(piece) === 'ranged' ? ['projectile','Projectile'] : ['melee','Melee']);
    }
    if (piece.form === 'OG' && !piece.transformedOnce) options.push(['transform','Transform']);
    if (piece.type === 'pawn' && piece.row === (piece.color === 'white' ? 0 : 7)) options.push(['promote','Promote']);
    if (piece.type === 'king') options.push(['castle','Castle']);
    options.push(['edit','Edit']);
    const menu = document.createElement('div');
    menu.id = 'context-menu';
    menu.innerHTML = options.map(([action,label]) => `<button data-action="${action}">${label}</button>`).join('');
    document.body.append(menu);
    menu.style.left = `${Math.max(0, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(0, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8))}px`;
    updateWindowButtons();
}
async function handleAction(action) {
    closeContext();
    const piece = selectedPiece();
    const requiresTurn = ['transform','terrain','object','edit','melee','projectile','castle','promote','appearance'];
    if (requiresTurn.includes(action) && !canPlay()) return notify('Wait for your turn.', true);
    switch (action) {
        case 'move': mode = 'move'; render(); break;
        case 'melee':
        case 'projectile': {
            const requestedCombat = action === 'projectile' ? 'ranged' : 'melee';
            if (!piece || !game.canAct(piece) || game.combat(piece) !== requestedCombat) {
                return notify('That combat option is unavailable for this piece.', true);
            }
            mode = action; render(); break;
        }
        case 'transform': if (piece) openCreator('piece'); break;
        case 'object': openCreator('object'); break;
        case 'terrain':
            selectedId = null; mode = 'terrain'; terrainSelection = []; render(); break;
        case 'terrain-apply': await perform('terrainAction', [terrainKind, terrainSelection]); break;
        case 'paint-tiles': await perform('paintTiles', [terrainSelection, terrainColor]); break;
        case 'clear-paint': await perform('paintTiles', [terrainSelection, null]); break;
        case 'edit':
            if (piece?.alive) openPieceEditor(piece);
            else notify('Select a piece, then choose Edit. Use Terrain to paint tiles.');
            break;
        case 'appearance': openAppearance(); break;
        case 'undo': await perform('undo'); break;
        case 'cancel': mode = 'move'; pendingObject = null; terrainSelection = []; render(); break;
        case 'end-turn': await perform('skip'); break;
        case 'wheel': openWheel(); break;
        case 'menu': $('#menu').hidden = false; break;
        case 'local': await startLocal(); break;
        case 'reset-local': {
            const panel = floatingWindow('Reset local match?', '<p>Replace your saved local match? Room matches are not reset.</p>',
                '<button id="reset-confirm" class="primary">Reset local match</button>', false, 'reset-local');
            if (panel) panel.querySelector('#reset-confirm').onclick = () => startLocal(true);
            break;
        }
        case 'create-room': await createRoom(); break;
        case 'join-room': openJoinRoom(); break;
        case 'room-info': notify(room ? `Room ${room.code}. You are ${room.color}. Join from your other tab.` : 'Create a two-tab room from the menu.'); break;
        case 'zoom-in': zoom = Math.min(2.4, zoom + 0.1); fitBoard(); break;
        case 'zoom-out': zoom = Math.max(0.25, zoom - 0.1); fitBoard(); break;
        case 'zoom-fit': zoom = 0.85; fitBoard(); break;
        case 'promote': choosePromotion(piece); break;
        case 'castle': chooseCastle(piece); break;
    }
}

// ============================================================================
// Dragging and projectile animation
// ============================================================================
let drag = null;
let dragFrame = 0;
let suppressClick = false;
function startDrag(event) {
    const tile = event.target.closest('.tile');
    const captured = event.target.closest('[data-return]');
    if (event.button !== 0 || (!tile && !captured)) return;
    if (!captured && !['move','edit-move','return'].includes(mode)) return;
    const piece = captured ? game.piece(captured.dataset.return) : game.pieceAt(tilePosition(tile));
    if (!piece || !canPlay() || (!captured && mode === 'move' && !game.canAct(piece))) return;
    if (captured) { selectedId = piece.id; mode = 'return'; }
    drag = {
        id:piece.id, startX:event.clientX, startY:event.clientY,
        targetX:event.clientX, targetY:event.clientY, x:event.clientX, y:event.clientY,
        angle:0, spin:0, last:performance.now(), active:false
    };
}
function moveDrag(event) {
    if (!drag) return;
    drag.targetX = event.clientX;
    drag.targetY = event.clientY;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) {
        drag.active = true;
        selectedId = drag.id;
        render();
        $('#board .chosen')?.classList.add('drag-source');
        const ghost = document.createElement('div');
        ghost.id = 'drag-ghost';
        ghost.innerHTML = pieceMarkup(game.piece(drag.id));
        const cell = $('#board .tile').getBoundingClientRect();
        ghost.style.width = `${cell.width}px`;
        ghost.style.height = `${cell.height}px`;
        document.body.append(ghost);
        dragFrame = requestAnimationFrame(updateDrag);
    }
    if (drag.active) event.preventDefault();
}
function updateDrag(now) {
    if (!drag?.active) return;
    const seconds = Math.min(0.032, Math.max(0.001, (now - drag.last) / 1000));
    drag.last = now;
    const previousX = drag.x;
    const follow = 1 - Math.exp(-35 * seconds);
    drag.x += (drag.targetX - drag.x) * follow;
    drag.y += (drag.targetY - drag.y) * follow;
    const velocity = (drag.x - previousX) / seconds;
    const targetAngle = Math.max(-0.65, Math.min(0.65, -velocity / 1800));
    drag.spin += (targetAngle - drag.angle) * 75 * seconds;
    drag.spin *= Math.exp(-13 * seconds);
    drag.angle += drag.spin * seconds;
    const ghost = $('#drag-ghost');
    if (ghost) {
        ghost.style.left = `${drag.x}px`;
        ghost.style.top = `${drag.y}px`;
        ghost.style.transform = `translate(-50%,-50%) rotate(${drag.angle}rad)`;
    }
    dragFrame = requestAnimationFrame(updateDrag);
}
function cancelDrag() {
    cancelAnimationFrame(dragFrame);
    $('#drag-ghost')?.remove();
    $('.drag-source')?.classList.remove('drag-source');
    drag = null;
}
async function endDrag(event) {
    if (!drag) return;
    const current = drag;
    cancelDrag();
    if (!current.active) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 100);
    const tile = document.elementFromPoint(event.clientX, event.clientY)?.closest('.tile');
    if (!tile) { render(); return; }
    const target = tilePosition(tile);
    const piece = game.piece(current.id);
    if (piece.alive && G(piece, target)) { render(); return; }
    const method = mode === 'return' ? 'resurrect' : mode === 'edit-move' ? 'reposition' : 'move';
    await perform(method, [piece.id, target]);
}
function animateProjectile(shot) {
    const from = $(`.tile[data-row="${shot.from.row}"][data-col="${shot.from.col}"]`);
    const to = $(`.tile[data-row="${shot.to.row}"][data-col="${shot.to.col}"]`);
    if (!from || !to) return;
    const start = from.getBoundingClientRect();
    const end = to.getBoundingClientRect();
    const x = start.x + start.width / 2;
    const y = start.y + start.height / 2;
    const dx = end.x + end.width / 2 - x;
    const dy = end.y + end.height / 2 - y;
    const projectile = document.createElement('div');
    projectile.className = 'projectile';
    projectile.style.left = `${x}px`;
    projectile.style.top = `${y}px`;
    document.body.append(projectile);
    const animation = projectile.animate([
        {transform:'translate(-50%,-50%) scale(.7)', opacity:1},
        {transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(1.3)`, opacity:1}
    ], {duration:Math.max(200, Math.min(700, Math.hypot(dx, dy) * 1.4)), easing:'linear'});
    animation.onfinish = () => {
        projectile.remove();
        to.animate([{filter:'brightness(2)'}, {filter:'brightness(1)'}], {duration:200});
    };
}

// ============================================================================
// Floating windows — one instance per type; no modal backdrop
// ============================================================================
const openWindows = new Map();
let windowLayer = 30;
const actionWindowTypes = {
    object:'object-creator', transform:'piece-creator', edit:'piece-editor',
    wheel:'wheel', appearance:'appearance', 'join-room':'join-room',
    'reset-local':'reset-local', promote:'promotion', castle:'castle'
};
function updateWindowButtons() {
    document.querySelectorAll('[data-action]').forEach(button => {
        const type = actionWindowTypes[button.dataset.action];
        if (!type) return;
        const opened = openWindows.get(type)?.isConnected;
        button.disabled = Boolean(opened);
        button.title = opened ? 'This window is already open. Close it to open another.' : '';
    });
}
function closeWindow(panel) {
    if (!panel) return;
    const type = panel.dataset.windowType;
    if (openWindows.get(type) === panel) openWindows.delete(type);
    panel.remove();
    updateWindowButtons();
}
function closeAllWindows() {
    for (const panel of openWindows.values()) panel.remove();
    openWindows.clear();
    updateWindowButtons();
}
function floatingWindow(title, body, footer = '', wide = false, type = title) {
    const existing = openWindows.get(type);
    if (existing?.isConnected) {
        existing.style.zIndex = ++windowLayer;
        existing.querySelector('.window-header').animate([{background:'#68604b'}, {background:'#343434'}], {duration:400});
        return null;
    }
    const panel = document.createElement('section');
    panel.className = `floating-window ${wide ? 'wide' : ''}`;
    panel.dataset.windowType = type;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', title);
    panel.style.zIndex = ++windowLayer;
    panel.innerHTML = `<header class="window-header"><h2>${escapeHTML(title)}</h2>
        <button class="window-close" aria-label="Close">×</button></header>
        <div class="window-body">${body}</div>
        ${footer ? `<footer class="window-footer">${footer}</footer>` : ''}`;
    $('#windows').append(panel);
    openWindows.set(type, panel);
    panel.style.left = `${Math.max(8, Math.min(innerWidth - panel.offsetWidth - 8, 50 + openWindows.size * 20))}px`;
    panel.style.top = `${Math.max(8, Math.min(innerHeight - panel.offsetHeight - 8, 70 + openWindows.size * 15))}px`;
    panel.querySelector('.window-close').onclick = () => closeWindow(panel);
    panel.querySelectorAll('[data-dismiss]').forEach(button => { button.onclick = () => closeWindow(panel); });
    panel.onpointerdown = () => { panel.style.zIndex = ++windowLayer; };
    const header = panel.querySelector('.window-header');
    header.onpointerdown = event => {
        if (event.target.closest('button')) return;
        event.preventDefault();
        header.setPointerCapture(event.pointerId);
        const rectangle = panel.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        header.onpointermove = move => {
            panel.style.left = `${Math.max(0, Math.min(Math.max(0, innerWidth - panel.offsetWidth), rectangle.left + move.clientX - startX))}px`;
            panel.style.top = `${Math.max(0, Math.min(Math.max(0, innerHeight - panel.offsetHeight), rectangle.top + move.clientY - startY))}px`;
        };
        header.onpointerup = header.onpointercancel = () => { header.onpointermove = null; };
    };
    updateWindowButtons();
    return panel;
}
function openAppearance() {
    const panel = floatingWindow('Background color', `
        <p>Saved with this match and synchronized to the other tab. Undo restores the previous color.</p>
        <label class="color-field">Game background
            <input id="background-color" type="color" value="${normalizeColor(game.state.appearance.background, '#151515')}">
        </label>`, '<button id="save-background" class="primary">Apply</button>', false, 'appearance');
    if (!panel) return;
    panel.querySelector('#save-background').onclick = async () => {
        if (await perform('setAppearance', [{background:panel.querySelector('#background-color').value}])) closeWindow(panel);
    };
}
function openPieceEditor(piece) {
    const panel = floatingWindow(`Edit ${piece.name}`, `
        <p>Free manual effects. Protected kings cannot lose HP or be removed.</p>
        <div class="form-grid">
            <label>Health (max ${piece.maxHp})<input id="edit-hp" type="number" min="0" max="${piece.maxHp}" value="${piece.hp}"></label>
            <label>Shields<input id="edit-shields" type="number" min="0" value="${piece.shields}"></label>
            <label class="full">Statuses: name : cycles<textarea id="edit-status">${escapeHTML(piece.statuses.map(status => `${status.name} : ${status.remaining}`).join('\n'))}</textarea></label>
            <label class="color-field full">Color for new manual statuses<input id="edit-status-color" type="color" value="#9b69c8"></label>
        </div><p id="edit-error" class="field-error"></p>`,
        '<button id="edit-location">Free location</button><button id="edit-remove">Remove</button><button id="edit-apply" class="primary">Apply</button>', false, 'piece-editor');
    if (!panel) return;
    panel.querySelector('#edit-location').onclick = () => {
        selectedId = piece.id; mode = 'edit-move'; closeWindow(panel); render();
    };
    panel.querySelector('#edit-remove').onclick = async () => {
        if (await perform('remove', [piece.id])) closeWindow(panel);
    };
    panel.querySelector('#edit-apply').onclick = async () => {
        const current = game.piece(piece.id);
        if (!current?.alive) { panel.querySelector('#edit-error').textContent = 'That piece is no longer on the board.'; return; }
        const statuses = [];
        for (const line of panel.querySelector('#edit-status').value.split(/\n/).filter(line => line.trim())) {
            const [name, raw] = line.split(':');
            const remaining = Number(raw?.trim() || 1);
            if (!name.trim() || !Number.isInteger(remaining) || remaining < 0 || remaining > 3) {
                panel.querySelector('#edit-error').textContent = 'Use name : cycles, with cycles from 0 to 3.';
                return;
            }
            const previous = current.statuses.find(status => status.name.toLowerCase() === name.trim().toLowerCase());
            statuses.push({
                name:name.trim(), remaining, clock:previous?.clock || game.state.current,
                exposed:previous?.exposed || false,
                color:normalizeColor(previous?.color || panel.querySelector('#edit-status-color').value)
            });
        }
        const success = await perform('edit', [piece.id, {
            row:current.row, col:current.col, hp:Number(panel.querySelector('#edit-hp').value),
            shields:Number(panel.querySelector('#edit-shields').value), statuses
        }]);
        if (success) closeWindow(panel);
    };
}
function inspectObject(object) {
    floatingWindow(object.name, `${object.artwork ? `<img class="object-preview" src="${escapeHTML(object.artwork)}" alt="">` : ''}
        <p class="description">${escapeHTML(object.description)}</p>
        <p>${game.active(object) ? 'Active' : 'Activates next owner turn'} · ${object.collectible ? 'Collectible' : 'Area trigger'}</p>
        ${object.statusName ? `<p>Status: ${escapeHTML(object.statusName)} · ${object.lingering} lingering cycles</p>` : ''}`,
        '', false, 'object-inspector');
}
function inspectItem(index) {
    const item = game.state.inventory[myColor()][index];
    if (!item) return;
    const panel = floatingWindow(item.name, `${item.artwork ? `<img class="object-preview" src="${escapeHTML(item.artwork)}" alt="">` : ''}
        <p class="description">${escapeHTML(item.description)}</p>
        <p>${item.consumable ? `${item.uses} uses left` : 'Unlimited uses'}. Apply written effects using Edit or the captured-piece tray.</p>`,
        '<button id="use-item" class="primary">Use · 1 action</button>', false, 'inventory-item');
    if (!panel) return;
    panel.querySelector('#use-item').onclick = async () => {
        const currentIndex = game.state.inventory[myColor()].findIndex(current => current.id === item.id);
        if (currentIndex < 0) return notify('That item is no longer in your inventory.', true);
        if (await perform('useItem', [currentIndex])) closeWindow(panel);
    };
}
function choosePromotion(piece) {
    if (!piece) return;
    const body = ['queen','rook','bishop','knight'].map(type => `<button data-promote="${type}">${v(type)}</button>`).join('');
    const panel = floatingWindow('Promote pawn', body, '', false, 'promotion');
    if (!panel) return;
    panel.querySelectorAll('[data-promote]').forEach(button => {
        button.onclick = async () => { if (await perform('promote', [piece.id, button.dataset.promote])) closeWindow(panel); };
    });
}
function chooseCastle(piece) {
    if (!piece) return;
    const rooks = game.state.pieces.filter(rook => rook.alive && rook.type === 'rook' && rook.color === piece.color);
    const body = rooks.map(rook => `<button data-rook="${rook.id}">Rook at ${V(rook)}</button>`).join('') || '<p>No surviving rook.</p>';
    const panel = floatingWindow('Castle', body, '', false, 'castle');
    if (!panel) return;
    panel.querySelectorAll('[data-rook]').forEach(button => {
        button.onclick = async () => { if (await perform('castle', [piece.id, button.dataset.rook])) closeWindow(panel); };
    });
}

// ============================================================================
// Transformation / object artwork editor
// ============================================================================
function openCreator(kind, initial = null) {
    const piece = selectedPiece();
    if (kind === 'piece' && (!piece || !game.canAct(piece))) return;
    const defaults = {
        kind, id:piece?.id || '', name:'', description:'', artwork:'', projectile:false,
        keepStatuses:true, collectible:false, consumable:false, resurrection:false,
        uses:1, radius:1, statusName:'', statusColor:'#9b69c8', lingering:1, onDestroy:false
    };
    const creation = {...defaults, ...initial};
    const checked = value => value ? 'checked' : '';
    const title = kind === 'piece' ? 'Create a transformation' : 'Create an object';
    const introduction = kind === 'piece'
        ? 'Draw or upload your character, name it, and describe its abilities. Base stats stay unchanged. Choose melee OR projectiles, never both. Transformation costs one action; no approval roll.'
        : 'Draw a 1 HP object. Maximum four on the board. It activates on its owner’s next turn. Collectibles use a corner icon; other objects use the tile center.';
    const combatFields = `
        <div class="field full">
            <label class="toggle"><input type="checkbox" id="creation-projectile" ${checked(creation.projectile)}>Use projectiles instead of melee</label>
            <label class="toggle"><input type="checkbox" id="creation-keep" ${checked(creation.keepStatuses)}>Keep existing statuses</label>
        </div>`;
    const objectFields = `
        <div class="field full">
            <label>Object type</label>
            <label class="toggle"><input type="radio" name="object-type" id="creation-item" ${checked(creation.collectible)}>Collectible · automatically enters inventory</label>
            <label class="toggle"><input type="radio" name="object-type" id="creation-trigger" ${checked(!creation.collectible)}>Triggered · enemies entering its area receive a status</label>
            <label class="toggle collectible-options"><input type="checkbox" id="creation-resurrection" ${checked(creation.resurrection)}>Resurrection effect (written description only)</label>
            <label class="toggle collectible-options"><input type="checkbox" id="creation-consumable" ${checked(creation.consumable)}>Consumable · otherwise unlimited uses</label>
        </div>
        <div class="field collectible-options"><label>Uses (1–3)<input id="creation-uses" type="number" min="1" max="3" value="${creation.uses}"></label></div>
        <div class="field trigger-options"><label>Enemy trigger area<select id="creation-area">
            ${[0,1,2].map(radius => `<option value="${radius}" ${radius === creation.radius ? 'selected' : ''}>${radius ? `${radius * 2 + 1} × ${radius * 2 + 1} square` : 'Source tile'}</option>`).join('')}
        </select></label></div>
        <div class="field full trigger-options"><label>Status name<input id="creation-status" maxlength="80" value="${escapeHTML(creation.statusName)}" placeholder="e.g. Poison"></label></div>
        <div class="field trigger-options"><label class="color-field">Status / affected-area color<input id="creation-status-color" type="color" value="${normalizeColor(creation.statusColor)}"></label></div>
        <div class="field trigger-options"><label>Lingering cycles (0–3)<input id="creation-linger" type="number" min="0" max="3" value="${creation.lingering}"></label></div>
        <div class="field full trigger-options"><label class="toggle"><input type="checkbox" id="creation-destroy" ${checked(creation.onDestroy)}>Trigger on destruction</label></div>`;
    const panel = floatingWindow(title, `
        <p class="modal-subtitle">${introduction}</p>
        <div class="drawing-layout">
            <div class="drawing-side">
                <canvas class="draw-canvas" id="drawing" width="384" height="384" aria-label="Draw your artwork"></canvas>
                <div class="drawing-tools">
                    <input type="color" id="brush-color" value="#e9d6a4" aria-label="Brush color">
                    <input type="range" id="brush-size" min="1" max="30" value="6" aria-label="Brush size">
                    <button id="erase">Eraser</button><button id="clear-drawing">Clear</button>
                </div>
                <label class="upload-button">Upload PNG, JPG, WEBP<input id="upload-art" type="file" accept="image/png,image/jpeg,image/webp"></label>
                <small>Transparent PNGs work best. Automatic background removal is not included.</small>
            </div>
            <div class="form-grid">
                <div class="field full"><label>Name<input id="creation-name" maxlength="48" value="${escapeHTML(creation.name)}"></label></div>
                <div class="field full"><label>Description & abilities<textarea id="creation-bio" maxlength="2500">${escapeHTML(creation.description)}</textarea></label></div>
                ${kind === 'piece' ? combatFields : objectFields}
            </div>
        </div><p id="creator-error" class="field-error"></p>`,
        '<button data-dismiss>Cancel</button><button id="submit-creation" class="primary">Create →</button>', true,
        kind === 'piece' ? 'piece-creator' : 'object-creator');
    if (!panel) return;
    const field = id => panel.querySelector(`#${id}`);
    if (kind === 'object') {
        const updateObjectOptions = () => {
            const collectible = field('creation-item').checked;
            panel.querySelectorAll('.collectible-options').forEach(element => { element.hidden = !collectible; });
            panel.querySelectorAll('.trigger-options').forEach(element => { element.hidden = collectible; });
        };
        panel.querySelectorAll('[name="object-type"]').forEach(input => { input.onchange = updateObjectOptions; });
        updateObjectOptions();
    }
    const canvas = field('drawing');
    const context = canvas.getContext('2d');
    let hasArtwork = false;
    let erasing = false;
    let drawing = false;
    function loadArtwork(url) {
        const image = new Image();
        image.onload = () => {
            context.clearRect(0, 0, 384, 384);
            const scale = Math.min(350 / image.width, 350 / image.height);
            context.globalCompositeOperation = 'source-over';
            context.drawImage(image, (384 - image.width * scale) / 2, (384 - image.height * scale) / 2,
                image.width * scale, image.height * scale);
            hasArtwork = true;
        };
        image.onerror = () => { field('creator-error').textContent = 'The image could not be read.'; };
        image.src = url;
    }
    if (creation.artwork) loadArtwork(creation.artwork);
    function canvasPoint(event) {
        const rectangle = canvas.getBoundingClientRect();
        return {x:(event.clientX - rectangle.left) * 384 / rectangle.width,
            y:(event.clientY - rectangle.top) * 384 / rectangle.height};
    }
    canvas.onpointerdown = event => {
        if (event.button !== 0) return;
        drawing = true;
        canvas.setPointerCapture(event.pointerId);
        const point = canvasPoint(event);
        context.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
        context.strokeStyle = field('brush-color').value;
        context.lineWidth = Number(field('brush-size').value);
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.beginPath();
        context.moveTo(point.x, point.y);
        context.lineTo(point.x + 0.1, point.y + 0.1);
        context.stroke();
        hasArtwork = true;
    };
    canvas.onpointermove = event => {
        if (!drawing) return;
        const point = canvasPoint(event);
        context.lineTo(point.x, point.y);
        context.stroke();
    };
    canvas.onpointerup = canvas.onpointercancel = () => { drawing = false; };
    field('erase').onclick = event => {
        erasing = !erasing;
        event.target.textContent = erasing ? 'Paint' : 'Eraser';
    };
    field('clear-drawing').onclick = () => { context.clearRect(0,0,384,384); hasArtwork = false; };
    field('upload-art').onchange = event => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 6 * 1024 * 1024) { field('creator-error').textContent = 'Use an image smaller than 6 MB.'; return; }
        const reader = new FileReader();
        reader.onload = () => loadArtwork(String(reader.result));
        reader.readAsDataURL(file);
    };
    field('submit-creation').onclick = async () => {
        const name = field('creation-name').value.trim();
        const description = field('creation-bio').value.trim();
        if (!name || !description || !hasArtwork) {
            field('creator-error').textContent = 'Add a name, description, and artwork.';
            return;
        }
        const collectible = field('creation-item')?.checked || false;
        const statusName = collectible ? '' : (field('creation-status')?.value.trim() || '');
        if (kind === 'object' && !collectible && !statusName) {
            field('creator-error').textContent = 'Add the status name for the triggered area.';
            return;
        }
        const proposal = {
            ...creation, name, description, artwork:canvas.toDataURL('image/png'),
            projectile:field('creation-projectile')?.checked || false,
            keepStatuses:field('creation-keep')?.checked ?? true,
            collectible, resurrection:collectible && Boolean(field('creation-resurrection')?.checked),
            consumable:collectible && Boolean(field('creation-consumable')?.checked),
            uses:Number(field('creation-uses')?.value || 1),
            radius:Number(field('creation-area')?.value || 0),
            statusName, statusColor:normalizeColor(field('creation-status-color')?.value),
            lingering:Number(field('creation-linger')?.value || 0),
            onDestroy:!collectible && Boolean(field('creation-destroy')?.checked)
        };
        if (!Number.isInteger(proposal.uses) || proposal.uses < 1 || proposal.uses > 3
            || !Number.isInteger(proposal.lingering) || proposal.lingering < 0 || proposal.lingering > 3) {
            field('creator-error').textContent = 'Uses must be 1–3 and lingering cycles 0–3, in whole numbers.';
            return;
        }
        proposal.signature = JSON.stringify({kind, description, projectile:proposal.projectile,
            collectible, statusName, statusColor:proposal.statusColor});
        if (kind === 'piece') {
            if (await perform('transform', [proposal.id, proposal])) closeWindow(panel);
        } else {
            if (!canPlay()) { field('creator-error').textContent = 'Wait for your turn before placing the object.'; return; }
            pendingObject = proposal;
            selectedId = null;
            mode = 'object';
            closeWindow(panel);
            render();
            notify('Choose empty floor. The action is spent only on valid placement.');
        }
    };
}

// ============================================================================
// Optional weighted wheel — it never gates transformations or object creation
// ============================================================================
function openWheel() {
    const colors = ['#cbad6f','#637f99','#758f69','#a66f68','#8f78aa','#729d99'];
    const panel = floatingWindow('Custom wheel', `
        <p>Up to 20 categories. Weight 2 is twice as likely as weight 1. Zero-weight categories cannot win.</p>
        <div class="wheel-layout"><div class="wheel-stage"><div class="wheel-pointer">▼</div>
            <canvas class="wheel-canvas" width="360" height="360"></canvas><p class="wheel-result" role="status"></p></div>
            <div><div class="wheel-rows"></div><button class="add-category">+ Category</button>
                <p class="wheel-error field-error"></p></div></div>`,
        '<button class="spin-wheel primary">Spin</button>', true, 'wheel');
    if (!panel) return;
    let spinning = false;
    let rotation = 0;
    let rows = structuredClone(wheelRows);
    const canvas = panel.querySelector('canvas');
    const context = canvas.getContext('2d');
    function readRows(validate = true) {
        rows = [...panel.querySelectorAll('.wheel-row')].map(row => ({
            name:row.querySelector('[type="text"]').value.trim(),
            weight:Number(row.querySelector('[type="number"]').value)
        }));
        if (validate && (rows.some(row => !row.name || !Number.isFinite(row.weight) || row.weight < 0 || row.weight > 1000000)
            || !rows.length || rows.length > 20 || !rows.some(row => row.weight > 0))) {
            throw new Error('Use 1–20 named categories, weights 0–1,000,000, and at least one positive weight.');
        }
        if (validate) wheelRows = structuredClone(rows);
    }
    function drawWheel() {
        context.clearRect(0,0,360,360);
        const total = rows.reduce((sum,row) => sum + Math.max(0,row.weight || 0), 0) || 1;
        let start = -Math.PI / 2;
        rows.forEach((row,index) => {
            const angle = Math.max(0,row.weight || 0) / total * Math.PI * 2;
            context.beginPath();
            context.moveTo(180,180);
            context.arc(180,180,170,start,start + angle);
            context.closePath();
            context.fillStyle = colors[index % colors.length];
            context.fill();
            context.strokeStyle = '#242424';
            context.stroke();
            if (angle > 0.06) {
                context.save();
                context.translate(180,180);
                context.rotate(start + angle / 2);
                context.textAlign = 'right';
                context.fillStyle = '#111';
                context.font = 'bold 13px monospace';
                context.fillText(row.name.slice(0,18),155,4);
                context.restore();
            }
            start += angle;
        });
    }
    function renderRows() {
        panel.querySelector('.wheel-rows').innerHTML = rows.map((row,index) => `
            <div class="wheel-row"><input type="text" maxlength="60" value="${escapeHTML(row.name)}" aria-label="Category ${index + 1}">
                <input type="number" min="0" max="1000000" step="any" value="${row.weight}" aria-label="Weight ${index + 1}">
                <button data-remove="${index}" aria-label="Remove category">×</button></div>`).join('');
        panel.querySelectorAll('[data-remove]').forEach(button => {
            button.onclick = () => {
                if (spinning) return;
                readRows(false);
                rows.splice(Number(button.dataset.remove),1);
                renderRows();
            };
        });
        panel.querySelector('.add-category').disabled = rows.length >= 20;
        drawWheel();
    }
    panel.querySelector('.add-category').onclick = () => {
        if (spinning) return;
        readRows(false);
        if (rows.length < 20) rows.push({name:`Category ${rows.length + 1}`, weight:1});
        renderRows();
    };
    panel.querySelector('.wheel-rows').onchange = () => {
        try { readRows(); drawWheel(); panel.querySelector('.wheel-error').textContent = ''; }
        catch (error) { panel.querySelector('.wheel-error').textContent = error.message; }
    };
    panel.querySelector('.spin-wheel').onclick = () => {
        if (spinning) return;
        try { readRows(); }
        catch (error) { panel.querySelector('.wheel-error').textContent = error.message; return; }
        drawWheel();
        spinning = true;
        panel.querySelectorAll('input,button').forEach(element => { element.disabled = true; });
        panel.querySelector('.window-close').disabled = false;
        const random = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
        const total = rows.reduce((sum,row) => sum + row.weight,0);
        let cumulative = 0;
        let winnerIndex = rows.findIndex(row => { cumulative += row.weight; return random * total < cumulative; });
        if (winnerIndex < 0) winnerIndex = rows.length - 1;
        const targetAngle = (360 - random * 360) % 360;
        const nextRotation = rotation + 1800 + ((targetAngle - rotation % 360 + 360) % 360);
        const animation = canvas.animate([
            {transform:`rotate(${rotation}deg)`}, {transform:`rotate(${nextRotation}deg)`}
        ], {duration:2800, easing:'cubic-bezier(.12,.7,.1,1)', fill:'forwards'});
        rotation = nextRotation;
        animation.onfinish = () => {
            spinning = false;
            const winner = rows[winnerIndex];
            panel.querySelector('.wheel-result').textContent = `${winner.name} · ${(winner.weight / total * 100).toFixed(1)}%`;
            panel.querySelectorAll('input,button').forEach(element => { element.disabled = false; });
            panel.querySelector('.add-category').disabled = rows.length >= 20;
            perform('wheel-result', [winner.name]);
        };
    };
    renderRows();
}

// ============================================================================
// Event wiring — compatible with your existing HTML and index.js
// ============================================================================
document.addEventListener('click', event => {
    if (event.target.closest('.floating-window')) return;
    if (suppressClick && event.target.closest('.tile,[data-return]')) return;
    const action = event.target.closest('[data-action]');
    if (action) { handleAction(action.dataset.action); return; }
    const terrain = event.target.closest('[data-terrain]');
    if (terrain) { terrainKind = terrain.dataset.terrain; terrainSelection = []; render(); return; }
    const captured = event.target.closest('[data-return]');
    if (captured) {
        selectedId = captured.dataset.return;
        mode = 'return';
        notify('Click empty floor to return this piece. No item or action required.');
        renderHeader();
        return;
    }
    const item = event.target.closest('[data-item]');
    if (item) { inspectItem(Number(item.dataset.item)); return; }
    const tile = event.target.closest('.tile');
    closeContext();
    if (tile) clickTile(tilePosition(tile));
});
document.addEventListener('input', event => {
    if (event.target.id === 'terrain-color') terrainColor = event.target.value;
});
// If a PNG is absent, retain a usable SVG fallback without an infinite error loop.
document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.closest('.piece')) return;
    const pieceElement = image.closest('.piece');
    const imageName = image.getAttribute('src')?.split('/').pop();
    const type = Object.keys(pieceImageLetters).find(type => imageName === `w${pieceImageLetters[type]}.png` || imageName === `b${pieceImageLetters[type]}.png`);
    if (!type) return;
    image.replaceWith(document.createRange().createContextualFragment(createPieceSvg({type})));
    pieceElement.dataset.imageMissing = 'true';
}, true);
$('#board').addEventListener('contextmenu', contextMenu);
$('#board').addEventListener('pointerdown', startDrag);
$('#captured').addEventListener('pointerdown', startDrag);
window.addEventListener('pointermove', moveDrag, {passive:false});
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', cancelDrag);
window.addEventListener('blur', cancelDrag);
window.addEventListener('resize', fitBoard);
window.addEventListener('focus', () => refreshRoom());
new ResizeObserver(fitBoard).observe($('#board-stage'));
document.addEventListener('keydown', event => {
    if (event.target.matches('input,textarea,select')) return;
    if (event.key === 'Escape') {
        cancelDrag(); closeContext(); mode = 'move'; pendingObject = null; terrainSelection = []; render();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); perform('undo');
    }
    if (event.code === 'Space' && !event.target.closest('.floating-window') && $('#menu').hidden) {
        event.preventDefault(); handleAction('end-turn');
    }
});
render();
