(function () {
  'use strict';

  // Icon helper – white SVG from icons/ui/
  // Function declaration so it is hoisted and usable in ITEM_ICONS const init
  function ic(name, size=16){
    return `<img src="icons/ui/${name}.svg" width="${size}" height="${size}" class="gi">`;
  }

  // ================================================================
  //  CONSTANTS
  // ================================================================
  const CELL = 4, COLS = 15, ROWS = 15, WALL_H = 3.6;
  const PLAYER_R = 0.45, ZOMBIE_R = 0.45;
  const EXIT_R = 1.8, INTERACT_R = 2.2;
  const PICKUP_R = 2.5;   // radius to see nearby items in panel
  const CAM_DIST = 7.5, CAM_H = 5.8, CAM_LERP = 0.09;
  const ST_REGEN = 14, ST_SPRINT = 24, ST_THRESH = 18;
  const WALK_SPD = 5.0, SPRINT_SPD = 7.8;

  // Inventory
  const INV_ROWS = 4, INV_COLS = 4;
  const ITEM_SIZES = {
    bat:{w:1,h:2}, pipe:{w:1,h:2}, axe:{w:1,h:2},
    pistol:{w:2,h:1}, shotgun:{w:2,h:1},
    bandage:{w:1,h:1}, medkit:{w:1,h:1},
    pistol_ammo:{w:1,h:1}, shotgun_ammo:{w:1,h:1}, parts:{w:1,h:1},
  };
  const ITEM_ICONS = {
    bat:          ic('baseball-bat'),
    pipe:         ic('crowbar'),
    axe:          ic('battle-axe'),
    pistol:       ic('revolver'),
    shotgun:      ic('sawed-off-shotgun'),
    bandage:      ic('bandage-roll'),
    medkit:       ic('first-aid-kit'),
    pistol_ammo:  ic('bullets'),
    shotgun_ammo: ic('shotgun-rounds'),
    parts:        ic('gears'),
  };
  const ITEM_NAMES = {
    bat:'バット', pipe:'パイプ', axe:'斧',
    pistol:'ピストル', shotgun:'ショットガン',
    bandage:'包帯', medkit:'医療キット',
    pistol_ammo:'ピストル弾', shotgun_ammo:'SG弾', parts:'資材',
  };

  // ================================================================
  //  DIFFICULTY
  // ================================================================
  const DIFFS = {
    easy:   { zCount:4,  zHp:30, zSpd:1.3, zRun:2.5, zDmg:4,  zDet:11, items:14, crates:8  },
    normal: { zCount:6,  zHp:50, zSpd:1.7, zRun:3.4, zDmg:7,  zDet:13, items:10, crates:6  },
    hard:   { zCount:10, zHp:70, zSpd:2.2, zRun:4.3, zDmg:12, zDet:14, items:7,  crates:4  },
  };
  let D = DIFFS.normal, currentDiff = 'normal';

  // ================================================================
  //  WEAPON DEFS
  // ================================================================
  const MELEE = {
    fists: { name:'素手',   dmg:12, cd:0.55, st:0,  range:1.8, arc:Math.PI*0.62 },
    bat:   { name:'バット', dmg:38, cd:0.70, st:20, range:2.0, arc:Math.PI/2 },
    pipe:  { name:'パイプ', dmg:48, cd:0.95, st:26, range:2.1, arc:Math.PI/2 },
    axe:   { name:'斧',     dmg:70, cd:1.30, st:35, range:2.1, arc:Math.PI/2.5 },
  };
  const GUNS = {
    pistol:  { name:'ピストル',     maxAmmo:15, dmg:55, fireCd:0.25, range:28 },
    shotgun: { name:'ショットガン', maxAmmo:6,  dmg:80, fireCd:0.85, range:16, spread:true },
  };

  // ================================================================
  //  UPGRADE SYSTEM  (permanent – persists across deaths)
  // ================================================================
  const SAVE_KEY  = 'zombie-escape-run-v3';
  const UPG_KEY   = 'zombie-escape-upgrades-v1';
  const PARTS_KEY = 'zombie-escape-parts-v1';

  let upgrades = { hpUp:0, stUp:0, meleeDmg:0, gunDmg:0, speed:0 };

  const UPG_DEFS = [
    { id:'hpUp',     icon:ic('heart-plus',14),       name:'HP強化',      max:3, cost:3, desc:'最大HP +20' },
    { id:'stUp',     icon:ic('heavy-lightning',14),   name:'スタミナ強化', max:3, cost:3, desc:'最大ST +15' },
    { id:'meleeDmg', icon:ic('crossed-swords',14),    name:'近接強化',     max:3, cost:5, desc:'近接ダメ +15%' },
    { id:'gunDmg',   icon:ic('revolver',14),           name:'射撃強化',     max:2, cost:5, desc:'銃ダメ +15%' },
    { id:'speed',    icon:ic('run',14),                name:'機動強化',     max:2, cost:4, desc:'速度 +0.5' },
  ];

  function loadUpgrades() {
    try { const r = localStorage.getItem(UPG_KEY); if(r) upgrades = {...upgrades,...JSON.parse(r)}; } catch(_){}
  }
  function saveUpgrades() {
    try { localStorage.setItem(UPG_KEY, JSON.stringify(upgrades)); } catch(_){}
  }
  function savePartsStash(n){
    try{ if(n>0) localStorage.setItem(PARTS_KEY,String(n)); else localStorage.removeItem(PARTS_KEY); }catch(_){}
  }
  function loadPartsStashCount(){
    try{ return Math.max(0,parseInt(localStorage.getItem(PARTS_KEY)||'0',10)); }catch(_){return 0;}
  }
  function clearPartsStash(){
    try{ localStorage.removeItem(PARTS_KEY); }catch(_){}
  }

  // Effective stats (with upgrades applied)
  const eff = {
    hpMax()     { return 100 + upgrades.hpUp * 20; },
    stMax()     { return 100 + upgrades.stUp * 15; },
    walkSpd()   { return WALK_SPD + upgrades.speed * 0.5; },
    sprintSpd() { return SPRINT_SPD + upgrades.speed * 0.5; },
    meleeDmg(b) { return Math.round(b * (1 + upgrades.meleeDmg * 0.15)); },
    gunDmg(b)   { return Math.round(b * (1 + upgrades.gunDmg   * 0.15)); },
  };

  // ================================================================
  //  MODELS
  // ================================================================
  const MODELS = {};

  // ================================================================
  //  AUDIO
  // ================================================================
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function playTone(freq,type,dur,vol=0.18,attack=0.005,decay=0){
    try {
      const ctx=getAudioCtx(), osc=ctx.createOscillator(), gain=ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type=type; osc.frequency.setValueAtTime(freq,ctx.currentTime);
      gain.gain.setValueAtTime(0,ctx.currentTime);
      gain.gain.linearRampToValueAtTime(vol,ctx.currentTime+attack);
      gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+dur);
      if(decay>0)osc.frequency.exponentialRampToValueAtTime(freq*decay,ctx.currentTime+dur);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime+dur);
    } catch(_){}
  }
  function playNoise(dur,vol=0.12,hpFreq=800){
    try {
      const ctx=getAudioCtx(), buf=ctx.createBuffer(1,ctx.sampleRate*dur,ctx.sampleRate);
      const data=buf.getChannelData(0); for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
      const src=ctx.createBufferSource(); src.buffer=buf;
      const f=ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value=hpFreq;
      const g=ctx.createGain(); g.gain.setValueAtTime(vol,ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+dur);
      src.connect(f); f.connect(g); g.connect(ctx.destination);
      src.start(); src.stop(ctx.currentTime+dur);
    } catch(_){}
  }
  const SFX = {
    shoot()   { playNoise(0.12,0.25,1200); playTone(180,'sawtooth',0.08,0.12,0.002,0.3); },
    shotgun() { playNoise(0.22,0.35,600);  playTone(90,'sawtooth',0.14,0.18,0.002,0.25); },
    melee()   { playNoise(0.06,0.22,300);  playTone(220,'square',0.05,0.08); },
    hit()     { playTone(160,'sawtooth',0.18,0.2,0.002,0.3); playNoise(0.1,0.15,200); },
    pickup()  { playTone(880,'sine',0.06,0.1); playTone(1100,'sine',0.08,0.1); },
    heal()    { [440,550,660].forEach((f,i)=>setTimeout(()=>playTone(f,'sine',0.12,0.1),i*60)); },
    open()    { playNoise(0.08,0.18,150); playTone(320,'triangle',0.1,0.09); },
    rummage() {
      // Rummaging-through-box sound: multiple noise bursts + low clunk
      playNoise(0.14,0.20,500); playTone(130,'triangle',0.06,0.04);
      setTimeout(()=>playNoise(0.10,0.16,350),180);
      setTimeout(()=>playNoise(0.09,0.13,420),400);
    },
    itemFound(){ playTone(660,'sine',0.08,0.12); setTimeout(()=>playTone(880,'sine',0.07,0.10),65); },
    upgrade() { [440,660,880,1100].forEach((f,i)=>setTimeout(()=>playTone(f,'sine',0.15,0.12),i*80)); },
    zombie()  { playTone(140+Math.random()*40,'sawtooth',0.28,0.08,0.01,0.7); },
    die()     { playTone(200,'sawtooth',0.4,0.12,0.01,0.2); playNoise(0.3,0.1,100); },
    gameover(){ [330,220,180,110].forEach((f,i)=>setTimeout(()=>playTone(f,'sawtooth',0.3,0.12),i*200)); },
    win()     { [440,550,660,880].forEach((f,i)=>setTimeout(()=>playTone(f,'sine',0.25,0.15),i*120)); },
    empty()   { playTone(440,'square',0.05,0.07); playTone(380,'square',0.05,0.07); },
  };

  // ================================================================
  //  STATE
  // ================================================================
  let renderer, scene, camera, clock;
  let state = 'start';
  let grid = [];
  let exitPos = {x:0,z:0}, exitMesh = null;

  // Stats
  let killCount = 0, gameStartTime = 0, gameElapsed = 0;
  // Misc timers
  let saveTimer = 5, respawnTO = null;
  let swingTimer = 0, swingMesh = null;
  // Visual effects
  let flickerT = 0, shakeTimer = 0, shakeMag = 0, bobPhase = 0, lastMoveSpd = 0;
  let emgLight = null; // module-scope ref to emergency red light

  // ── Entity ID generator (for multiplayer sync) ──
  let _eid = 0;
  function eid(prefix){ return prefix + (++_eid); }

  // ================================================================
  //  MULTIPLAYER (MP)
  // ================================================================
  // 1. Deploy server/ to Render.com, then paste the URL below.
  // 2. Click ↺ reload in the game to pick up the new URL.
  const MP_SERVER = 'https://zombie-escape-server.onrender.com';

  let mpSock     = null;   // Socket.io socket instance
  let mpRoom     = null;   // current room ID
  let mpHost     = false;  // true if we are the host
  let mpMyId     = null;   // our socket.id
  let mpEnabled  = false;  // multiplayer mode active
  let _mpMoveT   = 0;      // timer for throttled position send

  // Remote players: Map<socketId, {mesh,name,x,z,angle,hp,tx,tz,ta}>
  const mpPlayers = new Map();

  function mpConnect(roomId, playerName){
    if(typeof io === 'undefined'){ alert('Socket.io が読み込まれていません。インターネット接続を確認してください。'); return; }
    if(mpSock) mpSock.disconnect();
    mpEnabled = true;
    mpRoom    = roomId.toUpperCase();
    mpSock    = io(MP_SERVER, { transports:['websocket','polling'] });

    mpSock.on('connect', ()=>{
      mpMyId = mpSock.id;
      mpSock.emit('joinRoom', { roomId:mpRoom, name:playerName||'Player' });
    });

    mpSock.on('connect_error', ()=>{
      notify('⚠ サーバー接続失敗。URLを確認してください。');
      mpEnabled = false;
    });

    mpSock.on('roomJoined', ({ isHost, myId, players })=>{
      mpHost = isHost; mpMyId = myId;
      for(const p of players){ if(p.id!==myId) _mpAddPlayer(p); }
      _mpUpdateLobbyUI();
      notify(isHost ? '🏠 ルーム作成済み。メンバーを待っています' : '🤝 ルームに参加しました');
    });

    mpSock.on('playerJoined', ({ id, name })=>{
      _mpAddPlayer({ id, name, x:0, z:0, angle:0, hp:100 });
      notify(`👤 ${name} が参加！`);
      _mpUpdateLobbyUI();
    });

    mpSock.on('playerLeft', ({ id })=>{
      _mpRemovePlayer(id); notify('👤 プレイヤーが退出');
      _mpUpdateLobbyUI();
    });

    mpSock.on('move', ({ id, x, z, angle, hp })=>{
      const p = mpPlayers.get(id);
      if(p){ p.tx=x; p.tz=z; p.ta=angle; p.hp=hp; }
    });

    mpSock.on('gameStarted', mapData =>{
      _mpUpdateLobbyUI(); // hide lobby
      _mpStartAsGuest(mapData);
    });

    mpSock.on('zombieKill', ({ zombieId })=>{
      const z = zombies.find(z=>z.id===zombieId);
      if(z && !z.dying){
        spawnBloodPool(z.x, z.z);
        z.dying=true; z.dyingTimer=0.8;
        z.mesh.traverse(c=>{ if(c.isMesh&&c.material) c.material.transparent=true; });
        killCount++;
        const alive = zombies.filter(z=>!z.dying).length;
        notify(alive===0 ? `${ic('exit-door',14)} 全ゾンビ撃破！` : `${ic('dread-skull',14)} ゾンビ撃破！(${killCount}体)`);
      }
    });

    mpSock.on('itemPickup', ({ itemId })=>{
      const wi = worldItems.find(i=>i.id===itemId);
      if(wi && !wi.collected){
        wi.collected=true; scene.remove(wi.mesh);
        worldItems = worldItems.filter(i=>!i.collected);
        invalidateNearbyPanel();
      }
    });

    mpSock.on('gameWon', ()=>{
      if(state!=='won') winGame();
    });

    mpSock.on('hostChanged', ({ hostId })=>{
      if(hostId===mpMyId){ mpHost=true; notify('🎮 あなたがホストになりました'); }
      _mpUpdateLobbyUI();
    });

    mpSock.on('disconnect', ()=>{
      if(state==='playing') notify('⚠ サーバーから切断されました');
    });
  }

  function mpDisconnect(){
    if(mpSock){ mpSock.disconnect(); mpSock=null; }
    for(const [,p] of mpPlayers) if(p.mesh && scene) scene.remove(p.mesh);
    mpPlayers.clear();
    mpEnabled=false; mpHost=false; mpMyId=null; mpRoom=null;
  }

  function _mpAddPlayer({ id, name, x, z, angle, hp }){
    if(mpPlayers.has(id)) return;
    const mesh = _mpMakeGhostMesh(name);
    if(state==='playing' && scene) scene.add(mesh);
    mpPlayers.set(id, { id, name, mesh, x, z, angle, hp, tx:x, tz:z, ta:angle });
  }

  function _mpRemovePlayer(id){
    const p = mpPlayers.get(id);
    if(p && p.mesh && scene) scene.remove(p.mesh);
    mpPlayers.delete(id);
  }

  function _mpMakeGhostMesh(/* name */){
    // Bright orange-red uniform so other players are always visible
    const g = new THREE.Group();
    const skinM = new THREE.MeshLambertMaterial({color:0xe0a87c});
    const unifM = new THREE.MeshLambertMaterial({color:0xcc3300,emissive:new THREE.Color(0x441100),emissiveIntensity:0.6});
    const vestM = new THREE.MeshLambertMaterial({color:0x882200,emissive:new THREE.Color(0x331100),emissiveIntensity:0.5});
    const bootM = new THREE.MeshLambertMaterial({color:0x1a0a00});
    const hairM = new THREE.MeshLambertMaterial({color:0x1a0d05});

    [-0.14,0.14].forEach(ox=>{const b=new THREE.Mesh(new THREE.BoxGeometry(0.24,0.17,0.30),bootM);b.position.set(ox,0.085,0.01);g.add(b);});
    [-0.13,0.13].forEach(ox=>{const l=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.38,0.22),unifM);l.position.set(ox,0.36,0);g.add(l);});
    [-0.13,0.13].forEach(ox=>{const l=new THREE.Mesh(new THREE.BoxGeometry(0.25,0.22,0.24),unifM);l.position.set(ox,0.66,0);g.add(l);});
    const blt=new THREE.Mesh(new THREE.BoxGeometry(0.54,0.07,0.27),new THREE.MeshLambertMaterial({color:0x111111}));blt.position.set(0,0.785,0);g.add(blt);
    const trs=new THREE.Mesh(new THREE.BoxGeometry(0.54,0.50,0.27),unifM);trs.position.set(0,1.05,0);g.add(trs);
    const vst=new THREE.Mesh(new THREE.BoxGeometry(0.36,0.42,0.32),vestM);vst.position.set(0,1.05,0);g.add(vst);
    [-0.40,0.40].forEach(ox=>{
      const ua=new THREE.Mesh(new THREE.BoxGeometry(0.20,0.28,0.20),unifM);ua.position.set(ox,1.08,0);g.add(ua);
      const fa=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.26,0.18),unifM);fa.position.set(ox,0.79,0);g.add(fa);
    });
    const nk=new THREE.Mesh(new THREE.BoxGeometry(0.17,0.13,0.17),skinM);nk.position.set(0,1.32,0);g.add(nk);
    const hd=new THREE.Mesh(new THREE.BoxGeometry(0.42,0.40,0.38),skinM);hd.position.set(0,1.57,0);g.add(hd);
    const h1=new THREE.Mesh(new THREE.BoxGeometry(0.42,0.10,0.38),hairM);h1.position.set(0,1.77,0);g.add(h1);
    const h2=new THREE.Mesh(new THREE.BoxGeometry(0.46,0.16,0.40),hairM);h2.position.set(0,1.68,0);g.add(h2);
    // Large bright cyan marker above head — always visible regardless of lighting
    const mkM=new THREE.MeshBasicMaterial({color:0x00ffff});
    const mk=new THREE.Mesh(new THREE.SphereGeometry(0.18,8,8),mkM);
    mk.position.y=2.30; g.add(mk);
    // Vertical beam (makes it easier to spot across the map)
    const beam=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.50,0.06),mkM);
    beam.position.y=2.55; g.add(beam);
    return g;
  }

  function _mpTickPlayers(dt){
    for(const [,p] of mpPlayers){
      if(!p.mesh) continue;
      const lr = Math.min(1, dt*10);
      p.x += (p.tx-p.x)*lr;
      p.z += (p.tz-p.z)*lr;
      p.angle += angleDiff(p.ta, p.angle)*lr;
      p.mesh.position.set(p.x, 0, p.z);
      p.mesh.rotation.y = p.angle;
    }
  }

  function _mpSendMove(){
    if(!mpSock||!mpEnabled||state!=='playing') return;
    mpSock.emit('move', { x:player.x, z:player.z, angle:player.angle, hp:Math.floor(player.hp) });
  }

  // ── Map data: host extracts, guests receive ──
  function _mpExtractMapData(){
    return {
      grid: grid.map(r=>[...r]),
      zombieSpawns:    zombies.map(z=>({ id:z.id, x:z.x, z:z.z })),
      containerSpawns: containers.map(c=>({ id:c.id, type:c.type, x:c.x, z:c.z })),
      worldItemSpawns: worldItems.map(i=>({ id:i.id, type:i.type, sub:i.sub, amount:i.amount, ammo:i.ammo, x:i.x, z:i.z, bob:i.bob })),
    };
  }

  function _mpStartAsGuest(mapData){
    try {
      D = DIFFS[currentDiff];
      grid = mapData.grid;          // use host's grid
      buildScene(true);             // build walls/floor/etc, skip spawns
      spawnPlayer();                // spawn own player
      _mpRebuildFromData(mapData);  // place zombies/items/containers from host data
      _mpPlaceGhosts();             // add host ghost at spawn point (not 0,0,0)
      enterGame();
    } catch(e){
      console.error('mpStartAsGuest:', e);
      notify('⚠ マップ同期エラー: '+e.message);
    }
  }

  function _mpRebuildFromData(mapData){
    // Zombies
    zombies = [];
    for(const sp of mapData.zombieSpawns){
      const mesh = makeZombieMesh();
      mesh.position.set(sp.x, 0, sp.z); scene.add(mesh);
      zombies.push({ id:sp.id, x:sp.x, z:sp.z,
        angle:Math.random()*Math.PI*2, hp:D.zHp, maxHp:D.zHp, mesh,
        wTimer:Math.random()*3, wDir:Math.random()*Math.PI*2,
        lastDmg:0, flashTimer:0, attackAnim:0 });
    }
    // Containers
    containers = [];
    for(const sp of mapData.containerSpawns){
      const mesh = makeContainerMesh(sp.type);
      mesh.position.set(sp.x, 0, sp.z); scene.add(mesh);
      containers.push({ id:sp.id, type:sp.type, x:sp.x, z:sp.z, mesh, opened:false });
    }
    // World items
    worldItems = [];
    for(const sp of mapData.worldItemSpawns){
      const mesh = makeItemMesh(sp.type, sp.sub);
      mesh.position.set(sp.x, 0.5, sp.z); scene.add(mesh);
      worldItems.push({ id:sp.id, type:sp.type, sub:sp.sub, amount:sp.amount||0,
        ammo:sp.ammo||0, x:sp.x, z:sp.z, mesh, collected:false, bob:sp.bob||0 });
    }
    invalidateNearbyPanel();
  }

  // ── Lobby UI update (called when player list changes) ──
  function _mpUpdateLobbyUI(){
    if(state!=='start') return; // only update when on menu screens
    if(_menuScreen==='mp-lobby') _menuMpLobby();
    else if(_menuScreen==='mp-room') _menuMpRoom();
  }

  function mpHostStartGame(){
    if(!mpHost || !mpSock) return;
    D = DIFFS[currentDiff];
    buildGrid(); buildScene(); // spawns happen here
    const mapData = _mpExtractMapData();
    _mpPlaceGhosts(); // add ghosts to scene at spawn point
    mpSock.emit('startGame', mapData);
    enterGame();
  }

  function _mpPlaceGhosts(){
    // Place all remote player ghosts at spawn point so they're not buried in a wall
    const sp = gw(1,1);
    for(const [,p] of mpPlayers){
      if(!p.mesh) continue;
      p.x = sp.x; p.z = sp.z;
      p.tx = sp.x; p.tz = sp.z;
      p.mesh.position.set(sp.x, 0, sp.z);
      scene.add(p.mesh);
    }
  }

  const player = {
    x:0, z:0, angle:0, mesh:null,
    hp:100, stamina:100, exhausted:false,
    melee:{...MELEE.fists,id:'fists'},
    gun:null,
  };

  // ── Inventory ──
  let invGrid = [];    // INV_ROWS × INV_COLS, null or item.id
  let invItems = [];   // {id, type, sub, amount, ammo, row, col, w, h}
  let invNextId = 0;
  let nearbyWorldItems = [];
  let invOpen = false;
  let invCtxId = null;
  let invDrag = null;  // DnD state: {id,ghostEl,startX,startY,active,hoverKey}

  let zombies = [], worldItems = [], containers = [];
  let nearContainer = null;
  let meleeCD = 0, gunCD = 0, healCD = 0;
  let bullets = [];          // flying bullet objects
  let lockTarget = null;     // zombie currently locked-on
  let lockMesh  = null;      // 3-D lock indicator mesh
  // Shared bullet geometry/materials — avoids GC pressure on every shot
  const _bGeoS = new THREE.SphereGeometry(0.07,4,4); // shotgun pellet
  const _bGeoP = new THREE.SphereGeometry(0.06,4,4); // pistol bullet
  const _bMatY = new THREE.MeshBasicMaterial({color:0xffee00}); // pistol (yellow)
  const _bMatO = new THREE.MeshBasicMaterial({color:0xff8800}); // shotgun (orange)
  let overlayAction = 'start';
  let exhaustedNotified = false;

  let cameraAngle = 0;

  const keys = {}, prevKeys = {};
  let joy  = {on:false,id:-1,bx:0,by:0,dx:0,dy:0};
  let look = {on:false,id:-1,px:0};

  let $canvas,$hud,$hpFill,$hpNum,$stFill,$stNum;
  let $weaponInfo,$gunInfo,$healCount,$exitHint,$timerNum,$killNum,$partsNum;
  let $overlay,$oTitle,$oBody,$oBtn;
  let $joy,$knob,$flash;
  let $interactPrompt,$pickupNotif,$upgradeModal;
  let $nearbyPanel,$invOverlay;

  // ================================================================
  //  SAVE / LOAD RUN
  // ================================================================
  function saveRun(){
    if(state!=='playing') return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        ver:3, diff:currentDiff, kills:killCount, elapsed:gameElapsed,
        player:{x:player.x,z:player.z,angle:player.angle,
                hp:player.hp,stamina:player.stamina,
                meleeId:player.melee.id,
                gunId:player.gun?player.gun.id:null,
                gunAmmo:player.gun?player.gun.ammo:0},
        grid,
        zombies:zombies.map(z=>({x:z.x,z:z.z,hp:z.hp,maxHp:z.maxHp,angle:z.angle})),
        containers:containers.map(c=>({type:c.type,x:c.x,z:c.z,opened:c.opened})),
        items:worldItems.map(i=>({type:i.type,sub:i.sub,amount:i.amount,ammo:i.ammo,x:i.x,z:i.z})),
        inventory:invItems.map(i=>({...i})),
      }));
    } catch(_){}
  }
  function hasSave(){ try{ return !!localStorage.getItem(SAVE_KEY); }catch(_){return false;} }
  function loadRunData(){ try{ const r=localStorage.getItem(SAVE_KEY); return r?JSON.parse(r):null; }catch(_){return null;} }
  function clearRun(){ try{ localStorage.removeItem(SAVE_KEY); }catch(_){} }

  // ================================================================
  //  ENTRY
  // ================================================================
  window.addEventListener('load', () => {
    $canvas   = document.getElementById('game-canvas');
    $hud      = document.getElementById('hud');
    $hpFill   = document.getElementById('hp-fill');
    $hpNum    = document.getElementById('hp-num');
    $stFill   = document.getElementById('st-fill');
    $stNum    = document.getElementById('st-num');
    $weaponInfo = document.getElementById('weapon-info');
    $gunInfo  = document.getElementById('gun-info');
    $healCount= document.getElementById('heal-count');
    $exitHint = document.getElementById('exit-hint');
    $overlay  = document.getElementById('overlay');
    $oTitle   = document.getElementById('overlay-title');
    $oBody    = document.getElementById('overlay-body');
    $oBtn     = document.getElementById('overlay-btn');
    $joy      = document.getElementById('joystick');
    $knob     = document.getElementById('joy-knob');
    $flash    = document.getElementById('damage-flash');
    $interactPrompt = document.getElementById('interact-prompt');
    $pickupNotif    = document.getElementById('pickup-notif');
    $timerNum       = document.getElementById('timer-num');
    $killNum        = document.getElementById('kill-num');
    $partsNum       = document.getElementById('parts-num');
    $upgradeModal   = document.getElementById('upgrade-modal');
    $nearbyPanel    = document.getElementById('nearby-panel');
    $invOverlay     = document.getElementById('inv-overlay');

    loadUpgrades();
    initRenderer();
    setupInput();

    $oTitle.innerHTML = `${ic('shambling-zombie',24)} ZOMBIE ESCAPE`;
    $oBody.innerHTML = '<p style="color:#aaa;font-size:14px;margin-top:8px">Loading models...</p>';
    $oBtn.style.display = 'none';
    $overlay.style.display = 'flex';
    $hud.style.display = 'none';
    document.getElementById('action-buttons').style.display = 'none';

    animate();

    loadModels().then(() => {
      $oBtn.style.display = '';
      showStart();
    });

    if ('serviceWorker' in navigator)
      navigator.serviceWorker.register('./sw.js').catch(()=>{});
  });

  // ================================================================
  //  MODEL LOADING
  // ================================================================
  function normalizeModel(obj,targetH,feetAtGround){
    const box=new THREE.Box3().setFromObject(obj);
    const size=box.getSize(new THREE.Vector3());
    const biggest=Math.max(size.x,size.y,size.z)||1;
    obj.scale.setScalar(targetH/biggest);
    obj.updateMatrixWorld(true);
    const box2=new THREE.Box3().setFromObject(obj);
    const center=box2.getCenter(new THREE.Vector3());
    if(feetAtGround) obj.position.set(-center.x,-box2.min.y,-center.z);
    else             obj.position.set(-center.x,-center.y,-center.z);
    const g=new THREE.Group(); g.add(obj); return g;
  }

  function cloneModel(src){
    const clone=src.clone();
    clone.traverse(c=>{
      if(!c.isMesh) return;
      if(Array.isArray(c.material)) c.material=c.material.map(m=>m.clone());
      else if(c.material) c.material=c.material.clone();
    });
    return clone;
  }

  function loadModels(){
    return new Promise(resolve=>{
      const hasMTL=typeof THREE.MTLLoader!=='undefined';
      const hasOBJ=typeof THREE.OBJLoader!=='undefined';
      if(!hasMTL||!hasOBJ){resolve();return;}

      const defs=[
        // Player + zombie use RE-style procedural models (OBJ disabled)
        ['chest', './models/zombie/','Chest.mtl','Chest.obj',0.85,true],
        ['locker','./models/zombie/','Container_Green.mtl','Container_Green.obj',2.2,true],
      ];

      let remaining=defs.length;
      function tick(){if(--remaining===0)resolve();}

      defs.forEach(([key,dir,mtlFile,objFile,h,feet])=>{
        function loadObj(mats){
          const loader=new THREE.OBJLoader();
          if(mats)loader.setMaterials(mats);
          loader.load(dir+objFile,
            obj=>{MODELS[key]=normalizeModel(obj,h,feet);tick();},
            null,()=>tick());
        }
        const ml=new THREE.MTLLoader(); ml.setPath(dir);
        ml.load(mtlFile,mats=>{mats.preload();loadObj(mats);},null,()=>loadObj(null));
      });
    });
  }

  // ================================================================
  //  RENDERER
  // ================================================================
  function initRenderer(){
    const isMobile=/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    renderer=new THREE.WebGLRenderer({antialias:!isMobile,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,isMobile?1.5:2));
    renderer.setSize(window.innerWidth,window.innerHeight);
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=0.85;
    renderer.outputEncoding=THREE.sRGBEncoding;
    $canvas.appendChild(renderer.domElement);

    scene=new THREE.Scene();
    scene.background=new THREE.Color(0x030800);
    scene.fog=new THREE.FogExp2(0x030800,0.028);

    camera=new THREE.PerspectiveCamera(68,window.innerWidth/window.innerHeight,0.1,80);
    clock=new THREE.Clock();

    window.addEventListener('resize',()=>{
      renderer.setSize(window.innerWidth,window.innerHeight);
      camera.aspect=window.innerWidth/window.innerHeight;
      camera.updateProjectionMatrix();
    });
  }

  // ================================================================
  //  PROCEDURAL TEXTURES
  // ================================================================
  function _makeCanvas(w,h){
    if(typeof OffscreenCanvas!=='undefined')return new OffscreenCanvas(w,h);
    const c=document.createElement('canvas');c.width=w;c.height=h;return c;
  }

  function makeWallTexture(){
    const W=256,H=256;
    const cv=_makeCanvas(W,H); const ctx=cv.getContext('2d');
    // Base: ruined concrete dark grey-green
    ctx.fillStyle='#1a1c16'; ctx.fillRect(0,0,W,H);
    // Concrete variation patches
    for(let i=0;i<200;i++){
      const px=Math.random()*W,py=Math.random()*H;
      const pw=Math.random()*24+4,ph=Math.random()*18+4;
      const v=Math.floor(Math.random()*14);
      ctx.fillStyle=`rgba(${28+v},${30+v},${22+v},0.40)`;
      ctx.fillRect(px,py,pw,ph);
    }
    // Vertical water-streak / moisture stains
    for(let s=0;s<6;s++){
      const sx=Math.random()*W;
      const sh=Math.random()*H*0.6+H*0.3;
      const sy=Math.random()*(H-sh);
      const grd=ctx.createLinearGradient(sx,sy,sx+Math.random()*8-4,sy+sh);
      grd.addColorStop(0,'rgba(0,0,0,0)');
      grd.addColorStop(0.4,`rgba(0,0,0,${0.20+Math.random()*0.18})`);
      grd.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=grd; ctx.fillRect(sx-2,sy,5,sh);
    }
    // Cracks
    for(let c=0;c<5;c++){
      let cx=Math.random()*W,cy=Math.random()*H;
      ctx.strokeStyle=`rgba(0,0,0,${0.40+Math.random()*0.30})`; ctx.lineWidth=0.7;
      ctx.beginPath(); ctx.moveTo(cx,cy);
      for(let s=0;s<12;s++){
        cx+=(Math.random()-0.5)*20; cy+=Math.random()*14+2;
        ctx.lineTo(cx,cy);
      }
      ctx.stroke();
    }
    // Blood splatter (~5 spots)
    for(let b=0;b<5;b++){
      const bx=Math.random()*W,by=Math.random()*H;
      const r=Math.random()*12+5;
      const grd=ctx.createRadialGradient(bx,by,0,bx,by,r);
      grd.addColorStop(0,`rgba(80,0,0,${0.55+Math.random()*0.25})`);
      grd.addColorStop(1,'rgba(40,0,0,0)');
      ctx.beginPath(); ctx.arc(bx,by,r,0,Math.PI*2);
      ctx.fillStyle=grd; ctx.fill();
      // Drip
      if(Math.random()<0.5){
        const dl=Math.random()*30+10;
        const gdrd=ctx.createLinearGradient(bx,by,bx+(Math.random()-0.5)*6,by+dl);
        gdrd.addColorStop(0,`rgba(70,0,0,0.50)`);
        gdrd.addColorStop(1,'rgba(40,0,0,0)');
        ctx.strokeStyle=gdrd; ctx.lineWidth=1.5+Math.random()*1.5;
        ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(bx+(Math.random()-0.5)*4,by+dl);
        ctx.stroke();
      }
    }
    // Overall grime dots
    for(let px=0;px<W;px+=3)for(let py=0;py<H;py+=3){
      if(Math.random()<0.04){ctx.fillStyle=`rgba(0,0,0,${Math.random()*0.12})`;ctx.fillRect(px,py,3,3);}
    }
    const tex=new THREE.CanvasTexture(cv);
    tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
    tex.repeat.set(1,WALL_H/CELL);
    return tex;
  }

  function makeFloorTexture(){
    const W=512,H=512;
    const cv=_makeCanvas(W,H); const ctx=cv.getContext('2d');
    // Base: dark concrete brown-grey
    ctx.fillStyle='#141410'; ctx.fillRect(0,0,W,H);
    // Concrete texture noise patches
    for(let i=0;i<400;i++){
      const px=Math.random()*W,py=Math.random()*H;
      const pw=Math.random()*22+3,ph=Math.random()*16+3;
      const v=Math.floor(Math.random()*14);
      ctx.fillStyle=`rgba(${22+v},${20+v},${15+v},0.30)`;
      ctx.fillRect(px,py,pw,ph);
    }
    // Cracks: random-walk polylines
    for(let c=0;c<10;c++){
      let cx=Math.random()*W,cy=Math.random()*H;
      const steps=Math.floor(30+Math.random()*60);
      ctx.strokeStyle=`rgba(0,0,0,${0.30+Math.random()*0.30})`; ctx.lineWidth=0.7;
      ctx.beginPath(); ctx.moveTo(cx,cy);
      for(let s=0;s<steps;s++){
        cx+=(Math.random()-0.5)*10; cy+=(Math.random()-0.5)*10;
        ctx.lineTo(Math.max(0,Math.min(W,cx)),Math.max(0,Math.min(H,cy)));
      }
      ctx.stroke();
    }
    // Blood stains: dark red irregular ellipses
    for(let b=0;b<14;b++){
      const bx=Math.random()*W,by=Math.random()*H;
      const rx=Math.random()*32+10,ry=Math.random()*20+6;
      const grd=ctx.createRadialGradient(bx,by,0,bx,by,rx);
      grd.addColorStop(0,`rgba(55,0,0,${0.50+Math.random()*0.28})`);
      grd.addColorStop(0.6,`rgba(30,0,0,${0.25+Math.random()*0.15})`);
      grd.addColorStop(1,'rgba(15,0,0,0)');
      ctx.save(); ctx.translate(bx,by); ctx.scale(1,ry/rx); ctx.rotate(Math.random()*Math.PI);
      ctx.beginPath(); ctx.arc(0,0,rx,0,Math.PI*2);
      ctx.fillStyle=grd; ctx.fill(); ctx.restore();
    }
    // Grime / dust
    for(let i=0;i<120;i++){
      ctx.beginPath(); ctx.arc(Math.random()*W,Math.random()*H,Math.random()*3+0.5,0,Math.PI*2);
      ctx.fillStyle=`rgba(0,0,0,${Math.random()*0.28+0.04})`; ctx.fill();
    }
    const tex=new THREE.CanvasTexture(cv);
    tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
    tex.repeat.set(12,12);
    return tex;
  }

  function makeCeilingTexture(){
    const W=128,H=128;
    const cv=_makeCanvas(W,H); const ctx=cv.getContext('2d');
    ctx.fillStyle='#060610'; ctx.fillRect(0,0,W,H);
    // panel seams
    const P=32;
    ctx.strokeStyle='#04040c'; ctx.lineWidth=1.5;
    for(let x=0;x<=W;x+=P){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for(let y=0;y<=H;y+=P){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    // rust/water stains
    for(let i=0;i<18;i++){
      const sx=Math.random()*W,sy=Math.random()*H;
      const grd=ctx.createRadialGradient(sx,sy,0,sx,sy,6+Math.random()*14);
      grd.addColorStop(0,`rgba(18,7,0,${0.28+Math.random()*0.28})`); grd.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=grd; ctx.fillRect(sx-20,sy-20,40,40);
    }
    const tex=new THREE.CanvasTexture(cv);
    tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
    tex.repeat.set(15,15);
    return tex;
  }

  // ================================================================
  //  MAP
  // ================================================================
  function buildGrid(){
    grid=[];
    for(let r=0;r<ROWS;r++){
      grid[r]=[];
      for(let c=0;c<COLS;c++)
        grid[r][c]=(r===0||r===ROWS-1||c===0||c===COLS-1)?1:(Math.random()<0.27?1:0);
    }
    carve(1,1,3,3); carve(ROWS-4,COLS-4,ROWS-2,COLS-2);
    const mid=Math.floor(ROWS/2);
    for(let c=1;c<COLS-1;c++) grid[mid][c]=0;
    for(let r=1;r<=mid;r++) grid[r][1]=0;
    for(let r=mid;r<ROWS-1;r++) grid[r][COLS-2]=0;
  }
  function carve(r0,c0,r1,c1){for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)grid[r][c]=0;}
  function gw(r,c){return{x:c*CELL+CELL/2,z:r*CELL+CELL/2};}
  function hitsWall(x,z,r){
    for(let row=Math.floor((z-r)/CELL);row<=Math.floor((z+r)/CELL);row++)
      for(let col=Math.floor((x-r)/CELL);col<=Math.floor((x+r)/CELL);col++)
        if(row<0||row>=ROWS||col<0||col>=COLS||grid[row][col]===1)return true;
    return false;
  }
  function tryMove(obj,dx,dz,rad){
    if(!hitsWall(obj.x+dx,obj.z+dz,rad)){obj.x+=dx;obj.z+=dz;}
    else if(!hitsWall(obj.x+dx,obj.z,rad)){obj.x+=dx;}
    else if(!hitsWall(obj.x,obj.z+dz,rad)){obj.z+=dz;}
  }
  function dist2(ax,az,bx,bz){const dx=ax-bx,dz=az-bz;return Math.sqrt(dx*dx+dz*dz);}
  function angleDiff(a,b){let d=(a-b)%(Math.PI*2);if(d<-Math.PI)d+=Math.PI*2;if(d>Math.PI)d-=Math.PI*2;return d;}
  function openCell(minR=2,minC=2,avoidStart=true){
    let r,c,att=0;
    do{r=minR+Math.floor(Math.random()*(ROWS-minR-2));
       c=minC+Math.floor(Math.random()*(COLS-minC-2));att++;}
    while((grid[r][c]===1||(avoidStart&&r<5&&c<5))&&att<200);
    return att<200?{r,c}:null;
  }

  // ================================================================
  //  SCENE
  // ================================================================
  function buildScene(noSpawn=false){
    // Dispose GPU textures from previous run before clearing
    scene.traverse(obj=>{
      if(obj.isMesh){
        const mats=Array.isArray(obj.material)?obj.material:[obj.material];
        mats.forEach(m=>{if(m&&m.map&&m.map.isTexture)m.map.dispose();});
      }
    });
    while(scene.children.length) scene.remove(scene.children[0]);
    // Clean up bullets from previous run
    bullets=[]; lockTarget=null; lockMesh=null;
    worldItems=[]; containers=[];
    swingMesh=null;
    // Reset visual effect state
    flickerT=0; shakeTimer=0; bobPhase=0; lastMoveSpd=0;
    emgLight=null;
    _bloodPools.length=0;

    // ── Lighting ──
    // HemisphereLight: sky blue-grey above, warm dark brown below → surfaces get depth
    const hemi=new THREE.HemisphereLight(0x1a2810,0x0d0800,0.60); scene.add(hemi);
    // Player point light — yellow-green flashlight tint
    const pl=new THREE.PointLight(0x88bb66,2.0,18); pl.name='pLight'; scene.add(pl);
    // Emergency red accent light at map center — adds creepy atmosphere
    const midP=gw(Math.floor(ROWS/2),Math.floor(COLS/2));
    emgLight=new THREE.PointLight(0xff1100,0.45,16);
    emgLight.position.set(midP.x,WALL_H*0.82,midP.z); scene.add(emgLight);

    // ── Floor ──
    const floorTex=makeFloorTexture();
    const fm=new THREE.Mesh(
      new THREE.PlaneGeometry(COLS*CELL,ROWS*CELL),
      new THREE.MeshStandardMaterial({map:floorTex,roughness:0.92,metalness:0.04})
    );
    fm.rotation.x=-Math.PI/2; fm.position.set(COLS*CELL/2,0,ROWS*CELL/2); scene.add(fm);

    // ── Ceiling ──
    const ceilTex=makeCeilingTexture();
    const cm=new THREE.Mesh(
      new THREE.PlaneGeometry(COLS*CELL,ROWS*CELL),
      new THREE.MeshStandardMaterial({map:ceilTex,roughness:1.0,metalness:0.0})
    );
    cm.rotation.x=Math.PI/2; cm.position.set(COLS*CELL/2,WALL_H,ROWS*CELL/2); scene.add(cm);

    // ── Walls ──
    const wallTex=makeWallTexture();
    const cells=[];
    for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)if(grid[r][c]===1)cells.push({r,c});
    const iw=new THREE.InstancedMesh(
      new THREE.BoxGeometry(CELL,WALL_H,CELL),
      new THREE.MeshStandardMaterial({map:wallTex,roughness:0.85,metalness:0.05,color:0xffffff}),
      cells.length
    );
    const dummy=new THREE.Object3D();
    cells.forEach(({r,c},i)=>{const p=gw(r,c);dummy.position.set(p.x,WALL_H/2,p.z);dummy.updateMatrix();iw.setMatrixAt(i,dummy.matrix);});
    iw.instanceMatrix.needsUpdate=true; scene.add(iw);

    // ── Baseboards (thin strip at wall base) ──
    const bdGeo=new THREE.BoxGeometry(CELL+0.01,0.13,0.11);
    const bdMat=new THREE.MeshStandardMaterial({color:0x121510,roughness:0.9,metalness:0.1});
    const bdMesh=new THREE.InstancedMesh(bdGeo,bdMat,cells.length*4);
    const bd=new THREE.Object3D(); let bdIdx=0;
    cells.forEach(({r,c})=>{
      const p=gw(r,c);
      [[0,CELL/2+0.055,0],[0,-CELL/2-0.055,0],[CELL/2+0.055,0,Math.PI/2],[-CELL/2-0.055,0,Math.PI/2]].forEach(([ox,oz,ry])=>{
        bd.position.set(p.x+ox,0.065,p.z+oz); bd.rotation.y=ry; bd.updateMatrix();
        bdMesh.setMatrixAt(bdIdx++,bd.matrix);
      });
    });
    bdMesh.count=bdIdx; bdMesh.instanceMatrix.needsUpdate=true; scene.add(bdMesh);

    // ── Exit door ──
    const ep=gw(ROWS-3,COLS-3); exitPos={x:ep.x,z:ep.z};
    exitMesh=new THREE.Mesh(
      new THREE.BoxGeometry(CELL*0.7,WALL_H*0.92,0.35),
      new THREE.MeshStandardMaterial({color:0x003322,emissive:0x00ff55,emissiveIntensity:0.9,roughness:0.3,metalness:0.6})
    );
    exitMesh.position.set(ep.x,WALL_H/2,ep.z); scene.add(exitMesh);
    const el=new THREE.PointLight(0x00ff55,3.5,16); el.position.set(ep.x,WALL_H*0.6,ep.z); scene.add(el);
    const ring=new THREE.Mesh(
      new THREE.RingGeometry(1.2,1.6,32),
      new THREE.MeshBasicMaterial({color:0x00ff55,side:THREE.DoubleSide,transparent:true,opacity:0.5})
    );
    ring.rotation.x=-Math.PI/2; ring.position.set(ep.x,0.02,ep.z); ring.name='exitRing'; scene.add(ring);

    // ── Safehouse marker at spawn ──
    const sp=gw(1,1);
    const safeCircle=new THREE.Mesh(
      new THREE.CircleGeometry(2.5,32),
      new THREE.MeshStandardMaterial({color:0x00aaff,emissive:0x00aaff,emissiveIntensity:0.4,
        transparent:true,opacity:0.25,side:THREE.DoubleSide,depthWrite:false})
    );
    safeCircle.rotation.x=-Math.PI/2; safeCircle.position.set(sp.x,0.01,sp.z); safeCircle.name='safeCircle'; scene.add(safeCircle);
    const safeLight=new THREE.PointLight(0x00aaff,1.0,8); safeLight.position.set(sp.x,1.8,sp.z); safeLight.name='safeLight'; scene.add(safeLight);

    // ── Lock-on indicator (reticle that hovers above locked zombie) ──
    const lockGeo=new THREE.RingGeometry(0.30,0.42,16);
    const lockMat=new THREE.MeshBasicMaterial({color:0xff3300,transparent:true,opacity:0.92,side:THREE.DoubleSide,depthWrite:false});
    lockMesh=new THREE.Mesh(lockGeo,lockMat);
    lockMesh.rotation.x=-Math.PI/2;
    lockMesh.visible=false;
    scene.add(lockMesh);
    // 4 small corner ticks around the ring
    const tickMat=new THREE.MeshBasicMaterial({color:0xff6600,transparent:true,opacity:0.85,depthWrite:false});
    for(let ti=0;ti<4;ti++){
      const tickGeo=new THREE.BoxGeometry(0.06,0.001,0.22);
      const tick=new THREE.Mesh(tickGeo,tickMat);
      tick.rotation.y=ti*Math.PI/2;
      tick.position.set(Math.sin(ti*Math.PI/2)*0.52,0,Math.cos(ti*Math.PI/2)*0.52);
      lockMesh.add(tick);
    }

    if(!noSpawn){
      spawnPlayer(); spawnZombies(); spawnContainers(); spawnGroundItems();
    }
  }

  // ================================================================
  //  PLAYER
  // ================================================================
  function spawnPlayer(){
    const ps=gw(1,1); player.x=ps.x; player.z=ps.z; player.angle=0;
    player.hp=eff.hpMax(); player.stamina=eff.stMax(); player.exhausted=false;
    player.melee={...MELEE.fists,id:'fists'}; player.gun=null;
    meleeCD=0; gunCD=0; healCD=0; nearContainer=null;
    exhaustedNotified=false;
    killCount=0; gameStartTime=performance.now(); gameElapsed=0;
    cameraAngle=0;
    invInit();
    // Carry stashed parts (from previous win) into the new run
    const _stash=loadPartsStashCount();
    if(_stash>0){ invAdd('parts','parts',_stash,0); clearPartsStash(); }

    let g;
    if(MODELS.player){
      g=cloneModel(MODELS.player);
    } else {
      // RPD/STARS officer (RE-style) — front = local -Z
      g=new THREE.Group();
      const pSkinM=new THREE.MeshLambertMaterial({color:0xe0a87c});
      const pNavyM=new THREE.MeshLambertMaterial({color:0x1c2448});
      const pVestM=new THREE.MeshLambertMaterial({color:0x0f1220});
      const pBootM=new THREE.MeshLambertMaterial({color:0x0a0a0a});
      const pHairM=new THREE.MeshLambertMaterial({color:0x1a0d05});
      const pBeltM=new THREE.MeshLambertMaterial({color:0x111111});
      const pBadgeM=new THREE.MeshLambertMaterial({color:0xc8a820,emissive:new THREE.Color(0x443310),emissiveIntensity:0.5});
      // Boots
      [-0.14,0.14].forEach(ox=>{
        const b=new THREE.Mesh(new THREE.BoxGeometry(0.24,0.17,0.30),pBootM);
        b.position.set(ox,0.085,0.01); g.add(b);
      });
      // Lower legs
      [-0.13,0.13].forEach(ox=>{
        const l=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.38,0.22),pNavyM);
        l.position.set(ox,0.36,0); g.add(l);
      });
      // Upper legs
      [-0.13,0.13].forEach(ox=>{
        const l=new THREE.Mesh(new THREE.BoxGeometry(0.25,0.22,0.24),pNavyM);
        l.position.set(ox,0.66,0); g.add(l);
      });
      // Belt
      const pBelt=new THREE.Mesh(new THREE.BoxGeometry(0.54,0.07,0.27),pBeltM);
      pBelt.position.set(0,0.785,0); g.add(pBelt);
      // Torso (navy jacket)
      const pTorso=new THREE.Mesh(new THREE.BoxGeometry(0.54,0.50,0.27),pNavyM);
      pTorso.position.set(0,1.05,0); g.add(pTorso);
      // Tactical vest (darker, slightly wider depth)
      const pVest=new THREE.Mesh(new THREE.BoxGeometry(0.36,0.42,0.32),pVestM);
      pVest.position.set(0,1.05,0); g.add(pVest);
      // STARS gold badge (left chest, facing front = -Z)
      const pBadge=new THREE.Mesh(new THREE.BoxGeometry(0.08,0.06,0.02),pBadgeM);
      pBadge.position.set(-0.13,1.12,-0.17); g.add(pBadge);
      // Arms
      [-0.40,0.40].forEach(ox=>{
        const ua=new THREE.Mesh(new THREE.BoxGeometry(0.20,0.28,0.20),pNavyM);
        ua.position.set(ox,1.08,0); g.add(ua);
        const fa=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.26,0.18),pNavyM);
        fa.position.set(ox,0.79,0); g.add(fa);
      });
      // Neck
      const pNeck=new THREE.Mesh(new THREE.BoxGeometry(0.17,0.13,0.17),pSkinM);
      pNeck.position.set(0,1.32,0); g.add(pNeck);
      // Head
      const pHead=new THREE.Mesh(new THREE.BoxGeometry(0.42,0.40,0.38),pSkinM);
      pHead.position.set(0,1.57,0); g.add(pHead);
      // Hair (dark, short cropped)
      const pHairTop=new THREE.Mesh(new THREE.BoxGeometry(0.42,0.10,0.38),pHairM);
      pHairTop.position.set(0,1.77,0); g.add(pHairTop);
      const pHairSide=new THREE.Mesh(new THREE.BoxGeometry(0.46,0.16,0.40),pHairM);
      pHairSide.position.set(0,1.68,0); g.add(pHairSide);
    }
    player.mesh=g; g.position.set(player.x,0,player.z); scene.add(g);
    updatePlayerWeaponVisual();
    camera.position.set(player.x,CAM_H,player.z+CAM_DIST); camera.lookAt(player.x,1,player.z);
  }

  function restorePlayer(data){
    player.x=data.x; player.z=data.z; player.angle=data.angle;
    player.hp=data.hp; player.stamina=data.stamina;
    player.melee = data.meleeId&&MELEE[data.meleeId]?{...MELEE[data.meleeId],id:data.meleeId}:{...MELEE.fists,id:'fists'};
    player.gun   = data.gunId&&GUNS[data.gunId]?{...GUNS[data.gunId],id:data.gunId,ammo:data.gunAmmo}:null;
    player.mesh.position.set(player.x,0,player.z);
    player.mesh.rotation.y=player.angle;
    updatePlayerWeaponVisual();
  }

  // ================================================================
  //  ZOMBIES
  // ================================================================
  function makeZombieMesh(){
    let g;
    if(MODELS.zombie){
      g=cloneModel(MODELS.zombie);
      // OBJ zombie naturally faces -Z; rotate inner mesh so group front = +Z
      // (z.angle = atan2 toward player, so rotation.y=z.angle must yield +Z→player)
      if(g.children.length>0) g.children[0].rotation.y=Math.PI;
    } else {
      // RE-style zombie — front = local +Z, arms reach toward player
      g=new THREE.Group();
      const zDeadSkin=new THREE.MeshLambertMaterial({color:0x8a9070}); // grey-green dead flesh
      const zArm=new THREE.MeshLambertMaterial({color:0x7a8068});      // slightly darker arms
      const zPants=new THREE.MeshLambertMaterial({color:0x2e2836});    // dark grey worn pants
      const zShirt=new THREE.MeshLambertMaterial({color:0xc0b898});    // dirty cream shirt
      const zBlood=new THREE.MeshLambertMaterial({color:0x3a0000});    // dark dried blood
      const zDecay=new THREE.MeshLambertMaterial({color:0x5a6050});    // dark decay patches
      const zEye=new THREE.MeshBasicMaterial({color:0xddddd0});        // milky white eyes (RE trademark)
      // Feet (bare / worn shoes)
      [-0.12,0.12].forEach(ox=>{
        const f=new THREE.Mesh(new THREE.BoxGeometry(0.20,0.10,0.25),new THREE.MeshLambertMaterial({color:0x1a1208}));
        f.position.set(ox,0.05,0.02); g.add(f);
      });
      // Legs (torn dark pants)
      [-0.13,0.13].forEach(ox=>{
        const l=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.52,0.22),zPants);
        l.position.set(ox,0.36,0); g.add(l);
      });
      // Torso — dirty torn shirt
      const zBody=new THREE.Mesh(new THREE.BoxGeometry(0.54,0.58,0.28),zShirt);
      zBody.position.y=0.90; g.add(zBody);
      // Large blood stain on chest (front = +Z)
      const zB1=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.28,0.30),zBlood);
      zB1.position.set(0.06,0.90,0.01); g.add(zB1);
      // Bite wound / decay patch on shoulder
      const zB2=new THREE.Mesh(new THREE.BoxGeometry(0.14,0.12,0.30),zDecay);
      zB2.position.set(-0.22,1.06,0); g.add(zB2);
      // Arms reaching FORWARD (+Z = toward player)
      [-1,1].forEach(s=>{
        const ua=new THREE.Mesh(new THREE.BoxGeometry(0.20,0.15,0.32),zArm);
        ua.position.set(s*0.39,0.97,0.18); g.add(ua);
        const fa=new THREE.Mesh(new THREE.BoxGeometry(0.17,0.13,0.30),zDeadSkin);
        fa.position.set(s*0.40,0.93,0.40); g.add(fa);
      });
      // Neck (grey-green)
      const zNeck=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.14,0.18),zDeadSkin);
      zNeck.position.set(0,1.24,0.04); g.add(zNeck);
      // Head (slightly forward lean — RE zombie lurch)
      const zHead=new THREE.Mesh(new THREE.BoxGeometry(0.48,0.44,0.44),zDeadSkin);
      zHead.position.set(0,1.52,0.08); g.add(zHead);
      // Milky white eyes (RE-style — NOT red glowing)
      const eG=new THREE.SphereGeometry(0.065,6,4);
      [-0.13,0.13].forEach(ox=>{
        const e=new THREE.Mesh(eG,zEye);
        e.position.set(ox,1.56,0.23); g.add(e);
      });
      // Decay/wound marks on face
      const zWound=new THREE.Mesh(new THREE.BoxGeometry(0.10,0.06,0.46),zDecay);
      zWound.position.set(0.12,1.50,0.04); g.add(zWound);
    }
    // No bright glow — RE zombies don't emit green light
    // Faint sickly ambient (barely visible, just a hint of presence)
    const zl=new THREE.PointLight(0x443310,0.15,3); zl.position.y=1.2; g.add(zl);
    return g;
  }

  function spawnZombies(){
    zombies=[];
    for(let i=0;i<D.zCount;i++){
      const cell=openCell(4,4,true); if(!cell)continue;
      const wp=gw(cell.r,cell.c); const mesh=makeZombieMesh();
      mesh.position.set(wp.x,0,wp.z); scene.add(mesh);
      zombies.push({id:eid('z'),x:wp.x,z:wp.z,angle:Math.random()*Math.PI*2,
                    hp:D.zHp,maxHp:D.zHp,mesh,
                    wTimer:Math.random()*3,wDir:Math.random()*Math.PI*2,
                    lastDmg:0,flashTimer:0,
                    attackAnim:0,
                    baseX:wp.x,baseZ:wp.z});
    }
  }

  function restoreZombies(savedZombies){
    zombies=[];
    for(const z of savedZombies){
      const mesh=makeZombieMesh();
      mesh.position.set(z.x,0,z.z); mesh.rotation.y=z.angle; scene.add(mesh);
      zombies.push({x:z.x,z:z.z,angle:z.angle,hp:z.hp,maxHp:z.maxHp||D.zHp,mesh,
                    wTimer:Math.random()*3,wDir:Math.random()*Math.PI*2,
                    lastDmg:0,flashTimer:0,attackAnim:0,baseX:z.x,baseZ:z.z});
    }
  }

  // ================================================================
  //  ITEMS  (always use fast colored boxes)
  // ================================================================
  const ITEM_COLOR = {
    heal_bandage:0x22cc3a, heal_medkit:0xe8e8e8,
    ammo:0xccaa00, parts:0xff8800,
    melee_bat:0xaa6622, melee_pipe:0x778899, melee_axe:0x556644,
    gun_pistol:0x333344, gun_shotgun:0x3a2010,
  };
  const ITEM_GLOW  = {
    heal_bandage:0xffffff, heal_medkit:0x44ff88,
    ammo:0xffdd00, parts:0xff9900,
    melee_bat:0xffcc44, melee_pipe:0xaabbcc, melee_axe:0x99bb77,
    gun_pistol:0x88aaff, gun_shotgun:0xff6688,
  };

  function makeItemMesh(type,sub){
    const g=new THREE.Group();
    const ck=type==='melee'?`melee_${sub}`:type==='heal'?`heal_${sub}`:type==='gun'?`gun_${sub}`:type;
    const col=ITEM_COLOR[ck]||0xaaaaaa;

    if(type==='heal'&&sub==='bandage'){
      // === Green Herb (RE-style) ===
      const stemM=new THREE.MeshStandardMaterial({color:0x18aa2a,emissive:new THREE.Color(0x0a4a14),emissiveIntensity:0.5,roughness:0.7});
      const leafM=new THREE.MeshStandardMaterial({color:0x22cc3a,emissive:new THREE.Color(0x0a5518),emissiveIntensity:0.4,roughness:0.6});
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.035,0.18,6),stemM));
      for(let i=0;i<3;i++){
        const ang=i*(Math.PI*2/3);
        const leaf=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.12,0.025),leafM);
        leaf.position.set(Math.sin(ang)*0.06,0.02+i*0.02,Math.cos(ang)*0.06);
        leaf.rotation.y=ang; leaf.rotation.z=0.35;
        g.add(leaf);
      }
    } else if(type==='heal'&&sub==='medkit'){
      // === First Aid Spray (RE-style) ===
      const bodyM=new THREE.MeshStandardMaterial({color:0xe8e8e8,emissive:new THREE.Color(0x444444),emissiveIntensity:0.18,roughness:0.4,metalness:0.4});
      const capM=new THREE.MeshStandardMaterial({color:0xcc1111,emissive:new THREE.Color(0x550000),emissiveIntensity:0.3,roughness:0.6});
      const crossM=new THREE.MeshStandardMaterial({color:0xdd1111,emissive:new THREE.Color(0x660000),emissiveIntensity:0.5});
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,0.22,8),bodyM));
      const spCap=new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.055,0.06,6),capM);
      spCap.position.y=0.14; g.add(spCap);
      // Red cross label on body
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.075,0.06,0.01),crossM));
      const cr2=new THREE.Mesh(new THREE.BoxGeometry(0.01,0.06,0.075),crossM); g.add(cr2);
    } else if(type==='parts'){
      const pM=new THREE.MeshStandardMaterial({color:col,emissive:new THREE.Color(col),emissiveIntensity:0.28,roughness:0.45,metalness:0.6});
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.28,0.12,0.28),pM));
      const r2=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.28,0.12),pM); r2.rotation.y=Math.PI/4; g.add(r2);
    } else if(type==='ammo'){
      // Yellow ammo box
      const boxM=new THREE.MeshStandardMaterial({color:0xccaa00,emissive:new THREE.Color(0x443300),emissiveIntensity:0.25,roughness:0.5});
      const stripM=new THREE.MeshStandardMaterial({color:0x886600,roughness:0.8});
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.26,0.20,0.18),boxM));
      const stripe=new THREE.Mesh(new THREE.BoxGeometry(0.27,0.055,0.01),stripM);
      stripe.position.z=-0.09; g.add(stripe);
    } else if(type==='melee'){
      const mat=new THREE.MeshStandardMaterial({color:col,emissive:new THREE.Color(col),emissiveIntensity:0.18,roughness:0.65});
      if(sub==='bat'){
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.085,0.52,0.085),mat));
        const tape=new THREE.Mesh(new THREE.BoxGeometry(0.090,0.13,0.090),
          new THREE.MeshStandardMaterial({color:0x111111,roughness:0.9}));
        tape.position.y=-0.18; g.add(tape);
      } else if(sub==='axe'){
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.07,0.50,0.07),mat));
        const ahead=new THREE.Mesh(new THREE.BoxGeometry(0.26,0.17,0.05),mat);
        ahead.position.set(0.06,0.18,0); g.add(ahead);
      } else {
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.58,6),mat));
      }
    } else if(type==='gun'){
      if(sub==='pistol'){
        const mat=new THREE.MeshStandardMaterial({color:0x333344,emissive:new THREE.Color(0x111122),emissiveIntensity:0.18,roughness:0.35,metalness:0.75});
        const gripM=new THREE.MeshStandardMaterial({color:0x1a1a2a,roughness:0.7,metalness:0.2});
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.06,0.075,0.26),mat));
        const grip=new THREE.Mesh(new THREE.BoxGeometry(0.055,0.18,0.10),gripM);
        grip.position.set(0,-0.11,-0.06); g.add(grip);
        const slide=new THREE.Mesh(new THREE.BoxGeometry(0.055,0.085,0.22),
          new THREE.MeshStandardMaterial({color:0x222232,metalness:0.85,roughness:0.25}));
        slide.position.y=0.08; g.add(slide);
      } else {
        const woodM=new THREE.MeshStandardMaterial({color:0x3a2010,roughness:0.75,metalness:0.05});
        const metalM=new THREE.MeshStandardMaterial({color:0x1e1e1e,metalness:0.85,roughness:0.25});
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.085,0.10,0.24),woodM));
        const brl=new THREE.Mesh(new THREE.BoxGeometry(0.055,0.065,0.36),metalM);
        brl.position.set(0,0.02,0.12); g.add(brl);
        const pump=new THREE.Mesh(new THREE.BoxGeometry(0.085,0.055,0.13),
          new THREE.MeshStandardMaterial({color:0x4a3020,roughness:0.8}));
        pump.position.set(0,-0.02,0.09); g.add(pump);
      }
    }
    return g;
  }

  // ── Held weapon on player model ──
  function makeHeldWeaponMesh(type,sub){
    const g=new THREE.Group();
    const ck=type==='melee'?`melee_${sub}`:type==='gun'?`gun_${sub}`:null;
    if(!ck)return g;
    const col=ITEM_COLOR[ck]||0xaaaaaa;
    const mat=new THREE.MeshLambertMaterial({color:col});
    const darkMat=new THREE.MeshLambertMaterial({color:0x111111});
    if(type==='melee'){
      const hh=sub==='axe'?0.48:0.58;
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.07,hh,0.07),mat));
      if(sub==='axe'){
        const aHead=new THREE.Mesh(new THREE.BoxGeometry(0.24,0.15,0.05),mat);
        aHead.position.set(0.06,hh*0.35,0); g.add(aHead);
      } else if(sub==='bat'){
        // Handle wrap (darker tape near grip)
        const tape=new THREE.Mesh(new THREE.BoxGeometry(0.075,0.14,0.075),darkMat);
        tape.position.y=-hh*0.32; g.add(tape);
      }
    } else {
      if(sub==='shotgun'){
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.075,0.09,0.50),mat));
        const brl=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.065,0.38),darkMat);
        brl.position.y=0.01; g.add(brl);
      } else {
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.06,0.085,0.28),mat));
        const slide=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.07,0.22),darkMat);
        slide.position.y=0.01; g.add(slide);
      }
    }
    return g;
  }

  function updatePlayerWeaponVisual(){
    if(!player.mesh)return;
    const old=player.mesh.getObjectByName('heldWeapon');
    if(old)player.mesh.remove(old);
    // OBJ model has its own mesh — skip adding box weapon to avoid clipping
    if(MODELS.player)return;
    if(player.gun){
      const wm=makeHeldWeaponMesh('gun',player.gun.id);
      wm.name='heldWeapon';
      wm.position.set(0.40,0.86,-0.32);
      player.mesh.add(wm);
    } else if(player.melee.id!=='fists'){
      const wm=makeHeldWeaponMesh('melee',player.melee.id);
      wm.name='heldWeapon';
      wm.position.set(0.42,0.72,-0.32);
      wm.rotation.x=-0.25;
      player.mesh.add(wm);
    }
  }

  // ── Item use floating animation ──
  function showItemUseAnim(icon){
    const el=document.createElement('div');
    el.className='item-use-popup';
    el.innerHTML=icon;
    el.style.left=(window.innerWidth/2-16)+'px';
    el.style.top=(window.innerHeight*0.44-16)+'px';
    document.body.appendChild(el);
    setTimeout(()=>el.remove(),950);
  }

  function createItem(type,sub,amount,ammo,x,z){
    const mesh=makeItemMesh(type,sub); mesh.position.set(x,0.5,z); scene.add(mesh);
    worldItems.push({id:eid('i'),type,sub,amount:amount||0,ammo:ammo||0,x,z,mesh,collected:false,bob:Math.random()*Math.PI*2});
    invalidateNearbyPanel();
  }
  function randomMeleeSub(){const r=Math.random();return r<0.5?'bat':r<0.8?'pipe':'axe';}
  function randomAmmo(id){const max=GUNS[id].maxAmmo;return Math.max(1,Math.round(max*(Math.random()<0.05?1:Math.random()*0.85+0.05)));}

  function rollGround(){
    const r=Math.random();
    if(r<0.25)return{type:'heal',sub:'bandage',amount:1};
    if(r<0.38)return{type:'heal',sub:'medkit',amount:1};
    if(r<0.48)return{type:'ammo',sub:'pistol_ammo',amount:5+Math.floor(Math.random()*10)};
    if(r<0.54)return{type:'ammo',sub:'shotgun_ammo',amount:1+Math.floor(Math.random()*3)};
    if(r<0.65)return{type:'melee',sub:randomMeleeSub()};
    if(r<0.78)return{type:'gun',sub:'pistol',ammo:randomAmmo('pistol')};
    if(r<0.84)return{type:'gun',sub:'shotgun',ammo:randomAmmo('shotgun')};
    return{type:'parts',sub:'parts',amount:1+Math.floor(Math.random()*3)};
  }
  function rollCrate(type){
    const slots=type==='locker'?2+Math.floor(Math.random()*2):1+Math.floor(Math.random()*2);
    const items=[];
    for(let i=0;i<slots;i++){
      if(Math.random()<0.12)continue;
      const r=Math.random();
      if(r<0.22)items.push({type:'heal',sub:'bandage',amount:1});
      else if(r<0.38)items.push({type:'heal',sub:'medkit',amount:1});
      else if(r<0.52)items.push({type:'ammo',sub:'pistol_ammo',amount:5+Math.floor(Math.random()*12)});
      else if(r<0.58)items.push({type:'ammo',sub:'shotgun_ammo',amount:1+Math.floor(Math.random()*4)});
      else if(r<0.70)items.push({type:'melee',sub:randomMeleeSub()});
      else if(r<0.80)items.push({type:'gun',sub:'pistol',ammo:randomAmmo('pistol')});
      else if(r<0.88)items.push({type:'gun',sub:'shotgun',ammo:randomAmmo('shotgun')});
      else items.push({type:'parts',sub:'parts',amount:1+Math.floor(Math.random()*4)});
    }
    return items;
  }
  function spawnGroundItems(){
    for(let i=0;i<D.items;i++){
      const cell=openCell(2,2,true); if(!cell)continue;
      const wp=gw(cell.r,cell.c),ox=(Math.random()-0.5)*CELL*0.5,oz=(Math.random()-0.5)*CELL*0.5;
      const itm=rollGround(); createItem(itm.type,itm.sub,itm.amount||0,itm.ammo||0,wp.x+ox,wp.z+oz);
    }
  }
  function restoreItems(savedItems){
    worldItems=[];
    for(const i of savedItems) createItem(i.type,i.sub,i.amount,i.ammo,i.x,i.z);
  }

  // ================================================================
  //  CONTAINERS
  // ================================================================
  function makeContainerMesh(type){
    if(MODELS[type==='locker'?'locker':'chest'])
      return cloneModel(MODELS[type==='locker'?'locker':'chest']);
    const g=new THREE.Group();
    const isLocker=type==='locker';
    const w=isLocker?CELL*0.5:CELL*0.6, h=isLocker?WALL_H*0.75:WALL_H*0.3, dep=isLocker?CELL*0.35:CELL*0.5;
    const col=isLocker?0x667788:0x886633;
    const box=new THREE.Mesh(new THREE.BoxGeometry(w,h,dep),new THREE.MeshLambertMaterial({color:col}));
    box.position.y=h/2; g.add(box);
    const wire=new THREE.Mesh(new THREE.BoxGeometry(w+0.06,h+0.06,dep+0.06),new THREE.MeshBasicMaterial({color:0xffffff,wireframe:true,transparent:true,opacity:0.12}));
    wire.position.y=h/2; g.add(wire);
    return g;
  }
  function spawnContainers(){
    for(let i=0;i<D.crates;i++){
      const cell=openCell(2,2,true); if(!cell)continue;
      const wp=gw(cell.r,cell.c), type=Math.random()<0.4?'locker':'box';
      const mesh=makeContainerMesh(type); mesh.position.set(wp.x,0,wp.z); scene.add(mesh);
      containers.push({id:eid('c'),type,x:wp.x,z:wp.z,mesh,opened:false});
    }
  }
  function restoreContainers(saved){
    containers=[];
    for(const c of saved){
      const mesh=makeContainerMesh(c.type); mesh.position.set(c.x,0,c.z);
      if(c.opened) mesh.traverse(ch=>{if(ch.isMesh&&ch.material&&!ch.material.wireframe)ch.material.color.multiplyScalar(0.4);});
      scene.add(mesh);
      containers.push({type:c.type,x:c.x,z:c.z,mesh,opened:c.opened});
    }
  }

  // ================================================================
  //  INVENTORY SYSTEM
  // ================================================================
  function invInit(){
    invGrid=[];
    for(let r=0;r<INV_ROWS;r++){invGrid[r]=[];for(let c=0;c<INV_COLS;c++)invGrid[r][c]=null;}
    invItems=[]; invNextId=0; invCtxId=null;
    if(invOpen)renderInvUI();
  }

  function invGetItem(id){ return invItems.find(i=>i.id===id)||null; }

  function invCountType(type,sub){
    return invItems.filter(i=>i.type===type&&(!sub||i.sub===sub)).reduce((s,i)=>s+(i.amount||1),0);
  }

  function invCanPlace(row,col,w,h,excludeId=null){
    if(row<0||col<0||row+h>INV_ROWS||col+w>INV_COLS)return false;
    for(let r=row;r<row+h;r++)
      for(let c=col;c<col+w;c++)
        if(invGrid[r][c]!==null&&invGrid[r][c]!==excludeId)return false;
    return true;
  }

  function invFindSlot(w,h){
    for(let r=0;r<=INV_ROWS-h;r++)
      for(let c=0;c<=INV_COLS-w;c++)
        if(invCanPlace(r,c,w,h))return{row:r,col:c};
    return null;
  }

  function invPlaceItem(item){
    for(let r=item.row;r<item.row+item.h;r++)
      for(let c=item.col;c<item.col+item.w;c++)
        invGrid[r][c]=item.id;
  }

  function invClearItem(item){
    for(let r=0;r<INV_ROWS;r++)
      for(let c=0;c<INV_COLS;c++)
        if(invGrid[r][c]===item.id)invGrid[r][c]=null;
  }

  // Returns true if successfully added to inventory
  function invAdd(type,sub,amount,ammo){
    // Stackable consumables: merge into existing stack
    if(type==='heal'||type==='ammo'||type==='parts'){
      const existing=invItems.find(i=>i.type===type&&i.sub===sub);
      if(existing){existing.amount+=(amount||1);if(invOpen)renderInvUI();return true;}
    }
    const sz=ITEM_SIZES[sub]||{w:1,h:1};
    const slot=invFindSlot(sz.w,sz.h);
    if(!slot)return false; // No room
    const item={id:invNextId++,type,sub,amount:amount||1,ammo:ammo||0,
                row:slot.row,col:slot.col,w:sz.w,h:sz.h};
    invItems.push(item);
    invPlaceItem(item);
    if(invOpen)renderInvUI();
    return true;
  }

  function invRemove(id){
    const item=invGetItem(id);
    if(!item)return null;
    invClearItem(item);
    invItems=invItems.filter(i=>i.id!==id);
    if(invCtxId===id)invCtxId=null;
    if(invOpen)renderInvUI();
    return item;
  }

  // Drop inventory item to ground near player
  function invDrop(id){
    const item=invRemove(id);
    if(!item)return;
    const ox=(Math.random()-0.5)*2.0, oz=(Math.random()-0.5)*2.0;
    createItem(item.type,item.sub,item.amount,item.ammo,player.x+ox,player.z+oz);
    notify(`${ITEM_ICONS[item.sub]||ic('strongbox')} ${ITEM_NAMES[item.sub]||item.sub}を捨てた`);
    updateHUD(true);
  }

  // Equip weapon from inventory
  function invEquip(id){
    const item=invGetItem(id);
    if(!item)return;
    if(item.type==='melee'){
      const prev=player.melee;
      invRemove(id);
      if(prev.id!=='fists') invAdd('melee',prev.id,1,0);
      player.melee={...MELEE[item.sub],id:item.sub};
      notify(ic('crossed-swords',14)+` ${MELEE[item.sub].name}を装備！`);
    } else if(item.type==='gun'){
      const prev=player.gun;
      invRemove(id);
      if(prev) invAdd('gun',prev.id,1,prev.ammo);
      player.gun={...GUNS[item.sub],id:item.sub,ammo:item.ammo};
      notify(ic('revolver',14)+` ${GUNS[item.sub].name}を装備！`);
    }
    SFX.pickup(); updatePlayerWeaponVisual(); updateHUD(true); if(invOpen)renderInvUI();
  }

  // Use consumable from inventory
  function invUse(id){
    const item=invGetItem(id);
    if(!item)return;
    if(item.type==='heal'){
      if(player.hp>=eff.hpMax()){notify('HPは満タン！');return;}
      healCD=1.5;
      const healAmt=item.sub==='medkit'?55:30;
      player.hp=Math.min(eff.hpMax(),player.hp+healAmt);
      item.amount--;
      if(item.amount<=0)invRemove(id);
      SFX.heal(); notify(ic('first-aid-kit',14)+` HP +${healAmt} 回復`);
      showItemUseAnim(item.sub==='medkit'?ic('first-aid-kit',28):ic('bandage-roll',28));
      updateHUD(true); if(invOpen)renderInvUI();
    } else if(item.type==='ammo'){
      if(!player.gun){notify('銃がない！');return;}
      const gunSub=item.sub.replace('_ammo','');
      if(player.gun.id!==gunSub){notify('弾の種類が違う！');return;}
      const max=GUNS[player.gun.id].maxAmmo;
      const add=Math.min(item.amount,max-player.gun.ammo);
      if(add<=0){notify('弾は満タン！');return;}
      player.gun.ammo+=add; item.amount-=add;
      if(item.amount<=0)invRemove(id);
      notify(ic('revolver',14)+` 弾薬 +${add}（残弾:${player.gun.ammo}）`);
      showItemUseAnim(player.gun.id==='shotgun'?ic('shotgun-rounds',28):ic('bullets',28));
      SFX.pickup(); updateHUD(true); if(invOpen)renderInvUI();
    }
  }

  // Deduct parts from inventory (returns true if successful)
  function invDeductParts(amount){
    let rem=amount;
    for(const it of [...invItems].filter(i=>i.type==='parts')){
      if(rem<=0)break;
      const use=Math.min(it.amount,rem);
      it.amount-=use; rem-=use;
      if(it.amount<=0)invRemove(it.id);
    }
    return rem===0;
  }

  // ── Pickup world item into inventory ──
  function pickupWorldItem(worldItem){
    if(worldItem.collected)return;

    // ── Pre-flight: verify the pickup would succeed BEFORE removing from world ──
    // Auto-equip paths always succeed (no inventory slot needed)
    const autoMelee = worldItem.type==='melee' && player.melee.id==='fists';
    const autoGun   = worldItem.type==='gun'   && !player.gun;
    // Stackable items merge into existing slot — always succeeds if stack exists
    const isStack   = worldItem.type==='heal'||worldItem.type==='ammo'||worldItem.type==='parts';
    const hasStack  = isStack && invItems.some(i=>i.type===worldItem.type&&i.sub===worldItem.sub);
    // Ammo can fill the equipped gun without using an inventory slot
    const fillsGun  = worldItem.type==='ammo' && player.gun &&
                      player.gun.id===worldItem.sub.replace('_ammo','') &&
                      player.gun.ammo < GUNS[player.gun.id].maxAmmo;
    // If none of the above apply, we need a free inventory slot — check it now
    if(!autoMelee && !autoGun && !hasStack && !fillsGun){
      const sz=ITEM_SIZES[worldItem.sub]||{w:1,h:1};
      if(!invFindSlot(sz.w,sz.h)){
        notify('🎒 インベントリがいっぱい！アイテムを整理してから再度タップ');
        return; // Keep item in world
      }
    }

    // ── Commit: remove from world ──
    worldItem.collected=true;
    scene.remove(worldItem.mesh);
    worldItems=worldItems.filter(i=>!i.collected);
    if(mpEnabled && mpSock && worldItem.id) mpSock.emit('itemPickup', { itemId:worldItem.id });
    invalidateNearbyPanel();

    const icon=ITEM_ICONS[worldItem.sub]||ic('strongbox');
    const name=ITEM_NAMES[worldItem.sub]||worldItem.sub;

    if(worldItem.type==='ammo'){
      if(player.gun&&player.gun.id===worldItem.sub.replace('_ammo','')){
        const max=GUNS[player.gun.id].maxAmmo;
        const add=Math.min(worldItem.amount,max-player.gun.ammo);
        if(add>0){
          player.gun.ammo+=add;
          const rem=worldItem.amount-add;
          if(rem>0)invAdd('ammo',worldItem.sub,rem,0);
          notify(`${icon} 弾薬 +${add}`);
          SFX.pickup(); updateHUD(true); return;
        }
      }
      invAdd('ammo',worldItem.sub,worldItem.amount,0); // space guaranteed above
      SFX.pickup(); notify(`${icon} ${name} ×${worldItem.amount}`);

    } else if(worldItem.type==='heal'){
      invAdd('heal',worldItem.sub,1,0);
      SFX.pickup(); notify(`${icon} ${name}`);

    } else if(worldItem.type==='parts'){
      invAdd('parts','parts',worldItem.amount,0);
      SFX.pickup(); notify(ic('gears',14)+` 資材 +${worldItem.amount}`);

    } else if(worldItem.type==='melee'){
      if(autoMelee){
        player.melee={...MELEE[worldItem.sub],id:worldItem.sub};
        SFX.pickup(); updatePlayerWeaponVisual(); notify(ic('crossed-swords',14)+` ${MELEE[worldItem.sub].name}を装備！`);
      } else {
        invAdd('melee',worldItem.sub,1,0);
        SFX.pickup(); notify(`${icon} ${name}をバッグに入れた`);
      }

    } else if(worldItem.type==='gun'){
      if(autoGun){
        player.gun={...GUNS[worldItem.sub],id:worldItem.sub,ammo:worldItem.ammo};
        SFX.pickup(); updatePlayerWeaponVisual(); notify(ic('revolver',14)+` ${GUNS[worldItem.sub].name}を装備！`);
      } else {
        invAdd('gun',worldItem.sub,1,worldItem.ammo);
        SFX.pickup(); notify(`${icon} ${name}をバッグに入れた`);
      }
    }
    updateHUD(true);
  }

  // ── Nearby items panel ──
  let _nearbyPanelKey = '';
  function renderNearbyPanel(){
    if(!$nearbyPanel)return;
    if(invOpen){ $nearbyPanel.style.display='none'; _nearbyPanelKey=''; return; }

    const nearby=worldItems.filter(it=>!it.collected&&dist2(player.x,player.z,it.x,it.z)<PICKUP_R);
    // Build a stable key — only re-render DOM when the list actually changes
    const newKey=nearby.length===0?'':nearby.map(it=>it.mesh.uuid).join(',');
    if(newKey===_nearbyPanelKey){ nearbyWorldItems=nearby; return; } // no change
    _nearbyPanelKey=newKey;
    nearbyWorldItems=nearby;

    if(nearby.length===0){ $nearbyPanel.style.display='none'; return; }

    $nearbyPanel.style.display='block';
    $nearbyPanel.innerHTML=nearby.map((it,i)=>{
      const icon=ITEM_ICONS[it.sub]||ic('strongbox');
      const name=ITEM_NAMES[it.sub]||it.sub;
      const info=it.type==='gun'?` (${it.ammo}発)`:
                 (it.type==='ammo'||it.type==='parts')&&it.amount>1?` ×${it.amount}`:'';
      return `<div class="nearby-item" data-idx="${i}">${icon} ${name}${info}</div>`;
    }).join('');

    $nearbyPanel.querySelectorAll('.nearby-item').forEach(el=>{
      const i=parseInt(el.dataset.idx);
      const doPickup=()=>{ const wi=nearbyWorldItems[i]; if(wi&&!wi.collected)pickupWorldItem(wi); };
      el.addEventListener('click',doPickup);
      el.addEventListener('touchend',e=>{e.preventDefault();doPickup();});
    });
  }
  // Called whenever worldItems list changes — forces a panel refresh next frame
  function invalidateNearbyPanel(){ _nearbyPanelKey=''; }

  // ── Inventory UI ──
  const INV_CELL=58, INV_GAP=3, INV_PAD=4;

  function openInv(){
    invOpen=true;
    if($invOverlay)$invOverlay.style.display='flex';
    renderInvUI();
    if($nearbyPanel)$nearbyPanel.style.display='none';
    document.addEventListener('pointermove',_invOnPointerMove);
    document.addEventListener('pointerup',_invOnPointerUp);
    document.addEventListener('pointercancel',_invOnPointerUp);
  }

  function closeInv(){
    invOpen=false; invCtxId=null;
    if(invDrag){if(invDrag.ghostEl)invDrag.ghostEl.remove();invDrag=null;}
    _invClearDropHighlight();
    if($invOverlay)$invOverlay.style.display='none';
    const ctx=document.getElementById('inv-ctx');
    if(ctx)ctx.style.display='none';
    document.removeEventListener('pointermove',_invOnPointerMove);
    document.removeEventListener('pointerup',_invOnPointerUp);
    document.removeEventListener('pointercancel',_invOnPointerUp);
  }

  // ── Inventory: rotate item (swap w/h) ──
  function rotateInvItem(id){
    const item=invGetItem(id);
    if(!item||item.w===item.h)return; // square items can't rotate
    const nw=item.h,nh=item.w;
    invClearItem(item); // temporarily clear grid
    // Try same position first
    if(invCanPlace(item.row,item.col,nw,nh)){
      item.w=nw;item.h=nh;invPlaceItem(item);renderInvUI();return;
    }
    // Find any free slot
    item.w=nw;item.h=nh;
    const slot=invFindSlot(nw,nh);
    if(slot){
      item.row=slot.row;item.col=slot.col;invPlaceItem(item);renderInvUI();return;
    }
    // Revert — no room
    item.w=nh;item.h=nw;invPlaceItem(item);
    notify('回転できません（スペース不足）');
  }

  // ── Inventory Drag-and-Drop ──
  function _invDragStart(id,clientX,clientY){
    const item=invGetItem(id); if(!item)return;
    const icon=ITEM_ICONS[item.sub]||ic('strongbox');
    const ghost=document.createElement('div');
    ghost.className='inv-drag-ghost';
    // Compute display size from actual rendered grid
    const gridEl=document.getElementById('inv-grid');
    let gw2=item.w*58,gh2=item.h*58;
    if(gridEl){
      const rect=gridEl.getBoundingClientRect();
      const cw=(rect.width-8)/INV_COLS;
      const ch=(rect.height-8)/INV_ROWS;
      gw2=item.w*cw+(item.w-1)*0;
      gh2=item.h*ch+(item.h-1)*0;
    }
    ghost.style.width=gw2+'px'; ghost.style.height=gh2+'px';
    ghost.innerHTML=`<span style="font-size:22px">${icon}</span>`;
    ghost.style.left=(clientX-gw2/2)+'px'; ghost.style.top=(clientY-gh2/2)+'px';
    document.body.appendChild(ghost);
    invDrag={id,ghostEl:ghost,startX:clientX,startY:clientY,active:false,hoverKey:null};
  }

  function _invOnPointerMove(e){
    if(!invDrag)return;
    const clientX=e.clientX,clientY=e.clientY;
    const dx=clientX-invDrag.startX,dy=clientY-invDrag.startY;
    if(!invDrag.active){
      if(Math.sqrt(dx*dx+dy*dy)<8)return;
      invDrag.active=true;
      // Deselect context menu while dragging
      invCtxId=null;
      const ctx=document.getElementById('inv-ctx');
      if(ctx)ctx.style.display='none';
      renderInvUI(); // hide selection highlight
    }
    const gw2=parseFloat(invDrag.ghostEl.style.width)||40;
    const gh2=parseFloat(invDrag.ghostEl.style.height)||40;
    invDrag.ghostEl.style.left=(clientX-gw2/2)+'px';
    invDrag.ghostEl.style.top=(clientY-gh2/2)+'px';
    // Compute hover cell
    const gridEl=document.getElementById('inv-grid');
    if(!gridEl)return;
    const rect=gridEl.getBoundingClientRect();
    const cw=(rect.width-8)/INV_COLS;
    const ch=(rect.height-8)/INV_ROWS;
    const col=Math.floor((clientX-rect.left-4)/cw);
    const row=Math.floor((clientY-rect.top-4)/ch);
    const key=`${row},${col}`;
    if(invDrag.hoverKey===key)return;
    invDrag.hoverKey=key;
    const item=invGetItem(invDrag.id);
    if(!item)return;
    const valid=col>=0&&row>=0&&col+item.w<=INV_COLS&&row+item.h<=INV_ROWS&&
                invCanPlace(row,col,item.w,item.h,item.id);
    _invHighlightDrop(row,col,item.w,item.h,valid);
  }

  function _invOnPointerUp(e){
    if(!invDrag)return;
    const drag=invDrag; invDrag=null;
    if(drag.ghostEl)drag.ghostEl.remove();
    _invClearDropHighlight();
    if(!drag.active){
      // Short tap — treat as select
      selectInvItem(drag.id);
      return;
    }
    // Attempt drop
    const gridEl=document.getElementById('inv-grid');
    if(gridEl){
      const rect=gridEl.getBoundingClientRect();
      const cw=(rect.width-8)/INV_COLS;
      const ch=(rect.height-8)/INV_ROWS;
      const col=Math.floor((e.clientX-rect.left-4)/cw);
      const row=Math.floor((e.clientY-rect.top-4)/ch);
      const item=invGetItem(drag.id);
      if(item&&col>=0&&row>=0&&col+item.w<=INV_COLS&&row+item.h<=INV_ROWS&&
         invCanPlace(row,col,item.w,item.h,item.id)){
        invClearItem(item);
        item.row=row;item.col=col;
        invPlaceItem(item);
      }
    }
    renderInvUI();
  }

  function _invHighlightDrop(row,col,w,h,canDrop){
    const gridEl=document.getElementById('inv-grid');
    if(!gridEl)return;
    const cells=gridEl.querySelectorAll('.inv-cell');
    cells.forEach((c,i)=>{
      const cr=Math.floor(i/INV_COLS),cc=i%INV_COLS;
      c.classList.remove('drop-ok','drop-bad');
      if(cr>=row&&cr<row+h&&cc>=col&&cc<col+w)
        c.classList.add(canDrop?'drop-ok':'drop-bad');
    });
  }

  function _invClearDropHighlight(){
    const gridEl=document.getElementById('inv-grid');
    if(!gridEl)return;
    gridEl.querySelectorAll('.drop-ok,.drop-bad').forEach(c=>c.classList.remove('drop-ok','drop-bad'));
  }

  function renderInvUI(){
    const gridEl=document.getElementById('inv-grid');
    if(!gridEl)return;
    gridEl.innerHTML='';

    // Background cells
    for(let r=0;r<INV_ROWS;r++)
      for(let c=0;c<INV_COLS;c++){
        const cell=document.createElement('div');
        cell.className='inv-cell';
        gridEl.appendChild(cell);
      }

    // Item divs
    invItems.forEach(item=>{
      const div=document.createElement('div');
      div.className='inv-item'+(invCtxId===item.id?' selected':'');
      div.style.left=(item.col*(INV_CELL+INV_GAP)+INV_PAD)+'px';
      div.style.top=(item.row*(INV_CELL+INV_GAP)+INV_PAD)+'px';
      div.style.width=(item.w*INV_CELL+(item.w-1)*INV_GAP)+'px';
      div.style.height=(item.h*INV_CELL+(item.h-1)*INV_GAP)+'px';
      const icon=ITEM_ICONS[item.sub]||ic('strongbox');
      let extra='';
      if(item.type==='gun') extra=`<small>${item.ammo}発</small>`;
      else if(item.amount>1) extra=`<span class="inv-count">${item.amount}</span>`;
      div.innerHTML=`<span class="inv-icon">${icon}</span>${extra}`;
      div.addEventListener('pointerdown',e=>{e.preventDefault();_invDragStart(item.id,e.clientX,e.clientY);});
      gridEl.appendChild(div);
    });

    // Equipment slots
    const eqMelee=document.getElementById('equip-melee');
    const eqGun=document.getElementById('equip-gun');
    if(eqMelee){
      eqMelee.innerHTML=`<div class="eq-label">近接</div><div class="eq-val">${ic('crossed-swords',13)} ${player.melee.name}</div>`;
      eqMelee.className='equip-slot'+(player.melee.id!=='fists'?' has-item':'');
    }
    if(eqGun){
      if(player.gun){
        eqGun.innerHTML=`<div class="eq-label">銃</div><div class="eq-val">${ic('revolver',13)} ${player.gun.name}<br><small>${player.gun.ammo}/${GUNS[player.gun.id].maxAmmo}発</small></div>`;
        eqGun.className='equip-slot has-item';
      } else {
        eqGun.innerHTML=`<div class="eq-label">銃</div><div class="eq-val" style="color:#555">なし</div>`;
        eqGun.className='equip-slot';
      }
    }

    // Unequip gun button
    const btnUnequipGun=document.getElementById('inv-unequip-gun');
    if(btnUnequipGun){
      btnUnequipGun.style.display=player.gun?'inline-block':'none';
      btnUnequipGun.onclick=()=>{
        if(!player.gun)return;
        if(invAdd('gun',player.gun.id,1,player.gun.ammo)){
          player.gun=null; updatePlayerWeaponVisual(); updateHUD(true); renderInvUI();
          notify('銃をバッグにしまった');
        } else notify('インベントリがいっぱい！');
      };
    }
    const btnUnequipMelee=document.getElementById('inv-unequip-melee');
    if(btnUnequipMelee){
      btnUnequipMelee.style.display=player.melee.id!=='fists'?'inline-block':'none';
      btnUnequipMelee.onclick=()=>{
        if(player.melee.id==='fists')return;
        if(invAdd('melee',player.melee.id,1,0)){
          player.melee={...MELEE.fists,id:'fists'}; updatePlayerWeaponVisual(); updateHUD(true); renderInvUI();
          notify('武器をバッグにしまった');
        } else notify('インベントリがいっぱい！');
      };
    }

    // Context menu update
    const ctx=document.getElementById('inv-ctx');
    if(ctx&&invCtxId===null) ctx.style.display='none';
  }

  function selectInvItem(id){
    if(invCtxId===id){ invCtxId=null; renderInvUI(); const ctx=document.getElementById('inv-ctx'); if(ctx)ctx.style.display='none'; return; }
    invCtxId=id;
    renderInvUI();
    const ctx=document.getElementById('inv-ctx');
    const item=invGetItem(id);
    if(!item||!ctx)return;
    ctx.style.display='flex';
    const btnEquip=document.getElementById('inv-ctx-equip');
    const btnUse=document.getElementById('inv-ctx-use');
    const btnRotate=document.getElementById('inv-ctx-rotate');
    if(btnEquip) btnEquip.style.display=(item.type==='melee'||item.type==='gun')?'':'none';
    if(btnUse)   btnUse.style.display=(item.type==='heal'||item.type==='ammo')?'':'none';
    if(btnRotate) btnRotate.style.display=(item.w!==item.h)?'':'none';
  }

  // ================================================================
  //  MENU SCREENS (multi-step navigation)
  // ================================================================
  let _menuScreen = 'title'; // 'title'|'mode'|'solo'|'mp-room'|'mp-lobby'

  function showMenuScreen(screen){
    _menuScreen = screen;
    state = 'start'; overlayAction = 'start';
    $oTitle.innerHTML = `${ic('shambling-zombie',16)} ZOMBIE ESCAPE`;
    $oBtn.style.display = 'none';
    $overlay.style.display = 'flex';
    $hud.style.display = 'none';
    document.getElementById('action-buttons').style.display = 'none';
    if($nearbyPanel) $nearbyPanel.style.display = 'none';
    closeInv();
    if(screen==='title')    _menuTitle();
    else if(screen==='mode')    _menuMode();
    else if(screen==='solo')    _menuSolo();
    else if(screen==='mp-room') _menuMpRoom();
    else if(screen==='mp-lobby')_menuMpLobby();
  }
  function showStart(){ showMenuScreen('title'); }

  // Helpers
  function _mBack(to){ return `<button class="mback" data-to="${to}">← 戻る</button>`; }
  function _bindBack(){
    $oBody.querySelectorAll('.mback').forEach(b=>{
      b.addEventListener('click',e=>{e.stopPropagation();showMenuScreen(b.dataset.to);});
      b.addEventListener('touchend',e=>{e.preventDefault();e.stopPropagation();showMenuScreen(b.dataset.to);});
    });
  }
  function _mbtn(id,cls,txt){ return `<button id="${id}" class="mbtn ${cls}">${txt}</button>`; }
  function _bind(id,fn){
    const el=document.getElementById(id); if(!el)return;
    el.addEventListener('click',e=>{e.stopPropagation();fn();});
    el.addEventListener('touchend',e=>{e.preventDefault();e.stopPropagation();fn();});
  }

  // ── TITLE ──
  function _menuTitle(){
    const stash=loadPartsStashCount(); invInit(); if(stash>0)invAdd('parts','parts',stash,0);
    const upgStr=UPG_DEFS.map(u=>upgrades[u.id]>0?`${u.icon}Lv${upgrades[u.id]}`:'').filter(Boolean).join(' ');
    const hasUpg=stash>0||UPG_DEFS.some(u=>upgrades[u.id]>0);
    const hasSv=hasSave(); const sv=hasSv?loadRunData():null;
    $oBody.innerHTML=`
      <div class="ms">
        <p class="ms-hint">${ic('crossed-swords',12)}ATK &nbsp;${ic('revolver',12)}FIRE &nbsp;${ic('first-aid-kit',12)}HEAL &nbsp;${ic('strongbox',12)}OPEN &nbsp;${ic('backpack',12)}BAG<br>左タッチ：移動 &nbsp;右スワイプ：視点</p>
        ${upgStr?`<p class="ms-upg">強化済み: ${upgStr}</p>`:''}
        <div class="ms-btns">
          ${_mbtn('m-ng','mbtn-pri','🎮 NEW GAME')}
          ${sv?_mbtn('m-cont','mbtn-sec',`📂 続きから (${sv.diff||'normal'} ${fmtTime(sv.elapsed||0)})`):''}
          ${hasUpg?_mbtn('m-up','mbtn-blue',ic('house',13)+' セーフハウス ('+ic('gears',12)+'&thinsp;'+stash+')'):''}
        </div>
      </div>`;
    _bind('m-ng',()=>showMenuScreen('mode'));
    _bind('m-cont',()=>{const d=loadRunData();if(d)loadAndStart(d);});
    _bind('m-up',showUpgradeModal);
  }

  // ── MODE SELECT ──
  function _menuMode(){
    $oBody.innerHTML=`
      <div class="ms">
        ${_mBack('title')}
        <p class="ms-label">ゲームモード</p>
        <div class="ms-row">
          ${_mbtn('m-solo','mbtn-pri','👤 ソロ')}
          ${_mbtn('m-multi','mbtn-blue','👥 マルチ')}
        </div>
      </div>`;
    _bindBack();
    _bind('m-solo',()=>showMenuScreen('solo'));
    _bind('m-multi',()=>showMenuScreen('mp-room'));
  }

  // ── SOLO SETUP ──
  function _menuSolo(){
    const sv=hasSave()?loadRunData():null;
    $oBody.innerHTML=`
      <div class="ms">
        ${_mBack('mode')}
        <p class="ms-label">難易度</p>
        <div class="diff-row">
          ${['easy','normal','hard'].map(d=>`<button class="diff-btn${d===currentDiff?' active':''}" data-d="${d}">
            ${d==='easy'?'Easy':d==='normal'?ic('shambling-zombie',13)+' Normal':ic('dread-skull',13)+' Hard'}</button>`).join('')}
        </div>
        ${sv?`
        <div class="ms-save-box">
          <p class="ms-save-info">📂 ${sv.diff||'normal'} &nbsp;${ic('alarm-clock',12)} ${fmtTime(sv.elapsed||0)} &nbsp;${ic('dread-skull',12)} ${sv.kills||0}体</p>
          <div class="ms-row">
            ${_mbtn('m-cont','mbtn-sec','📂 続きから')}
            ${_mbtn('m-new','mbtn-pri','🆕 新規')}
          </div>
          ${_mbtn('m-del','mbtn-danger','🗑 セーブ削除')}
        </div>`:`
        <div class="ms-btns" style="margin-top:10px">
          ${_mbtn('m-new','mbtn-pri','▶ ゲーム開始')}
        </div>`}
      </div>`;
    _bindBack();
    $oBody.querySelectorAll('.diff-btn[data-d]').forEach(b=>{
      b.addEventListener('click',e=>{e.stopPropagation();currentDiff=b.dataset.d;D=DIFFS[currentDiff];_menuSolo();});
      b.addEventListener('touchend',e=>{e.preventDefault();e.stopPropagation();currentDiff=b.dataset.d;D=DIFFS[currentDiff];_menuSolo();});
    });
    _bind('m-new',startGame);
    _bind('m-cont',()=>{const d=loadRunData();if(d)loadAndStart(d);});
    _bind('m-del',()=>{clearRun();_menuSolo();});
  }

  // ── MP ROOM (name + room code) ──
  function _menuMpRoom(){
    const savedName=localStorage.getItem('mpPlayerName')||'';
    $oBody.innerHTML=`
      <div class="ms">
        ${_mBack('mode')}
        <p class="ms-label">マルチプレイ</p>
        <div class="ms-form">
          <input id="mp-name" type="text" maxlength="16" placeholder="プレイヤー名" value="${savedName}" class="ms-input">
          <div class="ms-row" style="gap:6px">
            <input id="mp-room-input" type="text" maxlength="8" placeholder="ルームID (例: ABCD)" class="ms-input" style="text-transform:uppercase;flex:1;min-width:0">
            ${_mbtn('mp-rand','mbtn-small','🎲')}
          </div>
          <div class="ms-row">
            ${_mbtn('mp-create','mbtn-pri','🏠 部屋を作る')}
            ${_mbtn('mp-join','mbtn-sec','🤝 参加する')}
          </div>
          ${mpEnabled?`
          <div class="ms-connected">
            接続中: <b style="color:#ffcc44">${mpRoom}</b>
            ${_mbtn('mp-go-lobby','mbtn-blue','ロビーへ →')}
          </div>
          ${_mbtn('mp-leave','mbtn-danger','⛔ 退出')}`:``}
        </div>
      </div>`;
    _bindBack();
    const ri=document.getElementById('mp-room-input');
    const ni=document.getElementById('mp-name');
    document.getElementById('mp-rand')?.addEventListener('click',e=>{e.stopPropagation();_mpRand(ri);});
    document.getElementById('mp-rand')?.addEventListener('touchend',e=>{e.preventDefault();e.stopPropagation();_mpRand(ri);});
    const doJoin=()=>{
      const roomId=(ri?.value||'').trim().toUpperCase();
      const name=(ni?.value||'').trim()||'Player';
      if(!roomId){notify('ルームIDを入力してください');return;}
      localStorage.setItem('mpPlayerName',name);
      mpConnect(roomId,name);
      setTimeout(()=>showMenuScreen('mp-lobby'),350);
    };
    const doCreate=()=>{
      let roomId=(ri?.value||'').trim().toUpperCase();
      if(!roomId){ _mpRand(ri); roomId=ri.value; }
      const name=(ni?.value||'').trim()||'Player';
      localStorage.setItem('mpPlayerName',name);
      mpConnect(roomId,name);
      setTimeout(()=>showMenuScreen('mp-lobby'),350);
    };
    _bind('mp-create',doCreate);
    _bind('mp-join',doJoin);
    _bind('mp-go-lobby',()=>showMenuScreen('mp-lobby'));
    _bind('mp-leave',()=>{mpDisconnect();_menuMpRoom();});
  }
  function _mpRand(input){
    const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let r=''; for(let i=0;i<4;i++) r+=c[Math.floor(Math.random()*c.length)];
    if(input) input.value=r;
  }

  // ── MP LOBBY (player list + host start) ──
  function _menuMpLobby(){
    if(!mpEnabled){showMenuScreen('mp-room');return;}
    const all=[`🎮 あなた${mpHost?' <b style="color:#ffcc44">(ホスト)</b>':' (ゲスト)'}`,...[...mpPlayers.values()].map(p=>`👤 ${p.name}`)];
    $oBody.innerHTML=`
      <div class="ms">
        ${_mBack('mp-room')}
        <div class="ms-room-hdr">
          <span class="ms-room-code">ルーム: <b>${mpRoom}</b></span>
          <span class="ms-room-count">${all.length}人接続中</span>
        </div>
        <div class="ms-players">${all.map(n=>`<div class="ms-player">${n}</div>`).join('')}</div>
        ${mpHost?`
        <p class="ms-label" style="margin-top:8px">難易度</p>
        <div class="diff-row">
          ${['easy','normal','hard'].map(d=>`<button class="diff-btn${d===currentDiff?' active':''}" data-d="${d}">
            ${d==='easy'?'Easy':d==='normal'?ic('shambling-zombie',13)+' Normal':ic('dread-skull',13)+' Hard'}</button>`).join('')}
        </div>
        <div class="ms-btns" style="margin-top:10px">
          ${_mbtn('mp-start','mbtn-pri','▶ ゲーム開始')}
        </div>`:`
        <p class="ms-waiting">ホストがゲームを開始するまでお待ちください</p>
        <div class="ms-dots"><span>●</span><span>●</span><span>●</span></div>`}
      </div>`;
    _bindBack();
    $oBody.querySelectorAll('.diff-btn[data-d]').forEach(b=>{
      b.addEventListener('click',e=>{e.stopPropagation();currentDiff=b.dataset.d;D=DIFFS[currentDiff];_menuMpLobby();});
      b.addEventListener('touchend',e=>{e.preventDefault();e.stopPropagation();currentDiff=b.dataset.d;D=DIFFS[currentDiff];_menuMpLobby();});
    });
    _bind('mp-start',mpHostStartGame);
  }

  function enterGame(){
    state='playing';
    $overlay.style.display='none'; $hud.style.display='block';
    document.getElementById('action-buttons').style.display='flex';
    updateHUD(true);
  }

  function startGame(){
    try {
      D=DIFFS[currentDiff]; buildGrid(); buildScene();
      enterGame();
    } catch(err){
      $oTitle.textContent='エラー発生';
      $oBody.innerHTML=`<pre style="font-size:11px;color:#f88;white-space:pre-wrap;text-align:left">${err.message}\n${err.stack||''}</pre>`;
    }
  }

  function loadAndStart(data){
    try {
      currentDiff=data.diff||'normal'; D=DIFFS[currentDiff];
      grid=data.grid;
      buildScene(true);
      spawnPlayer();
      restorePlayer(data.player);
      restoreZombies(data.zombies||[]);
      restoreContainers(data.containers||[]);
      restoreItems(data.items||[]);
      killCount=data.kills||0;
      gameStartTime=performance.now()-(data.elapsed||0)*1000;
      gameElapsed=data.elapsed||0;
      cameraAngle=data.player.angle||0;

      // Restore inventory (v3) or migrate old heals/parts from v2
      invInit();
      if(data.inventory&&data.inventory.length>0){
        for(const saved of data.inventory){
          const sz=ITEM_SIZES[saved.sub]||{w:1,h:1};
          if(invCanPlace(saved.row,saved.col,sz.w,sz.h)){
            const item={...saved,id:invNextId++,w:sz.w,h:sz.h};
            invItems.push(item); invPlaceItem(item);
          } else {
            const slot=invFindSlot(sz.w,sz.h);
            if(slot){ const item={...saved,id:invNextId++,row:slot.row,col:slot.col,w:sz.w,h:sz.h}; invItems.push(item); invPlaceItem(item); }
          }
        }
      }
      enterGame();
    } catch(err){
      $oTitle.textContent='ロードエラー';
      $oBody.innerHTML=`<pre style="font-size:11px;color:#f88;white-space:pre-wrap;text-align:left">${err.message}\n${err.stack||''}</pre>`;
      clearRun();
    }
  }

  function showResult(title,msg){
    overlayAction='menu';
    $oTitle.textContent=title;
    $oBody.innerHTML=`<p style="font-size:15px;line-height:1.8;color:rgba(255,255,255,0.85)">${msg}</p>`;
    $oBtn.textContent='メニューへ'; $oBtn.style.display='';
    $overlay.style.display='flex'; $hud.style.display='none';
    document.getElementById('action-buttons').style.display='none';
    if($nearbyPanel)$nearbyPanel.style.display='none';
    closeInv();
    bindUpgradeBtn();
  }

  // ================================================================
  //  INPUT
  // ================================================================
  function setupInput(){
    window.addEventListener('keydown',e=>{keys[e.code]=true;});
    window.addEventListener('keyup',e=>{keys[e.code]=false;});

    renderer.domElement.addEventListener('click',()=>{
      try{renderer.domElement.requestPointerLock?.();}catch(_){}
    });
    document.addEventListener('pointerlockchange',()=>{
      if(document.pointerLockElement===renderer.domElement) document.addEventListener('mousemove',onMM);
      else document.removeEventListener('mousemove',onMM);
    });

    document.addEventListener('touchstart',onTS,{passive:false});
    document.addEventListener('touchmove', onTM,{passive:false});
    document.addEventListener('touchend',  onTE,{passive:false});
    document.addEventListener('touchcancel',onTE,{passive:false});

    $oBtn.addEventListener('click',handleOBtn);
    $oBtn.addEventListener('touchend',e=>{e.preventDefault();handleOBtn();});

    addBtn('btn-attack',()=>doMelee());
    addBtn('btn-fire',()=>doShoot());
    addBtn('btn-heal',()=>doHeal());
    addBtn('btn-interact',()=>doInteract());
    // Also make the interact-prompt overlay itself tappable
    if($interactPrompt){
      $interactPrompt.addEventListener('click',()=>doInteract());
      $interactPrompt.addEventListener('touchend',e=>{e.preventDefault();doInteract();});
    }
    addBtn('btn-inv',()=>{if(invOpen)closeInv();else openInv();});

    document.getElementById('btn-upgrade-close')
      .addEventListener('click',()=>closeUpgradeModal());

    // Inventory context menu buttons
    const btnClose=document.getElementById('btn-inv-close');
    if(btnClose){ btnClose.addEventListener('click',()=>closeInv()); btnClose.addEventListener('touchend',e=>{e.preventDefault();closeInv();}); }

    const btnCtxEquip=document.getElementById('inv-ctx-equip');
    if(btnCtxEquip){ addBtnDirect(btnCtxEquip,()=>{if(invCtxId!==null)invEquip(invCtxId);}); }

    const btnCtxUse=document.getElementById('inv-ctx-use');
    if(btnCtxUse){ addBtnDirect(btnCtxUse,()=>{if(invCtxId!==null)invUse(invCtxId);}); }

    const btnCtxRotate=document.getElementById('inv-ctx-rotate');
    if(btnCtxRotate){ addBtnDirect(btnCtxRotate,()=>{if(invCtxId!==null)rotateInvItem(invCtxId);}); }

    const btnCtxDrop=document.getElementById('inv-ctx-drop');
    if(btnCtxDrop){ addBtnDirect(btnCtxDrop,()=>{if(invCtxId!==null){invDrop(invCtxId);invCtxId=null;const ctx=document.getElementById('inv-ctx');if(ctx)ctx.style.display='none';}}); }

    const btnCtxCancel=document.getElementById('inv-ctx-cancel');
    if(btnCtxCancel){ addBtnDirect(btnCtxCancel,()=>{invCtxId=null;const ctx=document.getElementById('inv-ctx');if(ctx)ctx.style.display='none';renderInvUI();}); }
  }

  function addBtn(id,fn){
    const el=document.getElementById(id); if(!el)return;
    let lt=0;
    el.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();lt=Date.now();fn();});
    el.addEventListener('click',()=>{if(Date.now()-lt>400)fn();});
  }
  function addBtnDirect(el,fn){
    if(!el)return;
    let lt=0;
    el.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();lt=Date.now();fn();});
    el.addEventListener('click',()=>{if(Date.now()-lt>400)fn();});
  }

  function handleOBtn(){
    if(overlayAction==='respawn') { clearTimeout(respawnTO); doRespawn(); }
    else showMenuScreen('title');
  }
  function onMM(e){ if(state!=='playing')return; cameraAngle-=e.movementX*0.0028; }

  function onTS(e){
    if(state!=='playing')return;
    if(invOpen)return; // don't process game input while inventory open
    const hw=window.innerWidth/2;
    for(const t of e.changedTouches){
      const el=document.elementFromPoint(t.clientX,t.clientY);
      if(el&&el.closest('#action-buttons,#overlay,#swap-prompt,#upgrade-modal,#inv-overlay,#nearby-panel'))continue;
      e.preventDefault();
      if(t.clientX<hw&&!joy.on){
        joy={on:true,id:t.identifier,bx:t.clientX,by:t.clientY,dx:0,dy:0};
        $joy.style.left=(t.clientX-55)+'px'; $joy.style.top=(t.clientY-55)+'px';
        $joy.style.display='block'; $knob.style.transform='translate(-50%,-50%)';
      } else if(t.clientX>=hw&&!look.on){
        look={on:true,id:t.identifier,px:t.clientX};
      }
    }
  }
  function onTM(e){
    if(state!=='playing'||invOpen)return;
    for(const t of e.changedTouches){
      if(t.identifier===joy.id){
        e.preventDefault();
        const dx=t.clientX-joy.bx,dy=t.clientY-joy.by,len=Math.sqrt(dx*dx+dy*dy)||1,cl=Math.min(len,44);
        joy.dx=dx/len; joy.dy=dy/len;
        $knob.style.transform=`translate(calc(-50% + ${joy.dx*cl}px),calc(-50% + ${joy.dy*cl}px))`;
      }
      if(t.identifier===look.id){e.preventDefault();cameraAngle-=(t.clientX-look.px)*0.0085;look.px=t.clientX;}
    }
  }
  function onTE(e){
    for(const t of e.changedTouches){
      if(t.identifier===joy.id){joy={on:false,id:-1,bx:0,by:0,dx:0,dy:0};$joy.style.display='none';}
      if(t.identifier===look.id){look={on:false,id:-1,px:0};}
    }
  }

  // ================================================================
  //  COMBAT
  // ================================================================
  function doMelee(){
    if(state!=='playing')return;
    if(meleeCD>0)return;
    if(player.exhausted&&player.melee.id!=='fists')return;
    if(player.stamina<player.melee.st&&player.melee.id!=='fists'){notify('スタミナ不足！');return;}
    player.stamina=Math.max(0,player.stamina-player.melee.st);
    meleeCD=player.melee.cd;
    SFX.melee();

    swingTimer=0.45;
    addSwingArc();

    const baseDmg=eff.meleeDmg(player.melee.dmg);
    let hit=false;
    for(let i=zombies.length-1;i>=0;i--){
      const z=zombies[i];
      if(z.dying)continue;
      const d=dist2(player.x,player.z,z.x,z.z);
      if(d>player.melee.range)continue;
      // player.angle 0 → faces -Z; atan2(dx,dz)=π for zombie at -Z → compare against angle+π
      const faceAng=player.angle+Math.PI;
      if(Math.abs(angleDiff(Math.atan2(z.x-player.x,z.z-player.z),faceAng))>player.melee.arc/2)continue;
      z.hp-=baseDmg; z.flashTimer=0.18; hit=true;
      if(z.hp<=0)killZombie(i);
    }
    if(hit){ setTimeout(()=>SFX.hit(),40); triggerShake(0.12); }
    else {
      // Check if any zombie is near but out of arc — give direction hint
      const anyNear=zombies.some(z=>!z.dying&&dist2(player.x,player.z,z.x,z.z)<player.melee.range*2);
      if(anyNear) notify('空振り！向いている方向を攻撃します');
    }
    updateHUD(true);
  }

  function triggerShake(mag=0.12){ shakeTimer=0.20; shakeMag=mag; }

  const _bloodPools=[];
  function spawnBloodPool(x,z){
    const r=0.4+Math.random()*0.7;
    const g=new THREE.CircleGeometry(r,8);
    const m=new THREE.MeshStandardMaterial({
      color:0x880000,transparent:true,
      opacity:0.7+Math.random()*0.2,roughness:1,depthWrite:false
    });
    const pool=new THREE.Mesh(g,m);
    pool.rotation.x=-Math.PI/2;
    pool.position.set(x,0.012,z);
    scene.add(pool);
    _bloodPools.push(pool);
    // Keep at most 40 pools to avoid memory growth
    if(_bloodPools.length>40){
      const old=_bloodPools.shift();
      scene.remove(old); old.geometry.dispose(); old.material.dispose();
    }
  }

  function addSwingArc(){
    if(swingMesh){scene.remove(swingMesh);swingMesh=null;}
    const mat=new THREE.MeshBasicMaterial({color:0xffdd66,transparent:true,opacity:0.5,side:THREE.DoubleSide,depthWrite:false});
    const geo=new THREE.CircleGeometry(player.melee.range,8,Math.PI/2-player.melee.arc/2,player.melee.arc);
    // Bake Rx(-π/2) into geometry buffer so the arc lies flat in XZ plane
    // with its center bisector pointing toward local -Z (world -Z at angle 0).
    // Then setting only rotation.y=player.angle on the mesh correctly rotates
    // the center to face (-sin(pa), 0, -cos(pa)) = player's facing direction.
    geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI/2));
    swingMesh=new THREE.Mesh(geo,mat);
    // NO rotation.x here — it's already baked into geo
    swingMesh.position.y=0.05;
    scene.add(swingMesh);
  }

  function doShoot(){
    if(state!=='playing')return;
    if(!player.gun||gunCD>0)return;
    if(player.gun.ammo<=0){
      const ammoSub=player.gun.id+'_ammo';
      const ammoItem=invItems.find(i=>i.type==='ammo'&&i.sub===ammoSub);
      if(ammoItem){ invUse(ammoItem.id); return; }
      notify('弾切れ！リロードできる弾もない');SFX.empty();return;
    }
    player.gun.ammo--; gunCD=GUNS[player.gun.id].fireCd;
    (player.gun.id==='shotgun'?SFX.shotgun:SFX.shoot)();
    swingTimer=0.14;

    const baseDmg=eff.gunDmg(GUNS[player.gun.id].dmg);
    const range=GUNS[player.gun.id].range;
    const isShotgun=player.gun.id==='shotgun';
    const gunId=player.gun.id;

    // Base aim direction: lock-on target first, then camera forward
    let bdx,bdz;
    if(lockTarget&&zombies.includes(lockTarget)){
      const d=dist2(player.x,player.z,lockTarget.x,lockTarget.z)||0.001;
      bdx=(lockTarget.x-player.x)/d; bdz=(lockTarget.z-player.z)/d;
    } else {
      bdx=-Math.sin(cameraAngle); bdz=-Math.cos(cameraAngle);
    }

    // Shotgun: 3 pellets with small spread; pistol: 1 bullet
    const pellets=isShotgun?[
      {dx:bdx,dz:bdz},
      {dx:bdx+0.10,dz:bdz+0.05},
      {dx:bdx-0.10,dz:bdz-0.05},
    ]:[{dx:bdx,dz:bdz}];

    const bulletColor=isShotgun?0xff8800:0xffee00;
    const bulletSpd=isShotgun?18:26;

    for(const p of pellets){
      const len=Math.sqrt(p.dx*p.dx+p.dz*p.dz)||1;
      const ndx=p.dx/len, ndz=p.dz/len;
      // Use shared geo/mat to avoid per-shot GC allocations
      const mesh=new THREE.Mesh(isShotgun?_bGeoS:_bGeoP, isShotgun?_bMatO:_bMatY);
      mesh.position.set(player.x,1.15,player.z);
      scene.add(mesh);
      bullets.push({mesh,x:player.x,z:player.z,dx:ndx,dz:ndz,
                    spd:bulletSpd,distLeft:range,dmg:baseDmg,gunId,hitOnce:!isShotgun});
    }
    updateHUD(true);
  }

  function doHeal(){
    if(state!=='playing')return;
    if(healCD>0)return;
    if(player.hp>=eff.hpMax()){notify('HPは満タン！');return;}
    // Find best heal item (medkit > bandage)
    const healItem = invItems.find(i=>i.type==='heal'&&i.sub==='medkit') ||
                     invItems.find(i=>i.type==='heal');
    if(!healItem){notify('回復アイテムがない！');return;}
    invUse(healItem.id);
  }

  function killZombie(idx){
    const z=zombies[idx];
    if(z.dying)return; // already dying
    // Blood pool at death position
    spawnBloodPool(z.x,z.z);
    // Broadcast kill to other players
    if(mpEnabled && mpSock) mpSock.emit('zombieKill', { zombieId:z.id });
    // Start death animation instead of instant removal
    z.dying=true; z.dyingTimer=0.8;
    // Pre-enable transparency on all sub-meshes so opacity fades work
    z.mesh.traverse(c=>{ if(c.isMesh&&c.material){ c.material.transparent=true; } });
    killCount++;
    SFX.die();
    const aliveCount=zombies.filter(zz=>!zz.dying).length; // z.dying already set above
    if(aliveCount>0&&Math.random()<0.4) setTimeout(()=>SFX.zombie(),200+Math.random()*300);
    notify(aliveCount<=0?`${ic('exit-door',14)} 全ゾンビ撃破！出口を目指せ！`:`${ic('dread-skull',14)} ゾンビを倒した！(${killCount}体)`);
  }

  // ================================================================
  //  INTERACT
  // ================================================================
  function doInteract(){
    if(state!=='playing')return;
    // Allow interact even while another container is opening
    if(nearContainer&&!nearContainer.opened&&!nearContainer.opening)
      openContainer(nearContainer);
  }

  function openContainer(c){
    c.opened=true;
    c.opening=true; // prevent re-triggering
    c.mesh.traverse(ch=>{
      if(ch.isMesh&&ch.material&&!ch.material.wireframe)ch.material.color.multiplyScalar(0.4);
    });
    nearContainer=null;
    $interactPrompt.style.display='none';
    document.getElementById('btn-interact').style.display='none';

    const loot=rollCrate(c.type);
    if(loot.length===0){ SFX.open(); notify(ic('strongbox',14)+' 空だった…'); return; }

    const label=c.type==='locker'?'ロッカー':'箱';

    // Initial rummage sound + "searching..." message
    SFX.rummage();
    notify(`${ic('strongbox',14)} ${label}を漁っている…`);

    // Item timing:
    //   items 0..(n-2): appear every 0.7 s  →  delay = (idx+1)*700 ms
    //   item  (n-1)   : last item, 1.2 s after the previous one
    loot.forEach((itm,idx)=>{
      const isLast=idx===loot.length-1;
      const delay=isLast ? idx*700+1200 : (idx+1)*700;

      // Play an extra rummage just before each item drops
      const rumbleAt=Math.max(0,delay-400);
      setTimeout(()=>{if(state==='playing')SFX.rummage();},rumbleAt);

      setTimeout(()=>{
        if(state!=='playing')return;
        // Spawn near current player position (not container) so item is always within PICKUP_R
        const ox=(Math.random()-0.5)*1.0,oz=(Math.random()-0.5)*1.0;
        createItem(itm.type,itm.sub,itm.amount||0,itm.ammo||0,player.x+ox,player.z+oz);
        SFX.itemFound();
        const icon=ITEM_ICONS[itm.sub]||ic('strongbox');
        const name=ITEM_NAMES[itm.sub]||itm.sub;
        const amtStr=itm.type==='gun'?` (${itm.ammo}発)`:itm.amount>1?` ×${itm.amount}`:'';
        notify(`${icon} ${name}${amtStr}が出てきた！${isLast?'（完了）':''}`);
      },delay);
    });
  }

  // ================================================================
  //  SAFEHOUSE UPGRADES
  // ================================================================
  function upgradeButtonHtml(){
    const pc=invCountType('parts');
    return `<div style="margin-top:14px">
      <button id="btn-open-upgrade" style="
        padding:10px 28px;border:2px solid rgba(0,180,255,0.6);border-radius:30px;
        background:rgba(0,60,120,0.6);color:#88ddff;font-size:14px;font-weight:bold;
        cursor:pointer;-webkit-tap-highlight-color:transparent;">
        ${ic('house',14)} セーフハウス アップグレード (${ic('gears',12)} ${pc})
      </button></div>`;
  }

  function bindUpgradeBtn(){
    const btn=document.getElementById('btn-open-upgrade');
    if(!btn)return;
    btn.addEventListener('click',()=>showUpgradeModal());
    btn.addEventListener('touchend',e=>{e.preventDefault();showUpgradeModal();});
  }

  function showUpgradeModal(){
    if(state==='playing') return;
    renderUpgradeModal();
    $upgradeModal.style.display='flex';
  }
  function closeUpgradeModal(){
    $upgradeModal.style.display='none';
    if(state==='start') _menuTitle(); // re-render title with updated parts count
  }

  function renderUpgradeModal(){
    const list = document.getElementById('upgrade-list');
    list.innerHTML = '';
    const pc=invCountType('parts');
    UPG_DEFS.forEach(u=>{
      const lv=upgrades[u.id]||0;
      const maxed=lv>=u.max;
      const canBuy=!maxed&&pc>=u.cost;
      const div=document.createElement('div');
      div.className='upg-row';
      div.innerHTML=`
        <div class="upg-info">
          <span class="upg-icon">${u.icon}</span>
          <div>
            <div class="upg-name">${u.name} <span class="upg-lv">Lv${lv}/${u.max}</span></div>
            <div class="upg-desc">${u.desc}</div>
          </div>
        </div>
        <button class="upg-btn${canBuy?'':' disabled'}" data-id="${u.id}">
          ${maxed?'MAX':ic('gears',12)+' '+u.cost+'個'}
        </button>`;
      list.appendChild(div);
    });
    document.getElementById('upgrade-parts').textContent=pc;
    list.querySelectorAll('.upg-btn:not(.disabled)').forEach(btn=>{
      const id=btn.dataset.id;
      const u=UPG_DEFS.find(x=>x.id===id);
      if(!u||(upgrades[id]||0)>=u.max||pc<u.cost)return;
      btn.addEventListener('click',()=>buyUpgrade(id));
      btn.addEventListener('touchend',e=>{e.preventDefault();buyUpgrade(id);});
    });
  }

  function buyUpgrade(id){
    const u=UPG_DEFS.find(x=>x.id===id);
    if(!u) return;
    if((upgrades[id]||0)>=u.max){notify('最大レベルです！');return;}
    const pc=invCountType('parts');
    if(pc<u.cost){notify('資材が足りない！');return;}
    invDeductParts(u.cost);
    // If we're on the start screen keep the stash in sync with invItems
    if(state!=='playing') savePartsStash(invCountType('parts'));
    upgrades[id]=(upgrades[id]||0)+1;
    saveUpgrades();
    SFX.upgrade();
    notify(ic('house',14)+` ${u.name} Lv${upgrades[id]}にアップグレード！`);
    if(id==='hpUp')   player.hp=Math.min(eff.hpMax(),player.hp+20);
    if(id==='stUp')   player.stamina=Math.min(eff.stMax(),player.stamina+15);
    renderUpgradeModal();
    updateHUD(true);
  }

  // ================================================================
  //  GAME LOOP
  // ================================================================
  function animate(){
    requestAnimationFrame(animate);
    const dt=Math.min(clock.getDelta(),0.05);
    if(state==='playing') update(dt);
    renderer.render(scene,camera);
  }

  function update(dt){
    const now=performance.now(), t=now*0.001;
    gameElapsed=(now-gameStartTime)*0.001;

    if(meleeCD>0)meleeCD-=dt; if(gunCD>0)gunCD-=dt; if(healCD>0)healCD-=dt;

    // Swing arc lifetime
    if(swingTimer>0){
      swingTimer-=dt;
      if(swingMesh){
        const prog=swingTimer/0.45;
        swingMesh.material.opacity=0.5*prog;
        const sinA=Math.sin(player.angle),cosA=Math.cos(player.angle);
        swingMesh.position.set(player.x-sinA*0.5,0.05,player.z-cosA*0.5);
        swingMesh.rotation.y=player.angle;
      }
      if(swingTimer<=0&&swingMesh){scene.remove(swingMesh);swingMesh=null;}
    }

    // Stamina
    const sprinting=(keys['ShiftLeft']||keys['ShiftRight'])&&(keys['KeyW']||keys['ArrowUp']||(joy.on&&joy.dy<-0.5));
    if(sprinting&&!player.exhausted){
      player.stamina=Math.max(0,player.stamina-ST_SPRINT*dt);
      if(player.stamina<=0)player.exhausted=true;
    } else {
      player.stamina=Math.min(eff.stMax(),player.stamina+ST_REGEN*dt);
      if(player.exhausted&&player.stamina>ST_THRESH)player.exhausted=false;
    }

    // Move input (skip if inventory open)
    if(!invOpen){
      let fwd=0,str=0;
      if(keys['KeyW']||keys['ArrowUp'])   fwd+=1;
      if(keys['KeyS']||keys['ArrowDown']) fwd-=1;
      if(keys['KeyA'])str-=1; if(keys['KeyD'])str+=1;
      if(keys['ArrowLeft']) cameraAngle+=1.9*dt;
      if(keys['ArrowRight'])cameraAngle-=1.9*dt;
      if(joy.on){fwd+=-joy.dy; str+=joy.dx;}
      if(keys['Space']&&!prevKeys['Space'])doMelee();
      if(keys['KeyF']&&!prevKeys['KeyF'])doShoot();
      if(keys['KeyR']&&!prevKeys['KeyR'])doHeal();
      if(keys['KeyE']&&!prevKeys['KeyE'])doInteract();
      if(keys['KeyB']&&!prevKeys['KeyB']){if(invOpen)closeInv();else openInv();}
      for(const k in keys)prevKeys[k]=keys[k];

      if(fwd!==0||str!==0){
        const len=Math.sqrt(fwd*fwd+str*str)||1, nf=fwd/len, ns=str/len;
        const sinC=Math.sin(cameraAngle), cosC=Math.cos(cameraAngle);
        const wx=-sinC*nf+cosC*ns;
        const wz=-cosC*nf-sinC*ns;
        player.angle=Math.atan2(-wx,-wz);
        const spd=(sprinting&&!player.exhausted)?eff.sprintSpd():eff.walkSpd();
        lastMoveSpd=spd;
        tryMove(player,wx*spd*dt,wz*spd*dt,PLAYER_R);
      } else {
        // Standing still → face camera forward so attack always hits what you see
        player.angle=cameraAngle;
        lastMoveSpd=0;
      }
    } else {
      for(const k in keys)prevKeys[k]=keys[k];
      lastMoveSpd=0; // inventory open → not moving
    }

    // Player mesh
    const tiltX = swingTimer>0 ? Math.sin(swingTimer*Math.PI/0.22)*0.35 : 0;
    player.mesh.position.set(player.x,0,player.z);
    player.mesh.rotation.set(-tiltX,player.angle,0,'YXZ');

    const pl=scene.getObjectByName('pLight'); if(pl)pl.position.set(player.x,2.2,player.z);

    // Camera
    const sinC=Math.sin(cameraAngle), cosC=Math.cos(cameraAngle);
    camera.position.x+=(player.x+sinC*CAM_DIST-camera.position.x)*CAM_LERP;
    camera.position.y+=(CAM_H-camera.position.y)*CAM_LERP;
    camera.position.z+=(player.z+cosC*CAM_DIST-camera.position.z)*CAM_LERP;
    camera.lookAt(player.x,1.1,player.z);

    // ── Camera bob (footstep sway) ──
    if(lastMoveSpd>0.1) bobPhase+=dt*(sprinting?12:7);
    const bobAmt=lastMoveSpd>0.1?(sprinting?0.055:0.030):0;
    camera.position.y+=Math.sin(bobPhase)*bobAmt;

    // ── Screen shake ──
    if(shakeTimer>0){
      shakeTimer-=dt;
      camera.position.x+=(Math.random()-0.5)*shakeMag;
      camera.position.y+=(Math.random()-0.5)*shakeMag*0.5;
      camera.position.z+=(Math.random()-0.5)*shakeMag;
    }

    // ── Emergency light flicker ──
    if(emgLight){
      flickerT+=dt;
      emgLight.intensity=0.35+0.25*Math.sin(flickerT*17.3)*Math.sin(flickerT*5.1);
      if(Math.random()<0.005)emgLight.intensity=0;
    }

    // Exit
    if(dist2(player.x,player.z,exitPos.x,exitPos.z)<EXIT_R){winGame();return;}
    if(exitMesh)exitMesh.rotation.y=t*1.1;
    const ring=scene.getObjectByName('exitRing'); if(ring)ring.material.opacity=0.3+0.25*Math.sin(t*2.5);

    // Safehouse visual pulse (emissiveIntensity)
    const sl=scene.getObjectByName('safeLight');
    if(sl)sl.intensity=0.9+0.3*Math.sin(t*2);
    const sc=scene.getObjectByName('safeCircle');
    if(sc)sc.material.emissiveIntensity=0.3+0.2*Math.sin(t*2);

    // Items bob (no auto-pickup anymore)
    worldItems=worldItems.filter(it=>!it.collected);
    for(const it of worldItems){
      it.mesh.position.y=0.45+Math.sin(t*2+it.bob)*0.1;
      it.mesh.rotation.y=t*0.9+it.bob;
    }

    // Nearby items panel
    renderNearbyPanel();

    // Containers
    nearContainer=null;
    for(const c of containers){
      if(!c.opened&&dist2(player.x,player.z,c.x,c.z)<INTERACT_R){nearContainer=c;break;}
    }
    $interactPrompt.style.display=nearContainer?'block':'none';
    document.getElementById('btn-interact').style.display=nearContainer?'flex':'none';

    // ── Lock-on target update ──
    if(player.gun){
      const lockRange=GUNS[player.gun.id].range;
      const faceAng=player.angle+Math.PI;
      let best=null,bestDist=Infinity;
      for(const z of zombies){
        const d=dist2(player.x,player.z,z.x,z.z);
        if(d>lockRange)continue;
        if(Math.abs(angleDiff(Math.atan2(z.x-player.x,z.z-player.z),faceAng))>Math.PI*0.55)continue;
        if(d<bestDist){bestDist=d;best=z;}
      }
      lockTarget=best;
      if(lockMesh){
        if(lockTarget){
          lockMesh.visible=true;
          lockMesh.position.set(lockTarget.x,2.3+Math.sin(t*5)*0.06,lockTarget.z);
          lockMesh.rotation.z=t*2.5;
        } else { lockMesh.visible=false; }
      }
    } else {
      lockTarget=null;
      if(lockMesh)lockMesh.visible=false;
    }

    // ── Bullet movement ──
    for(let bi=bullets.length-1;bi>=0;bi--){
      const b=bullets[bi];
      const mv=b.spd*dt;
      b.x+=b.dx*mv; b.z+=b.dz*mv;
      b.distLeft-=mv;
      b.mesh.position.set(b.x,1.15,b.z);
      // Wall collision
      if(hitsWall(b.x,b.z,0.1)){
        scene.remove(b.mesh);
        bullets.splice(bi,1); continue;
      }
      // Zombie hit
      let removed=false;
      for(let zi=zombies.length-1;zi>=0;zi--){
        const z=zombies[zi];
        if(z.dying)continue;
        if(dist2(b.x,b.z,z.x,z.z)<0.72){
          z.hp-=b.dmg; z.flashTimer=0.22;
          SFX.hit();
          if(z.hp<=0)killZombie(zi);
          if(b.hitOnce){
            scene.remove(b.mesh);
            bullets.splice(bi,1); removed=true; break;
          }
        }
      }
      if(removed)continue;
      // Range exhausted
      if(b.distLeft<=0){
        scene.remove(b.mesh);
        bullets.splice(bi,1);
      }
    }

    // Zombies
    for(let i=zombies.length-1;i>=0;i--){
      const z=zombies[i];

      // ── Death animation ──
      if(z.dying){
        z.dyingTimer-=dt;
        const prog=Math.max(0,z.dyingTimer/0.8);
        z.mesh.rotation.z=(1-prog)*Math.PI*0.5; // topple sideways
        z.mesh.traverse(c=>{ if(c.isMesh&&c.material)c.material.opacity=prog; });
        if(z.dyingTimer<=0){ scene.remove(z.mesh); zombies.splice(i,1); }
        continue;
      }

      if(z.flashTimer>0){
        z.flashTimer-=dt;
        const flashOn=z.flashTimer>0;
        // traverse only runs while flash is active (was running every frame for all zombies)
        z.mesh.traverse(c=>{
          if(c.isMesh&&c.material&&c.material.emissive){
            c.material.emissive.setHex(flashOn?0xff0000:0x000000);
            c.material.emissiveIntensity=flashOn?0.8:0;
          }
        });
      }

      const dx=player.x-z.x,dz=player.z-z.z,d=Math.sqrt(dx*dx+dz*dz)||0.001;
      if(d<D.zDet){
        // Stop pushing when already in contact (prevents position jitter at d≈0)
        if(d>PLAYER_R+ZOMBIE_R){
          const spd=d<5?D.zRun:D.zSpd;
          tryMove(z,(dx/d)*spd*dt,(dz/d)*spd*dt,ZOMBIE_R);
        }
        z.angle=Math.atan2(dx,dz);
      } else {
        z.wTimer-=dt;
        if(z.wTimer<=0){z.wDir=Math.random()*Math.PI*2;z.wTimer=1.5+Math.random()*2.5;}
        tryMove(z,Math.sin(z.wDir)*D.zSpd*0.38*dt,Math.cos(z.wDir)*D.zSpd*0.38*dt,ZOMBIE_R);
        z.angle=z.wDir;
      }

      if(z.attackAnim>0){
        z.attackAnim-=dt;
        const lungeAmt=Math.sin(z.attackAnim/0.25*Math.PI)*0.45;
        const ax=Math.sin(z.angle),az=Math.cos(z.angle);
        z.mesh.position.set(z.x+ax*lungeAmt,0,z.z+az*lungeAmt);
      } else {
        z.mesh.position.set(z.x,0,z.z);
      }
      z.mesh.rotation.y=z.angle;

      if(d<1.15){
        player.hp-=D.zDmg*dt;
        if(now-z.lastDmg>450){
          z.lastDmg=now;
          z.attackAnim=0.25;
          flashDamage(); SFX.hit(); triggerShake(0.18);
          if(Math.random()<0.5)SFX.zombie();
        }
      }
    }

    player.hp=Math.max(0,player.hp);
    updateHUD(); // throttled to 30fps in the game loop

    saveTimer-=dt;
    if(saveTimer<=0){saveTimer=5;saveRun();}

    if(player.hp<=0)gameOver();

    // ── Multiplayer tick ──
    if(mpEnabled){
      _mpMoveT+=dt;
      if(_mpMoveT>=0.05){ _mpMoveT=0; _mpSendMove(); }
      _mpTickPlayers(dt);
    }
  }

  // ================================================================
  //  HUD
  // ================================================================
  function fmtTime(s){const m=Math.floor(s/60),sec=Math.floor(s%60);return`${m}:${String(sec).padStart(2,'0')}`;}

  let _hudLast=0;
  function updateHUD(force=false){
    const now2=performance.now();
    if(!force&&state==='playing'&&now2-_hudLast<33)return; // 30fps cap for DOM updates
    _hudLast=now2;
    const hpPct=player.hp/eff.hpMax()*100;
    $hpFill.style.width=hpPct+'%';
    $hpFill.style.background=hpPct>60?'#00e855':hpPct>30?'#ffaa00':'#ff2222';
    $hpNum.textContent=Math.ceil(player.hp);

    const stPct=player.stamina/eff.stMax()*100;
    $stFill.style.width=stPct+'%';
    $stFill.style.background=player.exhausted?'#666':stPct>40?'#00bbff':'#ff8800';
    $stNum.textContent=Math.ceil(player.stamina);
    if(player.exhausted&&!exhaustedNotified){notify('スタミナ切れ！');exhaustedNotified=true;}
    if(!player.exhausted)exhaustedNotified=false;

    $weaponInfo.innerHTML=`${ic('crossed-swords',14)} ${player.melee.name}`;
    if(player.gun){
      const g=GUNS[player.gun.id];
      const gIco=player.gun.id==='shotgun'?ic('sawed-off-shotgun',14):ic('revolver',14);
      $gunInfo.innerHTML=`${gIco} ${g.name} ${player.gun.ammo}/${g.maxAmmo}`;
      $gunInfo.style.color=player.gun.ammo>0?'#ffdd88':'#ff4444'; $gunInfo.className='';
    } else { $gunInfo.innerHTML=`${ic('revolver',14)} なし`; $gunInfo.style.color=''; $gunInfo.className='dim'; }

    const healCnt=invCountType('heal');
    $healCount.innerHTML=`${ic('first-aid-kit',14)} ×${healCnt}`;
    $healCount.className=healCnt>0?'':'dim';

    const partsCnt=invCountType('parts');
    if($partsNum){$partsNum.textContent=partsCnt; document.getElementById('parts-row').style.display=partsCnt>0?'inline':'none';}

    const d=dist2(player.x,player.z,exitPos.x,exitPos.z);
    let exitLabel;
    if(d<EXIT_R*1.5){exitLabel='出口に到達！';}
    else if(d<20){exitLabel='出口が近い！';}
    else{
      // Compute arrow pointing toward exit relative to camera forward direction
      const angToExit=Math.atan2(exitPos.x-player.x,exitPos.z-player.z);
      let rel=angToExit-(cameraAngle+Math.PI);
      while(rel>Math.PI)rel-=Math.PI*2; while(rel<-Math.PI)rel+=Math.PI*2;
      const arrowDir=['↑','↗','→','↘','↓','↙','←','↖'];
      const ai=(((Math.round(rel/(Math.PI/4))%8)+8)%8);
      exitLabel=arrowDir[ai]+` 出口まで約${Math.round(d)}m`;
    }
    $exitHint.innerHTML=`${ic('exit-door',13)} ${exitLabel}`;

    document.getElementById('btn-attack').style.opacity=player.exhausted?'0.4':'1';
    document.getElementById('btn-fire').style.opacity=(player.gun&&player.gun.ammo>0)?'1':'0.35';
    document.getElementById('btn-heal').style.opacity=healCnt>0?'1':'0.35';

    if($timerNum)$timerNum.textContent=fmtTime(gameElapsed);
    if($killNum) $killNum.textContent=killCount;
  }

  let fTO=null;
  function flashDamage(){$flash.style.opacity='1';clearTimeout(fTO);fTO=setTimeout(()=>$flash.style.opacity='0',350);}

  const notifQueue=[];
  let notifTO=null;
  function notify(txt){
    $pickupNotif.innerHTML=txt;
    $pickupNotif.style.opacity='1';
    $pickupNotif.classList.add('show');
    clearTimeout(notifTO);
    notifTO=setTimeout(()=>{$pickupNotif.style.opacity='0';$pickupNotif.classList.remove('show');},2000);
  }

  // ================================================================
  //  WIN / GAMEOVER / RESPAWN
  // ================================================================
  function winGame(){
    state='win'; SFX.win();
    if(mpEnabled && mpSock) mpSock.emit('gameWon');
    savePartsStash(invCountType('parts'));
    clearRun();
    showResult('🎉 脱出成功！',`
      ゾンビから逃げ切った！<br>
      <span style="font-size:13px;color:#aaa">
        ${ic('alarm-clock',13)} <b style="color:#fff">${fmtTime(gameElapsed)}</b> &ensp;
        ${ic('dread-skull',13)} <b style="color:#fff">${killCount}体</b> &ensp;
        ${ic('heart-plus',13)} <b style="color:#ff4">${Math.ceil(player.hp)}</b>
      </span>
      ${upgradeButtonHtml()}
      <div style="margin-top:8px">
        <button id="btn-win-newgame" style="padding:10px 28px;border:2px solid rgba(0,255,100,0.6);
          border-radius:30px;background:rgba(0,80,30,0.7);color:#88ffaa;font-size:14px;
          font-weight:bold;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          ▶ ニューゲームへ
        </button>
      </div>`);
    // Override main button to go to start screen (shows difficulty + upgrade)
    overlayAction='menu';
    $oBtn.textContent='メニューへ';
    // Bind the quick new-game button
    setTimeout(()=>{
      const bng=document.getElementById('btn-win-newgame');
      if(bng){
        bng.addEventListener('click',()=>showMenuScreen('title'));
        bng.addEventListener('touchend',e=>{e.preventDefault();showMenuScreen('title');});
      }
    },0);
  }

  function gameOver(){
    if(state!=='playing')return;
    state='respawning'; SFX.gameover();
    saveRun();

    $oTitle.innerHTML=`${ic('dread-skull',24)} やられた...`;
    $oBody.innerHTML=`
      <p style="color:#ff4444;font-size:15px;font-weight:bold">全アイテムロスト（資材は持越し）</p>
      <p style="font-size:13px;color:#aaa;margin-top:10px">
        ${ic('alarm-clock',13)} ${fmtTime(gameElapsed)} &nbsp;${ic('dread-skull',13)} ${killCount}体撃破
      </p>
      ${upgradeButtonHtml()}
      <p style="font-size:12px;color:#777;margin-top:10px">セーフハウスに戻ります...</p>`;
    overlayAction='respawn';
    $oBtn.textContent='セーフハウスへ戻る';
    $oBtn.style.display='';
    $overlay.style.display='flex';
    $hud.style.display='none';
    document.getElementById('action-buttons').style.display='none';
    if($nearbyPanel)$nearbyPanel.style.display='none';
    closeInv();
    bindUpgradeBtn();

    clearTimeout(respawnTO);
    respawnTO=setTimeout(()=>{if(state==='respawning')doRespawn();},3000);
  }

  function doRespawn(){
    clearTimeout(respawnTO);
    $overlay.style.display='none';
    $hud.style.display='block';
    document.getElementById('action-buttons').style.display='flex';
    respawnAtSafehouse();
  }

  function respawnAtSafehouse(){
    // Clear any in-flight bullets
    bullets.forEach(b=>scene.remove(b.mesh));
    bullets=[]; lockTarget=null; if(lockMesh)lockMesh.visible=false;

    const ps=gw(1,1);
    player.x=ps.x; player.z=ps.z; player.angle=0;
    player.hp=eff.hpMax(); player.stamina=eff.stMax(); player.exhausted=false;
    player.melee={...MELEE.fists,id:'fists'};
    player.gun=null;
    meleeCD=0; gunCD=0; healCD=0; exhaustedNotified=false;
    player.mesh.position.set(player.x,0,player.z);
    player.mesh.rotation.set(0,0,0);

    // Keep parts, lose everything else
    const keptParts=invCountType('parts');
    invInit();
    if(keptParts>0) invAdd('parts','parts',keptParts,0);

    zombies.forEach(z=>scene.remove(z.mesh));
    zombies=[];
    spawnZombies();

    state='playing';
    updateHUD(true);
    notify(ic('house',14)+' セーフハウスに帰還。アイテムロスト（資材は持越し）');
    saveRun();
  }

})();
