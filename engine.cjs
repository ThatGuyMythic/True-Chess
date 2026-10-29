/* Server-side rules: no DOM, no browser storage, no client-supplied snapshots. */
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
        this.state.appearance ??= {background:"#151515"};
        this.state.tabletopItems ??= [];
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
    resurrect(id, target) {
        return this.commit(() => {
            const piece = this.piece(id);
            if (!inside(target) || !piece || piece.alive || this.pieceAt(target)
                || this.objectAt(target) || this.terrain(target) !== "floor") {
                return {ok:false, message:"Choose an empty floor tile inside the board boundary."};
            }
            Object.assign(piece, target, {alive:true, hp:piece.maxHp, resurrected:true, moved:true});
            this.state.result = null;
            this.log(`${piece.name} returned by a manual effect.`);
            return {ok:true, message:`${piece.name} returned. No action spent.`};
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
    applyStatus(e,t,a) {
        const s=e.statuses.find(r=>r.name.toLowerCase()===t.statusName.toLowerCase());
        s?(s.remaining=t.lingering,s.exposed=a||s.exposed,s.clock=t.owner):e.statuses.push( {
            name:t.statusName,remaining:t.lingering,clock:t.owner,exposed:a
        }
        )
    }
    refreshExposure() {
        this.collectOccupied();
        const e=new Set(this.state.pieces.flatMap(t=>t.statuses.filter(a=>a.exposed).map(a=>`${t.id}:${a.name.toLowerCase()}`)));
        for(const t of this.state.pieces)for(const a of t.statuses)a.exposed=!1;
        for(const t of this.state.objects.filter(a=>this.active(a)&&a.statusName&&!a.collectible))for(const a of this.state.pieces.filter(s=>s.alive&&s.color!==t.owner&&Math.max(Math.abs(s.row-t.row),Math.abs(s.col-t.col))<=t.radius)) {
            const s=a.statuses.some(r=>r.name.toLowerCase()===t.statusName.toLowerCase()&&e.has(`${a.id}:${r.name.toLowerCase()}`));
            this.applyStatus(a,t,!0),s||this.log(`${v(a.color)} ${a.name} enters ${t.name}’s area · ${t.statusName}. Resolve its written effect with Edit.`)
        }
        for(const t of this.state.pieces) {
            for(const a of t.statuses)!a.exposed&&e.has(`${t.id}:${a.name.toLowerCase()}`)&&(a.clock=this.state.current);
            t.statuses=t.statuses.filter(a=>a.exposed||a.remaining>0)
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

// Appearance and decorative changes are stored in the same authoritative state.
function inside(position) {
    return position && Number.isInteger(position.row) && Number.isInteger(position.col)
        && position.row >= -4 && position.row <= 11 && position.col >= -4 && position.col <= 11;
}
function normalizeColor(value, fallback = '#9b69c8') {
    return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toLowerCase() : fallback;
}
TrueChessGame.prototype.paintTiles = function (positions, color) {
    return this.commit(() => {
        for (const position of positions) {
            if (color === null) delete this.state.tileColors[oe(position)];
            else this.state.tileColors[oe(position)] = color;
        }
        return {ok:true, message:'Tile colors updated. No action spent.'};
    });
};
TrueChessGame.prototype.setAppearance = function (appearance) {
    return this.commit(() => {
        this.state.appearance = {background:appearance.background};
        return {ok:true, message:'Background color saved.'};
    });
};

// Object lifetimes match tabletop-extras.js. One cycle is the owner's next turn.
function prepareObject(engine, object) {
    if (object.statusName === '__TRUE_CHESS_NO_STATUS__') object.statusName = '';
    if (!object.owner) object.owner = engine.state.current;
    if (!Number.isFinite(object.activeAt)) object.activeAt = engine.state.ownTurns[object.owner] + 1;
    if (object.lifecycleVersion === 1) return;
    const requested = Number(object.durationCycles ?? object.lingering ?? 1);
    object.durationCycles = !object.collectible && object.statusName
        ? Math.max(1, Math.min(3, Math.floor(requested) || 1)) : 1;
    object.expiresAtOwnerTurn = Math.max(object.activeAt, engine.state.ownTurns[object.owner]) + object.durationCycles;
    object.lifecycleVersion = 1;
}
function expireObjects(engine) {
    engine.state.objects = engine.state.objects.filter(object => {
        prepareObject(engine, object);
        if (engine.state.ownTurns[object.owner] < object.expiresAtOwnerTurn) return true;
        engine.log(`${object.name} expires after ${object.durationCycles} full cycle(s).`);
        return false;
    });
}
function updateTimedStatus(engine, status) {
    if (!Array.isArray(status.sourceClocks)) return status.remaining > 0 || status.exposed;
    status.sourceClocks = status.sourceClocks.filter(source => source.expiresAt > engine.state.ownTurns[source.owner]);
    status.remaining = Math.max(0, ...status.sourceClocks.map(source => source.expiresAt - engine.state.ownTurns[source.owner]));
    return status.sourceClocks.length > 0;
}
const createObjectBeforeLifetimes = TrueChessGame.prototype.createObject;
TrueChessGame.prototype.createObject = function (object, signature) {
    const prepared = {...object};
    if (prepared.statusName === '__TRUE_CHESS_NO_STATUS__') prepared.statusName = '';
    prepared.durationCycles = !prepared.collectible && prepared.statusName
        ? Math.max(1, Math.min(3, Number(prepared.durationCycles ?? prepared.lingering) || 1)) : 1;
    prepared.lifecycleVersion = 1;
    prepared.expiresAtOwnerTurn = this.state.ownTurns[this.state.current] + 1 + prepared.durationCycles;
    return createObjectBeforeLifetimes.call(this, prepared, signature);
};
TrueChessGame.prototype.applyStatus = function (piece, object, exposed) {
    if (!object.statusName) return;
    prepareObject(this, object);
    let status = piece.statuses.find(entry => entry.name.toLowerCase() === object.statusName.toLowerCase());
    if (!status) {
        status = {name:object.statusName, remaining:0, exposed:false, clock:object.owner, sourceClocks:[]};
        piece.statuses.push(status);
    }
    status.sourceClocks ??= [];
    const clock = {id:object.id, owner:object.owner, expiresAt:object.expiresAtOwnerTurn};
    const existing = status.sourceClocks.find(entry => entry.id === object.id);
    if (existing) Object.assign(existing, clock); else status.sourceClocks.push(clock);
    status.color = normalizeColor(object.statusColor);
    status.clock = object.owner;
    status.exposed = Boolean(exposed || status.exposed);
    updateTimedStatus(this, status);
};
TrueChessGame.prototype.refreshExposure = function () {
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
TrueChessGame.prototype.nextTurn = function () {
    const state = this.state;
    state.current = Y(state.current);
    state.turn++;
    state.ownTurns[state.current]++;
    state.actions = 2;
    state.acted = [];
    state.terrainUsed = state.objectUsed = false;
    for (const piece of state.pieces) for (const status of piece.statuses) {
        if (!Array.isArray(status.sourceClocks) && !status.exposed && status.clock === state.current) status.remaining--;
    }
    this.refreshExposure();
    this.log(`${v(state.current)} to play · two actions.`);
};
module.exports = {TrueChessGame, createInitialGameState, inside, normalizeColor};
