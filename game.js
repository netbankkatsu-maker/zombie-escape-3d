(function () {
  'use strict';

  // ================================================================
  //  CONSTANTS
  // ================================================================
  const CELL = 4, COLS = 15, ROWS = 15, WALL_H = 3.6;
  const PLAYER_R = 0.45, ZOMBIE_R = 0.45;
  const EXIT_R = 1.8, PICKUP_R = 1.1, INTERACT_R = 2.2, SAFE_R = 3.0;
  const CAM_DIST = 7.5, CAM_H = 5.8, CAM_LERP = 0.09;
  const ST_REGEN = 14, ST_SPRINT = 24, ST_THRESH = 18;
  const WALK_SPD = 5.0, SPRINT_SPD = 7.8;

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
    fists: { name:'素手',   dmg:12, cd:0.55, st:0,  range:1.5, arc:Math.PI/2 },
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
  const SAVE_KEY  = 'zombie-escape-run-v2';
  const UPG_KEY   = 'zombie-escape-upgrades-v1';

  let upgrades = { hpUp:0, stUp:0, meleeDmg:0, gunDmg:0, speed:0 };

  const UPG_DEFS = [
    { id:'hpUp',     icon:'❤',  name:'HP強化',      max:3, cost:3, desc:'最大HP +20' },
    { id:'stUp',     icon:'⚡', name:'スタミナ強化', max:3, cost:3, desc:'最大ST +15' },
    { id:'meleeDmg', icon:'⚔',  name:'近接強化',     max:3, cost:5, desc:'近接ダメ +15%' },
    { id:'gunDmg',   icon:'🔫', name:'射撃強化',     max:2, cost:5, desc:'銃ダメ +15%' },
    { id:'speed',    icon:'👟', name:'機動強化',     max:2, cost:4, desc:'速度 +0.5' },
  ];

  function loadUpgrades() {
    try { const r = localStorage.getItem(UPG_KEY); if(r) upgrades = {...upgrades,...JSON.parse(r)}; } catch(_){}
  }
  function saveUpgrades() {
    try { localStorage.setItem(UPG_KEY, JSON.stringify(upgrades)); } catch(_){}
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
  let nearSafehouse = false;

  const player = {
    x:0, z:0, angle:0, mesh:null,
    hp:100, stamina:100, exhausted:false,
    melee:{...MELEE.fists,id:'fists'},
    gun:null, heals:0, parts:0,
  };

  let zombies = [], worldItems = [], containers = [];
  let nearContainer = null, nearWeaponItem = null;
  let meleeCD = 0, gunCD = 0, healCD = 0;
  let overlayAction = 'start';
  let exhaustedNotified = false;

  let cameraAngle = 0; // camera orbit angle (swipe / mouse)

  const keys = {}, prevKeys = {};
  let joy  = {on:false,id:-1,bx:0,by:0,dx:0,dy:0};
  let look = {on:false,id:-1,px:0};

  let $canvas,$hud,$hpFill,$hpNum,$stFill,$stNum;
  let $weaponInfo,$gunInfo,$healCount,$exitHint,$timerNum,$killNum,$partsNum;
  let $overlay,$oTitle,$oBody,$oBtn;
  let $joy,$knob,$flash;
  let $interactPrompt,$pickupNotif,$swapPrompt,$swapText;
  let $upgradeModal;

  // ================================================================
  //  SAVE / LOAD RUN
  // ================================================================
  function saveRun(){
    if(state!=='playing') return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        ver:2, diff:currentDiff, kills:killCount, elapsed:gameElapsed,
        player:{x:player.x,z:player.z,angle:player.angle,
                hp:player.hp,stamina:player.stamina,
                meleeId:player.melee.id,
                gunId:player.gun?player.gun.id:null,
                gunAmmo:player.gun?player.gun.ammo:0,
                heals:player.heals, parts:player.parts},
        grid,
        zombies:zombies.map(z=>({x:z.x,z:z.z,hp:z.hp,maxHp:z.maxHp,angle:z.angle})),
        containers:containers.map(c=>({type:c.type,x:c.x,z:c.z,opened:c.opened})),
        items:worldItems.map(i=>({type:i.type,sub:i.sub,amount:i.amount,ammo:i.ammo,x:i.x,z:i.z})),
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
    $swapPrompt     = document.getElementById('swap-prompt');
    $swapText       = document.getElementById('swap-text');
    $timerNum       = document.getElementById('timer-num');
    $killNum        = document.getElementById('kill-num');
    $partsNum       = document.getElementById('parts-num');
    $upgradeModal   = document.getElementById('upgrade-modal');

    loadUpgrades();
    initRenderer();
    setupInput();

    $oTitle.textContent = '🧟 ZOMBIE ESCAPE';
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
        ['player','./models/zombie/','Characters_Matt.mtl','Characters_Matt.obj',1.75,true],
        ['zombie','./models/zombie/','Zombie_Basic.mtl','Zombie_Basic.obj',1.75,true],
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
    renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(window.innerWidth,window.innerHeight);
    $canvas.appendChild(renderer.domElement);

    scene=new THREE.Scene();
    scene.background=new THREE.Color(0x05050f);
    scene.fog=new THREE.FogExp2(0x05050f,0.032);

    camera=new THREE.PerspectiveCamera(68,window.innerWidth/window.innerHeight,0.1,80);
    clock=new THREE.Clock();

    window.addEventListener('resize',()=>{
      renderer.setSize(window.innerWidth,window.innerHeight);
      camera.aspect=window.innerWidth/window.innerHeight;
      camera.updateProjectionMatrix();
    });
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
    while(scene.children.length) scene.remove(scene.children[0]);
    worldItems=[]; containers=[];
    swingMesh=null;

    scene.add(new THREE.AmbientLight(0x223355,0.75));
    const pl=new THREE.PointLight(0x7799ff,2.8,22); pl.name='pLight'; scene.add(pl);

    const fm=new THREE.Mesh(new THREE.PlaneGeometry(COLS*CELL,ROWS*CELL),new THREE.MeshLambertMaterial({color:0x0e0e1c}));
    fm.rotation.x=-Math.PI/2; fm.position.set(COLS*CELL/2,0,ROWS*CELL/2); scene.add(fm);
    const cm=new THREE.Mesh(new THREE.PlaneGeometry(COLS*CELL,ROWS*CELL),new THREE.MeshLambertMaterial({color:0x050510}));
    cm.rotation.x=Math.PI/2; cm.position.set(COLS*CELL/2,WALL_H,ROWS*CELL/2); scene.add(cm);

    const cells=[];
    for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)if(grid[r][c]===1)cells.push({r,c});
    const iw=new THREE.InstancedMesh(new THREE.BoxGeometry(CELL,WALL_H,CELL),new THREE.MeshLambertMaterial({color:0x2d4a1a}),cells.length);
    const dummy=new THREE.Object3D();
    cells.forEach(({r,c},i)=>{const p=gw(r,c);dummy.position.set(p.x,WALL_H/2,p.z);dummy.updateMatrix();iw.setMatrixAt(i,dummy.matrix);});
    iw.instanceMatrix.needsUpdate=true; scene.add(iw);

    // Exit door
    const ep=gw(ROWS-3,COLS-3); exitPos={x:ep.x,z:ep.z};
    exitMesh=new THREE.Mesh(new THREE.BoxGeometry(CELL*0.7,WALL_H*0.92,0.35),new THREE.MeshLambertMaterial({color:0x00ff55,emissive:0x00aa33}));
    exitMesh.position.set(ep.x,WALL_H/2,ep.z); scene.add(exitMesh);
    const el=new THREE.PointLight(0x00ff55,5,16); el.position.set(ep.x,WALL_H*0.6,ep.z); scene.add(el);
    const ring=new THREE.Mesh(new THREE.RingGeometry(1.2,1.6,32),new THREE.MeshBasicMaterial({color:0x00ff55,side:THREE.DoubleSide,transparent:true,opacity:0.5}));
    ring.rotation.x=-Math.PI/2; ring.position.set(ep.x,0.02,ep.z); ring.name='exitRing'; scene.add(ring);

    // Safehouse marker at spawn
    const sp=gw(1,1);
    const safeCircle=new THREE.Mesh(new THREE.CircleGeometry(2.5,32),new THREE.MeshBasicMaterial({color:0x00aaff,transparent:true,opacity:0.15,side:THREE.DoubleSide,depthWrite:false}));
    safeCircle.rotation.x=-Math.PI/2; safeCircle.position.set(sp.x,0.01,sp.z); safeCircle.name='safeCircle'; scene.add(safeCircle);
    const safeLight=new THREE.PointLight(0x00aaff,1.2,8); safeLight.position.set(sp.x,1.8,sp.z); safeLight.name='safeLight'; scene.add(safeLight);

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
    player.melee={...MELEE.fists,id:'fists'}; player.gun=null; player.heals=0; player.parts=0;
    meleeCD=0; gunCD=0; healCD=0; nearContainer=null; nearWeaponItem=null;
    exhaustedNotified=false; nearSafehouse=false;
    killCount=0; gameStartTime=performance.now(); gameElapsed=0;
    cameraAngle=0;

    let g;
    if(MODELS.player){
      g=cloneModel(MODELS.player);
    } else {
      g=new THREE.Group();
      const legM=new THREE.MeshLambertMaterial({color:0x223366});
      [-0.14,0.14].forEach(ox=>{const l=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.55,0.2),legM);l.position.set(ox,0.275,0);g.add(l);});
      const torso=new THREE.Mesh(new THREE.BoxGeometry(0.52,0.62,0.28),new THREE.MeshLambertMaterial({color:0x3a6abf}));
      torso.position.set(0,0.83,0); g.add(torso);
      const armM=new THREE.MeshLambertMaterial({color:0x3a6abf});
      [-0.38,0.38].forEach(ox=>{const a=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.52,0.18),armM);a.position.set(ox,0.75,0);g.add(a);});
      const head=new THREE.Mesh(new THREE.BoxGeometry(0.44,0.44,0.44),new THREE.MeshLambertMaterial({color:0xffcc99}));
      head.position.set(0,1.38,0); g.add(head);
    }
    player.mesh=g; g.position.set(player.x,0,player.z); scene.add(g);
    camera.position.set(player.x,CAM_H,player.z+CAM_DIST); camera.lookAt(player.x,1,player.z);
  }

  function restorePlayer(data){
    // Restore player state from save (mesh already created by spawnPlayer)
    player.x=data.x; player.z=data.z; player.angle=data.angle;
    player.hp=data.hp; player.stamina=data.stamina;
    player.melee = data.meleeId&&MELEE[data.meleeId]?{...MELEE[data.meleeId],id:data.meleeId}:{...MELEE.fists,id:'fists'};
    player.gun   = data.gunId&&GUNS[data.gunId]?{...GUNS[data.gunId],id:data.gunId,ammo:data.gunAmmo}:null;
    player.heals = data.heals||0;
    player.parts = data.parts||0;
    player.mesh.position.set(player.x,0,player.z);
    player.mesh.rotation.y=player.angle;
  }

  // ================================================================
  //  ZOMBIES
  // ================================================================
  function makeZombieMesh(){
    let g;
    if(MODELS.zombie){
      g=cloneModel(MODELS.zombie);
    } else {
      g=new THREE.Group();
      const sk=0x4a7840;
      const legM=new THREE.MeshLambertMaterial({color:0x1a2a15});
      [-0.13,0.13].forEach(ox=>{const l=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.5,0.2),legM);l.position.set(ox,0.25,0);g.add(l);});
      const body=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.58,0.26),new THREE.MeshLambertMaterial({color:0x22441a}));
      body.position.y=0.79; g.add(body);
      const aM=new THREE.MeshLambertMaterial({color:sk});
      [-1,1].forEach(s=>{const a=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.16,0.55),aM);a.position.set(s*0.38,0.88,-0.27);g.add(a);});
      const head=new THREE.Mesh(new THREE.BoxGeometry(0.44,0.44,0.44),new THREE.MeshLambertMaterial({color:sk}));
      head.position.y=1.29; g.add(head);
      const eM=new THREE.MeshBasicMaterial({color:0xff1100}),eG=new THREE.SphereGeometry(0.065,6,6);
      [-0.12,0.12].forEach(ox=>{const e=new THREE.Mesh(eG,eM);e.position.set(ox,1.34,-0.23);g.add(e);});
    }
    const zl=new THREE.PointLight(0x44ff22,0.6,5); zl.position.y=1.2; g.add(zl);
    return g;
  }

  function spawnZombies(){
    zombies=[];
    for(let i=0;i<D.zCount;i++){
      const cell=openCell(4,4,true); if(!cell)continue;
      const wp=gw(cell.r,cell.c); const mesh=makeZombieMesh();
      mesh.position.set(wp.x,0,wp.z); scene.add(mesh);
      zombies.push({x:wp.x,z:wp.z,angle:Math.random()*Math.PI*2,
                    hp:D.zHp,maxHp:D.zHp,mesh,
                    wTimer:Math.random()*3,wDir:Math.random()*Math.PI*2,
                    lastDmg:0,flashTimer:0,
                    attackAnim:0, // lunge timer
                    baseX:wp.x,baseZ:wp.z}); // for lunge reset
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
  //  ITEMS  (always use fast colored boxes — no model cloning = no freeze)
  // ================================================================
  const ITEM_COLOR = {
    heal_bandage:0xffffff, heal_medkit:0x22cc55,
    ammo:0xffcc00, parts:0xff8800,
    melee_bat:0xcc8833, melee_pipe:0x8899aa, melee_axe:0x778855,
    gun_pistol:0x4488cc, gun_shotgun:0xcc4444,
  };
  const ITEM_GLOW  = {
    heal_bandage:0xffffff, heal_medkit:0x44ff88,
    ammo:0xffdd00, parts:0xff9900,
    melee_bat:0xffcc44, melee_pipe:0xaabbcc, melee_axe:0x99bb77,
    gun_pistol:0x88aaff, gun_shotgun:0xff6688,
  };

  function makeItemMesh(type,sub){
    const g=new THREE.Group();
    const ck = type==='melee'?`melee_${sub}`:type==='heal'?`heal_${sub}`:type==='gun'?`gun_${sub}`:type;
    const col  = ITEM_COLOR[ck]||0xaaaaaa;
    const gcol = ITEM_GLOW[ck]||col;

    if(type==='heal'&&sub==='bandage'){
      const rM=new THREE.MeshLambertMaterial({color:0xff2222,emissive:0xff2222,emissiveIntensity:0.2});
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.08,0.28,0.08),rM));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.28,0.08,0.08),rM));
    } else if(type==='parts'){
      // Gear-like shape: box + rotated box
      const pM=new THREE.MeshLambertMaterial({color:col,emissive:col,emissiveIntensity:0.2});
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.28,0.12,0.28),pM));
      const r2=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.28,0.12),pM); r2.rotation.y=Math.PI/4; g.add(r2);
    } else {
      let w=0.32,h=0.28,d=0.28;
      if(type==='melee'){w=0.1;h=0.58;d=0.1;}
      if(type==='gun')  {w=0.38;h=0.18;d=0.16;}
      if(type==='ammo') {w=0.22;h=0.22;d=0.22;}
      const mat=new THREE.MeshLambertMaterial({color:col,emissive:col,emissiveIntensity:0.18});
      g.add(new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat));
    }
    const gl=new THREE.PointLight(gcol,0.7,3.5); gl.position.y=0.2; g.add(gl);
    return g;
  }

  function createItem(type,sub,amount,ammo,x,z){
    const mesh=makeItemMesh(type,sub); mesh.position.set(x,0.5,z); scene.add(mesh);
    worldItems.push({type,sub,amount:amount||0,ammo:ammo||0,x,z,mesh,collected:false,bob:Math.random()*Math.PI*2});
  }
  function randomMeleeSub(){const r=Math.random();return r<0.5?'bat':r<0.8?'pipe':'axe';}
  function randomAmmo(id){const max=GUNS[id].maxAmmo;return Math.max(1,Math.round(max*(Math.random()<0.05?1:Math.random()*0.85+0.05)));}

  function rollGround(){
    const r=Math.random();
    if(r<0.25)return{type:'heal',sub:'bandage',amount:30};
    if(r<0.38)return{type:'heal',sub:'medkit',amount:55};
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
      if(r<0.22)items.push({type:'heal',sub:'bandage',amount:30});
      else if(r<0.38)items.push({type:'heal',sub:'medkit',amount:55});
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
      containers.push({type,x:wp.x,z:wp.z,mesh,opened:false});
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
  //  START / OVERLAYS
  // ================================================================
  function showStart(){
    state='start'; overlayAction='start';
    $oTitle.textContent='🧟 ZOMBIE ESCAPE';

    // Upgrade summary
    const upgStr = UPG_DEFS.map(u=> upgrades[u.id]>0?`${u.icon}Lv${upgrades[u.id]}`:'').filter(Boolean).join(' ');
    const upgLine = upgStr?`<p style="font-size:11px;color:#88ddff;margin-bottom:8px">強化済み: ${upgStr}</p>`:'';

    // Save data
    const save=hasSave()?loadRunData():null;
    const saveHtml=save?`
      <div style="margin-top:12px;border-top:1px solid rgba(255,255,255,0.12);padding-top:12px">
        <p style="font-size:11px;color:#aaa;margin-bottom:8px">
          📂 セーブあり: ${save.diff||'normal'} &nbsp;🕐 ${fmtTime(save.elapsed||0)} &nbsp;💀 ${save.kills||0}体
        </p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button id="btn-continue-run" class="diff-btn active">📂 続きから</button>
          <button id="btn-delete-run"   class="diff-btn" style="border-color:#aa4444;color:#ff6666">🗑 削除</button>
        </div>
      </div>`:'';

    $oBody.innerHTML=`
      <p style="font-size:12px;opacity:0.7;line-height:1.75;margin-bottom:10px">
        緑の扉を目指せ！箱を漁って武器ゲット<br>
        左タッチ：移動 &nbsp;右スワイプ：視点 &nbsp;[Shift]：走る<br>
        ⚔ATK &nbsp;🔫FIRE &nbsp;💊HEAL &nbsp;📦OPEN &nbsp;🏠UPGRADE</p>
      ${upgLine}
      <p style="font-size:12px;color:#aaa;margin-bottom:8px">難易度：</p>
      <div class="diff-row">
        ${['easy','normal','hard'].map(d=>`<button class="diff-btn${d===currentDiff?' active':''}" data-d="${d}">
          ${d==='easy'?'😊 Easy':d==='normal'?'🧟 Normal':'💀 Hard'}</button>`).join('')}
      </div>
      ${saveHtml}`;

    $oBtn.textContent='NEW GAME';
    $oBtn.style.display='';
    $overlay.style.display='flex'; $hud.style.display='none';
    document.getElementById('action-buttons').style.display='none';

    $overlay.querySelectorAll('.diff-btn[data-d]').forEach(b=>{
      b.addEventListener('click',e=>{e.stopPropagation();currentDiff=b.dataset.d;D=DIFFS[currentDiff];showStart();});
      b.addEventListener('touchend',e=>{e.preventDefault();e.stopPropagation();currentDiff=b.dataset.d;D=DIFFS[currentDiff];showStart();});
    });
    const btnCont=document.getElementById('btn-continue-run');
    if(btnCont){
      btnCont.addEventListener('click',()=>{const d=loadRunData();if(d)loadAndStart(d);});
      btnCont.addEventListener('touchend',e=>{e.preventDefault();const d=loadRunData();if(d)loadAndStart(d);});
    }
    const btnDel=document.getElementById('btn-delete-run');
    if(btnDel){
      btnDel.addEventListener('click',()=>{clearRun();showStart();});
      btnDel.addEventListener('touchend',e=>{e.preventDefault();clearRun();showStart();});
    }
  }

  function enterGame(){
    state='playing';
    $overlay.style.display='none'; $hud.style.display='block';
    document.getElementById('action-buttons').style.display='flex';
    updateHUD();
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
      buildScene(true); // build static geometry, no spawns
      spawnPlayer();
      restorePlayer(data.player);
      restoreZombies(data.zombies||[]);
      restoreContainers(data.containers||[]);
      restoreItems(data.items||[]);
      killCount=data.kills||0;
      gameStartTime=performance.now()-(data.elapsed||0)*1000;
      gameElapsed=data.elapsed||0;
      cameraAngle=data.player.angle||0;
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
    addBtn('btn-swap-yes',()=>confirmSwap(true));
    addBtn('btn-swap-no',()=>confirmSwap(false));
    document.getElementById('btn-upgrade-close')
      .addEventListener('click',()=>closeUpgradeModal());
  }

  function addBtn(id,fn){
    const el=document.getElementById(id); if(!el)return;
    let lt=0;
    el.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();lt=Date.now();fn();});
    el.addEventListener('click',()=>{if(Date.now()-lt>400)fn();});
  }

  function handleOBtn(){
    if(overlayAction==='start') startGame();
    else if(overlayAction==='respawn') { clearTimeout(respawnTO); doRespawn(); }
    else showStart();
  }
  function onMM(e){ if(state!=='playing')return; cameraAngle-=e.movementX*0.0028; }

  function onTS(e){
    if(state!=='playing')return;
    const hw=window.innerWidth/2;
    for(const t of e.changedTouches){
      const el=document.elementFromPoint(t.clientX,t.clientY);
      if(el&&el.closest('#action-buttons,#overlay,#swap-prompt,#upgrade-modal'))continue;
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
    if(state!=='playing')return;
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

    // Swing animation: tilt player mesh forward briefly
    swingTimer=0.22;
    addSwingArc();

    const baseDmg=eff.meleeDmg(player.melee.dmg);
    let hit=false;
    for(let i=zombies.length-1;i>=0;i--){
      const z=zombies[i];
      const d=dist2(player.x,player.z,z.x,z.z);
      if(d>player.melee.range)continue;
      if(Math.abs(angleDiff(Math.atan2(z.x-player.x,z.z-player.z),player.angle))>player.melee.arc/2)continue;
      z.hp-=baseDmg; z.flashTimer=0.18; hit=true;
      if(z.hp<=0)killZombie(i);
    }
    if(hit) setTimeout(()=>SFX.hit(),40);
    updateHUD();
  }

  function addSwingArc(){
    // Remove old arc if any
    if(swingMesh){scene.remove(swingMesh);swingMesh=null;}
    const mat=new THREE.MeshBasicMaterial({color:0xffdd66,transparent:true,opacity:0.5,side:THREE.DoubleSide,depthWrite:false});
    const geo=new THREE.CircleGeometry(player.melee.range,8,Math.PI/2-player.melee.arc/2,player.melee.arc);
    swingMesh=new THREE.Mesh(geo,mat);
    swingMesh.rotation.x=-Math.PI/2;
    swingMesh.position.y=0.05;
    scene.add(swingMesh);
  }

  function doShoot(){
    if(state!=='playing')return;
    if(!player.gun||gunCD>0)return;
    if(player.gun.ammo<=0){notify('弾切れ！');SFX.empty();return;}
    player.gun.ammo--; gunCD=GUNS[player.gun.id].fireCd;
    (player.gun.id==='shotgun'?SFX.shotgun:SFX.shoot)();

    // Brief backward tilt (recoil)
    swingTimer=0.14;

    const origin=new THREE.Vector3(player.x,1.2,player.z);
    // Shoot toward camera-facing direction so aiming matches the view
    const fwd=new THREE.Vector3(-Math.sin(cameraAngle),0,-Math.cos(cameraAngle)).normalize();
    const baseDmg=eff.gunDmg(GUNS[player.gun.id].dmg);
    const range=GUNS[player.gun.id].range;
    const rays=[new THREE.Raycaster(origin,fwd,0,range)];
    if(GUNS[player.gun.id].spread){
      [-1,1].forEach(s=>{const d=fwd.clone();d.x+=s*0.1;d.z+=s*0.05;d.normalize();rays.push(new THREE.Raycaster(origin,d,0,range));});
    }
    const hitSet=new Set();
    for(const ray of rays){
      const tgts=[]; zombies.forEach(z=>z.mesh.traverse(c=>{if(c.isMesh)tgts.push(c);}));
      const hits=ray.intersectObjects(tgts);
      if(hits.length){
        const obj=hits[0].object;
        const hz=zombies.find(z=>{let f=false;z.mesh.traverse(c=>{if(c===obj)f=true;});return f;});
        if(hz&&!hitSet.has(hz))hitSet.add(hz);
      }
    }
    hitSet.forEach(z=>{
      z.hp-=baseDmg; z.flashTimer=0.22;
      const idx=zombies.indexOf(z); if(z.hp<=0&&idx!==-1)killZombie(idx);
    });
    updateHUD();
  }

  function doHeal(){
    if(state!=='playing')return;
    if(player.heals<=0||healCD>0)return;
    if(player.hp>=eff.hpMax()){notify('HPは満タン！');return;}
    player.heals--; healCD=1.5;
    player.hp=Math.min(eff.hpMax(),player.hp+40);
    SFX.heal(); notify('💊 HP +40 回復'); updateHUD();
  }

  function killZombie(idx){
    scene.remove(zombies[idx].mesh); zombies.splice(idx,1);
    killCount++;
    SFX.die();
    if(zombies.length>0&&Math.random()<0.4) setTimeout(()=>SFX.zombie(),200+Math.random()*300);
    notify(zombies.length===0?'🎉 全ゾンビ撃破！出口を目指せ！':`ゾンビを倒した！(${killCount}体)`);
  }

  // ================================================================
  //  INTERACT / PICKUP
  // ================================================================
  function doInteract(){
    if(state!=='playing')return;
    if(nearContainer&&!nearContainer.opened) openContainer(nearContainer);
  }

  function openContainer(c){
    c.opened=true;
    c.mesh.traverse(ch=>{
      if(ch.isMesh&&ch.material&&!ch.material.wireframe)ch.material.color.multiplyScalar(0.4);
    });
    SFX.open();
    const loot=rollCrate(c.type);
    loot.forEach(itm=>{
      const ox=(Math.random()-0.5)*CELL*0.55,oz=(Math.random()-0.5)*CELL*0.55;
      createItem(itm.type,itm.sub,itm.amount||0,itm.ammo||0,c.x+ox,c.z+oz);
    });
    notify(loot.length>0?`📦 ${c.type==='locker'?'ロッカー':'箱'}を開けた！(${loot.length}個)`:`📦 空だった…`);
    nearContainer=null; $interactPrompt.style.display='none';
  }

  function pickupItem(item){
    item.collected=true; scene.remove(item.mesh);
    switch(item.type){
      case 'heal':
        player.heals++; SFX.pickup(); notify(`💊 回復アイテム入手！(×${player.heals})`); break;
      case 'parts':
        player.parts+=item.amount; SFX.pickup(); notify(`🔧 資材 +${item.amount}（計${player.parts}個）`); break;
      case 'ammo':
        if(player.gun){
          const max=GUNS[player.gun.id].maxAmmo;
          player.gun.ammo=Math.min(max,player.gun.ammo+item.amount);
          SFX.pickup(); notify(`🔫 弾薬 +${item.amount}（残弾:${player.gun.ammo}）`);
        } else { SFX.pickup(); notify(`弾薬を拾った（銃がない）`); }
        break;
      case 'melee':{
        const def=MELEE[item.sub];
        if(player.melee.id==='fists'||def.dmg>player.melee.dmg){
          player.melee={...def,id:item.sub}; SFX.pickup(); notify(`⚔ ${def.name}を装備！`);
        } else { showSwapPrompt(item); return; }
        break;
      }
      case 'gun':
        if(!player.gun){
          player.gun={...GUNS[item.sub],id:item.sub,ammo:item.ammo};
          SFX.pickup(); notify(`🔫 ${GUNS[item.sub].name}入手！(弾${item.ammo}発)`);
        } else { showSwapPrompt(item); return; }
        break;
    }
    updateHUD();
  }

  function showSwapPrompt(item){
    nearWeaponItem=item;
    const def=item.type==='gun'?GUNS[item.sub]:MELEE[item.sub];
    const cur=item.type==='gun'?(player.gun?GUNS[player.gun.id].name:'なし'):player.melee.name;
    const ammoStr=item.type==='gun'?` (弾${item.ammo}発)`:'';
    $swapText.textContent=`${def.name}${ammoStr} と交換？\n現在: ${cur}`;
    $swapPrompt.style.display='flex';
  }
  function confirmSwap(yes){
    $swapPrompt.style.display='none';
    if(!nearWeaponItem||!yes){nearWeaponItem=null;return;}
    const item=nearWeaponItem; nearWeaponItem=null;
    item.collected=true; scene.remove(item.mesh);
    SFX.pickup();
    if(item.type==='gun'){
      player.gun={...GUNS[item.sub],id:item.sub,ammo:item.ammo};
      notify(`🔫 ${GUNS[item.sub].name}に交換！`);
    } else {
      player.melee={...MELEE[item.sub],id:item.sub};
      notify(`⚔ ${MELEE[item.sub].name}に交換！`);
    }
    updateHUD();
  }

  // ================================================================
  //  SAFEHOUSE UPGRADES
  // ================================================================
  function upgradeButtonHtml(){
    return `<div style="margin-top:14px">
      <button id="btn-open-upgrade" style="
        padding:10px 28px;border:2px solid rgba(0,180,255,0.6);border-radius:30px;
        background:rgba(0,60,120,0.6);color:#88ddff;font-size:14px;font-weight:bold;
        cursor:pointer;-webkit-tap-highlight-color:transparent;">
        🏠 セーフハウス アップグレード (🔧 ${player.parts})
      </button></div>`;
  }

  function bindUpgradeBtn(){
    // Called after overlay innerHTML is set (re-bind each time)
    const btn=document.getElementById('btn-open-upgrade');
    if(!btn)return;
    btn.addEventListener('click',()=>showUpgradeModal());
    btn.addEventListener('touchend',e=>{e.preventDefault();showUpgradeModal();});
  }

  function showUpgradeModal(){
    // Only accessible from death/win overlays (not during gameplay)
    if(state==='playing') return;
    renderUpgradeModal();
    $upgradeModal.style.display='flex';
  }
  function closeUpgradeModal(){
    $upgradeModal.style.display='none';
  }

  function renderUpgradeModal(){
    const list = document.getElementById('upgrade-list');
    list.innerHTML = '';
    UPG_DEFS.forEach(u=>{
      const lv=upgrades[u.id]||0;
      const maxed=lv>=u.max;
      const canBuy=!maxed&&player.parts>=u.cost;
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
          ${maxed?'MAX':'🔧 '+u.cost+'個'}
        </button>`;
      list.appendChild(div);
    });
    document.getElementById('upgrade-parts').textContent=player.parts;
    list.querySelectorAll('.upg-btn:not(.disabled):not([data-id=""])').forEach(btn=>{
      const id=btn.dataset.id;
      const u=UPG_DEFS.find(x=>x.id===id);
      if(!u||(upgrades[id]||0)>=u.max||player.parts<u.cost)return;
      btn.addEventListener('click',()=>buyUpgrade(id));
      btn.addEventListener('touchend',e=>{e.preventDefault();buyUpgrade(id);});
    });
  }

  function buyUpgrade(id){
    const u=UPG_DEFS.find(x=>x.id===id);
    if(!u) return;
    if((upgrades[id]||0)>=u.max){notify('最大レベルです！');return;}
    if(player.parts<u.cost){notify('資材が足りない！');return;}
    player.parts-=u.cost;
    upgrades[id]=(upgrades[id]||0)+1;
    saveUpgrades();
    SFX.upgrade();
    notify(`🏠 ${u.name} Lv${upgrades[id]}にアップグレード！`);
    // Apply HP/ST increase immediately
    if(id==='hpUp')   player.hp=Math.min(eff.hpMax(),player.hp+20);
    if(id==='stUp')   player.stamina=Math.min(eff.stMax(),player.stamina+15);
    renderUpgradeModal();
    updateHUD();
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
        const prog=swingTimer/0.22;
        swingMesh.material.opacity=0.5*prog;
        const sinA=Math.sin(player.angle),cosA=Math.cos(player.angle);
        swingMesh.position.set(player.x-sinA*0.5,0.05,player.z-cosA*0.5);
        swingMesh.rotation.y=-player.angle;
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

    // Move input
    let fwd=0,str=0;
    if(keys['KeyW']||keys['ArrowUp'])   fwd+=1;
    if(keys['KeyS']||keys['ArrowDown']) fwd-=1;
    if(keys['KeyA'])str-=1; if(keys['KeyD'])str+=1;
    // Arrow left/right rotate camera
    if(keys['ArrowLeft']) cameraAngle+=1.9*dt;
    if(keys['ArrowRight'])cameraAngle-=1.9*dt;
    if(joy.on){fwd+=-joy.dy; str+=joy.dx;}
    if(keys['Space']&&!prevKeys['Space'])doMelee();
    if(keys['KeyF']&&!prevKeys['KeyF'])doShoot();
    if(keys['KeyR']&&!prevKeys['KeyR'])doHeal();
    if(keys['KeyE']&&!prevKeys['KeyE'])doInteract();
    for(const k in keys)prevKeys[k]=keys[k];

    if(fwd!==0||str!==0){
      // World-space movement direction based on camera angle
      const len=Math.sqrt(fwd*fwd+str*str)||1, nf=fwd/len, ns=str/len;
      const sinC=Math.sin(cameraAngle), cosC=Math.cos(cameraAngle);
      const wx=-sinC*nf+cosC*ns;   // world X
      const wz=-cosC*nf-sinC*ns;   // world Z

      // Rotate character to face movement direction (smooth)
      const targetAngle=Math.atan2(-wx,-wz);
      const diff=angleDiff(targetAngle,player.angle);
      player.angle+=Math.sign(diff)*Math.min(Math.abs(diff),12*dt);

      const spd=(sprinting&&!player.exhausted)?eff.sprintSpd():eff.walkSpd();
      tryMove(player,wx*spd*dt,wz*spd*dt,PLAYER_R);
    }

    // Player mesh tilt on swing
    const tiltX = swingTimer>0 ? Math.sin(swingTimer*Math.PI/0.22)*0.35 : 0;
    player.mesh.position.set(player.x,0,player.z);
    player.mesh.rotation.set(tiltX,player.angle,0,'YXZ');

    const pl=scene.getObjectByName('pLight'); if(pl)pl.position.set(player.x,2.2,player.z);

    // Camera follows behind player based on cameraAngle (independent of player facing)
    const sinC=Math.sin(cameraAngle), cosC=Math.cos(cameraAngle);
    camera.position.x+=(player.x+sinC*CAM_DIST-camera.position.x)*CAM_LERP;
    camera.position.y+=(CAM_H-camera.position.y)*CAM_LERP;
    camera.position.z+=(player.z+cosC*CAM_DIST-camera.position.z)*CAM_LERP;
    camera.lookAt(player.x,1.1,player.z);

    // Exit
    if(dist2(player.x,player.z,exitPos.x,exitPos.z)<EXIT_R){winGame();return;}
    if(exitMesh)exitMesh.rotation.y=t*1.1;
    const ring=scene.getObjectByName('exitRing'); if(ring)ring.material.opacity=0.3+0.25*Math.sin(t*2.5);

    // Safehouse visual pulse (decorative only during gameplay)
    const sl=scene.getObjectByName('safeLight');
    if(sl)sl.intensity=1.0+0.3*Math.sin(t*2);
    const sc=scene.getObjectByName('safeCircle');
    if(sc)sc.material.opacity=0.12+0.04*Math.sin(t*2);

    // Items bob + pickup
    worldItems=worldItems.filter(it=>!it.collected);
    for(const it of worldItems){
      it.mesh.position.y=0.45+Math.sin(t*2+it.bob)*0.1;
      it.mesh.rotation.y=t*0.9+it.bob;
      if(dist2(player.x,player.z,it.x,it.z)<PICKUP_R){
        if((it.type==='melee'||it.type==='gun')&&nearWeaponItem)continue;
        pickupItem(it);
      }
    }

    // Containers
    nearContainer=null;
    for(const c of containers){
      if(!c.opened&&dist2(player.x,player.z,c.x,c.z)<INTERACT_R){nearContainer=c;break;}
    }
    $interactPrompt.style.display=nearContainer?'block':'none';
    document.getElementById('btn-interact').style.display=nearContainer?'flex':'none';

    // Zombies
    for(let i=zombies.length-1;i>=0;i--){
      const z=zombies[i];

      // Hit flash
      if(z.flashTimer>0){
        z.flashTimer-=dt;
        z.mesh.traverse(c=>{
          if(c.isMesh&&c.material&&c.material.emissive){
            c.material.emissive.setHex(z.flashTimer>0?0xff0000:0x000000);
            c.material.emissiveIntensity=z.flashTimer>0?0.8:0;
          }
        });
      }

      const dx=player.x-z.x,dz=player.z-z.z,d=Math.sqrt(dx*dx+dz*dz)||0.001;
      if(d<D.zDet){
        const spd=d<5?D.zRun:D.zSpd;
        tryMove(z,(dx/d)*spd*dt,(dz/d)*spd*dt,ZOMBIE_R);
        z.angle=Math.atan2(dx,dz);
      } else {
        z.wTimer-=dt;
        if(z.wTimer<=0){z.wDir=Math.random()*Math.PI*2;z.wTimer=1.5+Math.random()*2.5;}
        tryMove(z,Math.sin(z.wDir)*D.zSpd*0.38*dt,Math.cos(z.wDir)*D.zSpd*0.38*dt,ZOMBIE_R);
        z.angle=z.wDir;
      }

      // Attack animation: lunge forward when close
      if(z.attackAnim>0){
        z.attackAnim-=dt;
        const lungeAmt=Math.sin(z.attackAnim/0.25*Math.PI)*0.45;
        const ax=Math.sin(z.angle),az=Math.cos(z.angle);
        z.mesh.position.set(z.x+ax*lungeAmt,0,z.z+az*lungeAmt);
      } else {
        z.mesh.position.set(z.x,0,z.z);
      }
      z.mesh.rotation.y=z.angle;

      // Deal damage + trigger lunge
      if(d<1.15){
        player.hp-=D.zDmg*dt;
        if(now-z.lastDmg>450){
          z.lastDmg=now;
          z.attackAnim=0.25; // lunge duration
          flashDamage(); SFX.hit();
          if(Math.random()<0.5)SFX.zombie();
        }
      }
    }

    player.hp=Math.max(0,player.hp);
    updateHUD();

    // Auto-save
    saveTimer-=dt;
    if(saveTimer<=0){saveTimer=5;saveRun();}

    if(player.hp<=0)gameOver();
  }

  // ================================================================
  //  HUD
  // ================================================================
  function fmtTime(s){const m=Math.floor(s/60),sec=Math.floor(s%60);return`${m}:${String(sec).padStart(2,'0')}`;}

  function updateHUD(){
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

    $weaponInfo.textContent=`⚔ ${player.melee.name}`;
    if(player.gun){
      const g=GUNS[player.gun.id];
      $gunInfo.textContent=`🔫 ${g.name} ${player.gun.ammo}/${g.maxAmmo}`;
      $gunInfo.style.color=player.gun.ammo>0?'#ffdd88':'#ff4444'; $gunInfo.className='';
    } else { $gunInfo.textContent='🔫 なし'; $gunInfo.style.color=''; $gunInfo.className='dim'; }

    $healCount.textContent=`💊 ×${player.heals}`;
    $healCount.className=player.heals>0?'':'dim';

    if($partsNum){$partsNum.textContent=player.parts; document.getElementById('parts-row').style.display=player.parts>0?'inline':'none';}

    const d=dist2(player.x,player.z,exitPos.x,exitPos.z);
    $exitHint.textContent=d<20?'🟢 出口が近い！':`🟢 出口まで約${Math.round(d)}m`;

    document.getElementById('btn-attack').style.opacity=player.exhausted?'0.4':'1';
    document.getElementById('btn-fire').style.opacity=(player.gun&&player.gun.ammo>0)?'1':'0.35';
    document.getElementById('btn-heal').style.opacity=player.heals>0?'1':'0.35';

    if($timerNum)$timerNum.textContent=fmtTime(gameElapsed);
    if($killNum) $killNum.textContent=killCount;
  }

  let fTO=null;
  function flashDamage(){$flash.style.opacity='1';clearTimeout(fTO);fTO=setTimeout(()=>$flash.style.opacity='0',350);}

  // Notification log (bottom-left, subtle)
  const notifQueue=[];
  let notifTO=null;
  function notify(txt){
    $pickupNotif.textContent=txt;
    $pickupNotif.style.opacity='1';
    $pickupNotif.classList.add('show');
    clearTimeout(notifTO);
    notifTO=setTimeout(()=>{$pickupNotif.style.opacity='0';$pickupNotif.classList.remove('show');},2000);
  }

  // ================================================================
  //  WIN / GAMEOVER / RESPAWN
  // ================================================================
  function winGame(){
    state='win'; SFX.win(); clearRun();
    showResult('🎉 脱出成功！',`
      ゾンビから逃げ切った！<br>
      <span style="font-size:13px;color:#aaa">
        🕐 <b style="color:#fff">${fmtTime(gameElapsed)}</b> &ensp;
        💀 <b style="color:#fff">${killCount}体</b> &ensp;
        ❤ <b style="color:#ff4">${Math.ceil(player.hp)}</b>
      </span>
      ${upgradeButtonHtml()}`);
  }

  function gameOver(){
    if(state!=='playing')return;
    state='respawning'; SFX.gameover();
    saveRun(); // Save the state (player will be at safehouse on next load)

    $oTitle.textContent='💀 やられた...';
    $oBody.innerHTML=`
      <p style="color:#ff4444;font-size:15px;font-weight:bold">全アイテムロスト</p>
      <p style="font-size:13px;color:#aaa;margin-top:10px">
        🕐 ${fmtTime(gameElapsed)} &nbsp;💀 ${killCount}体撃破
      </p>
      ${upgradeButtonHtml()}
      <p style="font-size:12px;color:#777;margin-top:10px">セーフハウスに戻ります...</p>`;
    overlayAction='respawn';
    $oBtn.textContent='セーフハウスへ戻る';
    $oBtn.style.display='';
    $overlay.style.display='flex';
    $hud.style.display='none';
    document.getElementById('action-buttons').style.display='none';
    bindUpgradeBtn();

    // Auto-respawn after 3s
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
    // Reset player to safehouse, lose all items
    const ps=gw(1,1);
    player.x=ps.x; player.z=ps.z; player.angle=0;
    player.hp=eff.hpMax(); player.stamina=eff.stMax(); player.exhausted=false;
    player.melee={...MELEE.fists,id:'fists'};
    player.gun=null; player.heals=0;
    // Keep parts! (they were earned this run and stored upgrades are saved)
    meleeCD=0; gunCD=0; healCD=0; exhaustedNotified=false;
    player.mesh.position.set(player.x,0,player.z);
    player.mesh.rotation.set(0,0,0);

    // Respawn all zombies at new random positions
    zombies.forEach(z=>scene.remove(z.mesh));
    zombies=[];
    spawnZombies();

    state='playing';
    updateHUD();
    notify('🏠 セーフハウスに帰還。全アイテムロスト');
    saveRun();
  }

})();
