(function () {
  'use strict';

  // ================================================================
  //  CONSTANTS
  // ================================================================
  const CELL = 4, COLS = 15, ROWS = 15, WALL_H = 3.6;
  const PLAYER_R = 0.45, ZOMBIE_R = 0.45;
  const EXIT_R = 1.8, PICKUP_R = 1.1, INTERACT_R = 2.2;
  const HP_MAX = 100, ST_MAX = 100;
  const ST_REGEN = 14, ST_SPRINT = 24, ST_THRESH = 18;
  const WALK_SPD = 5.0, SPRINT_SPD = 7.8;
  const CAM_DIST = 7.5, CAM_H = 5.8, CAM_LERP = 0.09;

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
    pistol:  { name:'ピストル',      maxAmmo:15, dmg:55, fireCd:0.25, range:28 },
    shotgun: { name:'ショットガン',  maxAmmo:6,  dmg:80, fireCd:0.85, range:16, spread:true },
  };

  // ================================================================
  //  STATE
  // ================================================================
  let renderer, scene, camera, clock;
  let state = 'start';
  let grid = [];
  let exitPos = { x:0, z:0 }, exitMesh = null;

  const player = {
    x:0, z:0, angle:0, mesh:null,
    hp:HP_MAX, stamina:ST_MAX, exhausted:false,
    melee:{ ...MELEE.fists, id:'fists' },
    gun:null, heals:0,
  };

  let zombies = [], worldItems = [], containers = [];
  let nearContainer = null, nearWeaponItem = null;
  let meleeCD = 0, gunCD = 0, healCD = 0;
  let overlayAction = 'start'; // 'start' | 'menu'

  const keys = {}, prevKeys = {};
  let joy  = { on:false, id:-1, bx:0, by:0, dx:0, dy:0 };
  let look = { on:false, id:-1, px:0 };

  // DOM refs
  let $canvas,$hud,$hpFill,$hpNum,$stFill,$stNum;
  let $weaponInfo,$gunInfo,$healCount,$exitHint;
  let $overlay,$oTitle,$oBody,$oBtn;
  let $joy,$knob,$flash,$muzzle;
  let $interactPrompt,$pickupNotif,$swapPrompt,$swapText;

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
    $muzzle   = document.getElementById('muzzle-flash');
    $interactPrompt = document.getElementById('interact-prompt');
    $pickupNotif    = document.getElementById('pickup-notif');
    $swapPrompt     = document.getElementById('swap-prompt');
    $swapText       = document.getElementById('swap-text');

    initRenderer();
    setupInput();
    showStart();
    animate();

    if ('serviceWorker' in navigator)
      navigator.serviceWorker.register('./sw.js').catch(() => {});
  });

  // ================================================================
  //  RENDERER
  // ================================================================
  function initRenderer() {
    renderer = new THREE.WebGLRenderer({ antialias:false, powerPreference:'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    $canvas.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05050f);
    scene.fog = new THREE.FogExp2(0x05050f, 0.032);

    camera = new THREE.PerspectiveCamera(68, window.innerWidth/window.innerHeight, 0.1, 80);
    clock  = new THREE.Clock();

    window.addEventListener('resize', () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth/window.innerHeight;
      camera.updateProjectionMatrix();
    });
  }

  // ================================================================
  //  MAP
  // ================================================================
  function buildGrid() {
    grid = [];
    for (let r=0;r<ROWS;r++) {
      grid[r]=[];
      for (let c=0;c<COLS;c++)
        grid[r][c]=(r===0||r===ROWS-1||c===0||c===COLS-1)?1:(Math.random()<0.27?1:0);
    }
    carve(1,1,3,3); carve(ROWS-4,COLS-4,ROWS-2,COLS-2);
    const mid=Math.floor(ROWS/2);
    for (let c=1;c<COLS-1;c++) grid[mid][c]=0;
    for (let r=1;r<=mid;r++) grid[r][1]=0;
    for (let r=mid;r<ROWS-1;r++) grid[r][COLS-2]=0;
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
    do{r=minR+Math.floor(Math.random()*(ROWS-minR-2));c=minC+Math.floor(Math.random()*(COLS-minC-2));att++;}
    while((grid[r][c]===1||(avoidStart&&r<5&&c<5))&&att<200);
    return att<200?{r,c}:null;
  }

  // ================================================================
  //  SCENE
  // ================================================================
  function buildScene() {
    while(scene.children.length) scene.remove(scene.children[0]);
    worldItems=[]; containers=[];

    scene.add(new THREE.AmbientLight(0x223355,0.75));
    const pl=new THREE.PointLight(0x7799ff,2.8,22); pl.name='pLight'; scene.add(pl);

    // Floor
    const fm=new THREE.Mesh(new THREE.PlaneGeometry(COLS*CELL,ROWS*CELL),new THREE.MeshLambertMaterial({color:0x0e0e1c}));
    fm.rotation.x=-Math.PI/2; fm.position.set(COLS*CELL/2,0,ROWS*CELL/2); scene.add(fm);
    // Ceiling
    const cm=new THREE.Mesh(new THREE.PlaneGeometry(COLS*CELL,ROWS*CELL),new THREE.MeshLambertMaterial({color:0x050510}));
    cm.rotation.x=Math.PI/2; cm.position.set(COLS*CELL/2,WALL_H,ROWS*CELL/2); scene.add(cm);

    // Walls instanced
    const cells=[];
    for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)if(grid[r][c]===1)cells.push({r,c});
    const iw=new THREE.InstancedMesh(new THREE.BoxGeometry(CELL,WALL_H,CELL),new THREE.MeshLambertMaterial({color:0x2d4a1a}),cells.length);
    const dummy=new THREE.Object3D();
    cells.forEach(({r,c},i)=>{const p=gw(r,c);dummy.position.set(p.x,WALL_H/2,p.z);dummy.updateMatrix();iw.setMatrixAt(i,dummy.matrix);});
    iw.instanceMatrix.needsUpdate=true; scene.add(iw);

    // Exit
    const ep=gw(ROWS-3,COLS-3); exitPos={x:ep.x,z:ep.z};
    exitMesh=new THREE.Mesh(new THREE.BoxGeometry(CELL*0.7,WALL_H*0.92,0.35),new THREE.MeshLambertMaterial({color:0x00ff55,emissive:0x00aa33}));
    exitMesh.position.set(ep.x,WALL_H/2,ep.z); scene.add(exitMesh);
    const el=new THREE.PointLight(0x00ff55,5,16); el.position.set(ep.x,WALL_H*0.6,ep.z); scene.add(el);
    const ring=new THREE.Mesh(new THREE.RingGeometry(1.2,1.6,32),new THREE.MeshBasicMaterial({color:0x00ff55,side:THREE.DoubleSide,transparent:true,opacity:0.5}));
    ring.rotation.x=-Math.PI/2; ring.position.set(ep.x,0.02,ep.z); ring.name='exitRing'; scene.add(ring);

    spawnPlayer(); spawnZombies(); spawnContainers(); spawnGroundItems();
  }

  // ================================================================
  //  PLAYER MESH
  // ================================================================
  function spawnPlayer() {
    const ps=gw(1,1); player.x=ps.x; player.z=ps.z; player.angle=0;
    player.hp=HP_MAX; player.stamina=ST_MAX; player.exhausted=false;
    player.melee={...MELEE.fists,id:'fists'}; player.gun=null; player.heals=0;
    meleeCD=0; gunCD=0; healCD=0; nearContainer=null; nearWeaponItem=null;

    const g=new THREE.Group();
    const legM=new THREE.MeshLambertMaterial({color:0x223366});
    [-0.14,0.14].forEach(ox=>{const l=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.55,0.2),legM);l.position.set(ox,0.275,0);g.add(l);});
    g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.52,0.62,0.28),new THREE.MeshLambertMaterial({color:0x3a6abf})),{position:new THREE.Vector3(0,0.83,0)}));
    const armM=new THREE.MeshLambertMaterial({color:0x3a6abf});
    [-0.38,0.38].forEach(ox=>{const a=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.52,0.18),armM);a.position.set(ox,0.75,0);g.add(a);});
    g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.44,0.44,0.44),new THREE.MeshLambertMaterial({color:0xffcc99})),{position:new THREE.Vector3(0,1.38,0)}));
    player.mesh=g; g.position.set(player.x,0,player.z); scene.add(g);
    camera.position.set(player.x,CAM_H,player.z+CAM_DIST); camera.lookAt(player.x,1,player.z);
  }

  // ================================================================
  //  ZOMBIE MESH
  // ================================================================
  function makeZombieMesh() {
    const g=new THREE.Group(), sk=0x4a7840;
    const legM=new THREE.MeshLambertMaterial({color:0x1a2a15});
    [-0.13,0.13].forEach(ox=>{const l=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.5,0.2),legM);l.position.set(ox,0.25,0);g.add(l);});
    const body=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.58,0.26),new THREE.MeshLambertMaterial({color:0x22441a}));
    body.position.y=0.79; g.add(body);
    const aM=new THREE.MeshLambertMaterial({color:sk});
    [-1,1].forEach(s=>{const a=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.16,0.55),aM);a.position.set(s*0.38,0.88,-0.27);g.add(a);});
    const head=new THREE.Mesh(new THREE.BoxGeometry(0.44,0.44,0.44),new THREE.MeshLambertMaterial({color:sk}));
    head.position.y=1.29; head.name='zhead'; g.add(head);
    const eM=new THREE.MeshBasicMaterial({color:0xff1100}),eG=new THREE.SphereGeometry(0.065,6,6);
    [-0.12,0.12].forEach(ox=>{const e=new THREE.Mesh(eG,eM);e.position.set(ox,1.34,-0.23);g.add(e);});
    const zl=new THREE.PointLight(0x44ff22,0.6,5); zl.position.y=1.2; g.add(zl);
    return g;
  }
  function spawnZombies() {
    zombies=[];
    for(let i=0;i<D.zCount;i++){
      const cell=openCell(4,4,true); if(!cell)continue;
      const wp=gw(cell.r,cell.c); const mesh=makeZombieMesh();
      mesh.position.set(wp.x,0,wp.z); scene.add(mesh);
      zombies.push({x:wp.x,z:wp.z,angle:Math.random()*Math.PI*2,hp:D.zHp,maxHp:D.zHp,mesh,wTimer:Math.random()*3,wDir:Math.random()*Math.PI*2,lastDmg:0,flashTimer:0});
    }
  }

  // ================================================================
  //  ITEMS
  // ================================================================
  function makeItemMesh(type,sub){
    const g=new THREE.Group();
    const COLS_MAP={heal_bandage:0xffffff,heal_medkit:0x22cc55,ammo:0xffcc00,melee_bat:0xcc8833,melee_pipe:0x8899aa,melee_axe:0x778855,gun:0x445566};
    let color=COLS_MAP[type==='melee'?`melee_${sub}`:type==='heal'?`heal_${sub}`:type==='gun'?'gun':type]||0xaaaaaa;
    let w=0.32,h=0.28,d=0.28;
    if(type==='melee'){w=0.12;h=0.62;d=0.12;}
    if(type==='gun'){w=0.42;h=0.2;d=0.18;}
    // Cross on bandage
    if(type==='heal'&&sub==='bandage'){
      const rM=new THREE.MeshLambertMaterial({color:0xff2222});
      g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.08,0.28,0.08),rM),{}));
      g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.28,0.08,0.08),rM),{}));
    }
    const box=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshLambertMaterial({color,emissive:color,emissiveIntensity:0.15}));
    g.add(box);
    const gl=new THREE.PointLight(color,0.65,3.5); gl.position.y=0.2; g.add(gl);
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
    if(r<0.32)return{type:'heal',sub:'bandage',amount:30};
    if(r<0.48)return{type:'heal',sub:'medkit',amount:55};
    if(r<0.63)return{type:'ammo',sub:'pistol_ammo',amount:5+Math.floor(Math.random()*10)};
    if(r<0.70)return{type:'ammo',sub:'shotgun_ammo',amount:1+Math.floor(Math.random()*3)};
    if(r<0.82)return{type:'melee',sub:randomMeleeSub()};
    return{type:'gun',sub:'pistol',ammo:randomAmmo('pistol')};
  }
  function rollCrate(type){
    const slots=type==='locker'?2+Math.floor(Math.random()*2):1+Math.floor(Math.random()*2);
    const items=[];
    for(let i=0;i<slots;i++){
      if(Math.random()<0.15)continue;
      const r=Math.random();
      if(r<0.28)items.push({type:'heal',sub:'bandage',amount:30});
      else if(r<0.44)items.push({type:'heal',sub:'medkit',amount:55});
      else if(r<0.58)items.push({type:'ammo',sub:'pistol_ammo',amount:5+Math.floor(Math.random()*12)});
      else if(r<0.65)items.push({type:'ammo',sub:'shotgun_ammo',amount:1+Math.floor(Math.random()*4)});
      else if(r<0.79)items.push({type:'melee',sub:randomMeleeSub()});
      else if(r<0.91)items.push({type:'gun',sub:'pistol',ammo:randomAmmo('pistol')});
      else items.push({type:'gun',sub:'shotgun',ammo:randomAmmo('shotgun')});
    }
    return items;
  }
  function spawnGroundItems(){
    for(let i=0;i<D.items;i++){
      const cell=openCell(2,2,true); if(!cell)continue;
      const wp=gw(cell.r,cell.c),ox=(Math.random()-0.5)*CELL*0.5,oz=(Math.random()-0.5)*CELL*0.5;
      const itm=rollGround(); createItem(itm.type,itm.sub,itm.amount,itm.ammo,wp.x+ox,wp.z+oz);
    }
  }

  // ================================================================
  //  CONTAINERS
  // ================================================================
  function makeContainerMesh(type){
    const g=new THREE.Group(), isL=type==='locker';
    const w=isL?CELL*0.5:CELL*0.6, h=isL?WALL_H*0.75:WALL_H*0.3, dep=isL?CELL*0.35:CELL*0.5;
    const col=isL?0x667788:0x886633;
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

  // ================================================================
  //  START / OVERLAYS
  // ================================================================
  function showStart(){
    state='start'; overlayAction='start';
    $oTitle.textContent='🧟 ZOMBIE ESCAPE';
    $oBody.innerHTML=`
      <p style="font-size:12px;opacity:0.7;line-height:1.75;margin-bottom:14px">緑の扉を目指せ！箱・ロッカーを漁って武器をゲット<br>
      左タッチ：移動 &nbsp;右スワイプ：視点 &nbsp;[Shift]：走る<br>
      ⚔ATK：近接 &nbsp; 🔫FIRE：銃 &nbsp; 💊HEAL：回復 &nbsp; 📦OPEN：漁る</p>
      <p style="font-size:13px;color:#aaa;margin-bottom:10px">難易度：</p>
      <div class="diff-row">
        ${['easy','normal','hard'].map(d=>`<button class="diff-btn${d===currentDiff?' active':''}" data-d="${d}">
          ${d==='easy'?'😊 イージー':d==='normal'?'🧟 ノーマル':'💀 ハード'}</button>`).join('')}
      </div>`;
    $oBtn.textContent='GAME START';
    $overlay.style.display='flex'; $hud.style.display='none';
    document.getElementById('action-buttons').style.display='none';
    $overlay.querySelectorAll('.diff-btn').forEach(b=>{
      b.addEventListener('click',e=>{e.stopPropagation();currentDiff=b.dataset.d;D=DIFFS[currentDiff];showStart();});
      b.addEventListener('touchend',e=>{e.preventDefault();e.stopPropagation();currentDiff=b.dataset.d;D=DIFFS[currentDiff];showStart();});
    });
  }

  function startGame(){
    D=DIFFS[currentDiff]; buildGrid(); buildScene();
    state='playing';
    $overlay.style.display='none'; $hud.style.display='block';
    document.getElementById('action-buttons').style.display='flex';
    updateHUD();
  }

  function showResult(title,msg){
    state=state; overlayAction='menu';
    $oTitle.textContent=title;
    $oBody.innerHTML=`<p style="font-size:15px;line-height:1.8;color:rgba(255,255,255,0.85)">${msg}</p>`;
    $oBtn.textContent='メニューへ';
    $overlay.style.display='flex'; $hud.style.display='none';
    document.getElementById('action-buttons').style.display='none';
  }

  // ================================================================
  //  INPUT
  // ================================================================
  function setupInput(){
    window.addEventListener('keydown',e=>{keys[e.code]=true;});
    window.addEventListener('keyup',e=>{keys[e.code]=false;});

    // Pointer lock for desktop
    document.addEventListener('click',()=>{ if(state==='playing') renderer.domElement.requestPointerLock?.(); });
    document.addEventListener('pointerlockchange',()=>{
      if(document.pointerLockElement===renderer.domElement) document.addEventListener('mousemove',onMM);
      else document.removeEventListener('mousemove',onMM);
    });

    document.addEventListener('touchstart',onTS,{passive:false});
    document.addEventListener('touchmove',onTM,{passive:false});
    document.addEventListener('touchend',onTE,{passive:false});
    document.addEventListener('touchcancel',onTE,{passive:false});

    $oBtn.addEventListener('click',handleOBtn);
    $oBtn.addEventListener('touchend',e=>{e.preventDefault();handleOBtn();});

    // Action buttons
    addBtn('btn-attack',()=>doMelee());
    addBtn('btn-fire',()=>doShoot());
    addBtn('btn-heal',()=>doHeal());
    addBtn('btn-interact',()=>doInteract());
    addBtn('btn-swap-yes',()=>confirmSwap(true));
    addBtn('btn-swap-no',()=>confirmSwap(false));
  }

  function addBtn(id,fn){
    const el=document.getElementById(id);
    let lt=0;
    el.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();lt=Date.now();fn();});
    el.addEventListener('click',()=>{if(Date.now()-lt>400)fn();});
  }

  function handleOBtn(){ if(overlayAction==='start') startGame(); else showStart(); }
  function onMM(e){ if(state!=='playing')return; player.angle-=e.movementX*0.0028; }

  function onTS(e){
    if(state!=='playing')return;
    const hw=window.innerWidth/2;
    for(const t of e.changedTouches){
      const el=document.elementFromPoint(t.clientX,t.clientY);
      if(el&&el.closest('#action-buttons,#overlay,#swap-prompt'))continue;
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
      if(t.identifier===look.id){e.preventDefault();player.angle-=(t.clientX-look.px)*0.0085;look.px=t.clientX;}
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
    if(meleeCD>0)return;
    if(player.exhausted&&player.melee.id!=='fists')return;
    if(player.stamina<player.melee.st&&player.melee.id!=='fists'){notify('スタミナ不足！');return;}
    player.stamina=Math.max(0,player.stamina-player.melee.st);
    meleeCD=player.melee.cd;
    let hit=false;
    for(let i=zombies.length-1;i>=0;i--){
      const z=zombies[i];
      const d=dist2(player.x,player.z,z.x,z.z);
      if(d>player.melee.range)continue;
      if(Math.abs(angleDiff(Math.atan2(z.x-player.x,z.z-player.z),player.angle))>player.melee.arc/2)continue;
      z.hp-=player.melee.dmg; z.flashTimer=0.18; hit=true;
      if(z.hp<=0)killZombie(i);
    }
    flashMuzzle('rgba(255,200,50,0.3)',120);
    updateHUD();
  }

  function doShoot(){
    if(!player.gun||gunCD>0)return;
    if(player.gun.ammo<=0){notify('弾切れ！');return;}
    player.gun.ammo--; gunCD=GUNS[player.gun.id].fireCd;
    const origin=new THREE.Vector3(player.x,1.2,player.z);
    const fwd=new THREE.Vector3(-Math.sin(player.angle),0,-Math.cos(player.angle)).normalize();
    const rays=[new THREE.Raycaster(origin,fwd,0,GUNS[player.gun.id].range)];
    if(GUNS[player.gun.id].spread){
      [-1,1].forEach(s=>{const d=fwd.clone();d.x+=s*0.1;d.z+=s*0.05;d.normalize();rays.push(new THREE.Raycaster(origin,d,0,GUNS[player.gun.id].range));});
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
      z.hp-=GUNS[player.gun.id].dmg; z.flashTimer=0.22;
      const idx=zombies.indexOf(z); if(z.hp<=0&&idx!==-1)killZombie(idx);
    });
    flashMuzzle('rgba(255,240,100,0.5)',80);
    updateHUD();
  }

  function doHeal(){
    if(player.heals<=0||healCD>0)return;
    if(player.hp>=HP_MAX){notify('HPは満タン！');return;}
    player.heals--; healCD=1.5;
    player.hp=Math.min(HP_MAX,player.hp+40);
    notify('💊 HP +40 回復'); updateHUD();
  }

  function killZombie(idx){
    scene.remove(zombies[idx].mesh); zombies.splice(idx,1);
    notify(zombies.length===0?'🎉 全ゾンビ撃破！出口を目指せ！':'ゾンビを倒した！');
  }

  function flashMuzzle(bg,ms){
    $muzzle.style.background=bg; $muzzle.style.opacity='1';
    setTimeout(()=>$muzzle.style.opacity='0',ms);
  }

  // ================================================================
  //  INTERACT / PICKUP
  // ================================================================
  function doInteract(){
    if(nearContainer&&!nearContainer.opened)openContainer(nearContainer);
  }
  function openContainer(c){
    c.opened=true;
    c.mesh.children.forEach(ch=>{if(ch.material&&!ch.material.wireframe)ch.material.color.multiplyScalar(0.45);});
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
        player.heals++; notify(`💊 回復アイテム入手！(×${player.heals})`); break;
      case 'ammo':
        if(player.gun){
          const max=GUNS[player.gun.id].maxAmmo;
          player.gun.ammo=Math.min(max,player.gun.ammo+item.amount);
          notify(`🔫 弾薬 +${item.amount}（残弾:${player.gun.ammo}）`);
        } else notify(`弾薬を拾った（銃がない）`);
        break;
      case 'melee':{
        const def=MELEE[item.sub];
        if(player.melee.id==='fists'||def.dmg>player.melee.dmg){
          player.melee={...def,id:item.sub}; notify(`⚔ ${def.name}を装備！`);
        } else { showSwapPrompt(item); return; }
        break;
      }
      case 'gun':
        if(!player.gun){
          player.gun={...GUNS[item.sub],id:item.sub,ammo:item.ammo};
          notify(`🔫 ${GUNS[item.sub].name}入手！(弾${item.ammo}発)`);
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
  //  GAME LOOP
  // ================================================================
  function animate(){
    requestAnimationFrame(animate);
    const dt=Math.min(clock.getDelta(),0.05);
    if(state==='playing')update(dt);
    renderer.render(scene,camera);
  }

  function update(dt){
    const now=performance.now(), t=now*0.001;
    if(meleeCD>0)meleeCD-=dt; if(gunCD>0)gunCD-=dt; if(healCD>0)healCD-=dt;

    // ---- Stamina ----
    const sprinting=(keys['ShiftLeft']||keys['ShiftRight'])&&(keys['KeyW']||keys['ArrowUp']||(joy.on&&joy.dy<-0.5));
    if(sprinting&&!player.exhausted){
      player.stamina=Math.max(0,player.stamina-ST_SPRINT*dt);
      if(player.stamina<=0)player.exhausted=true;
    } else {
      player.stamina=Math.min(ST_MAX,player.stamina+ST_REGEN*dt);
      if(player.exhausted&&player.stamina>ST_THRESH)player.exhausted=false;
    }

    // ---- Move ----
    let fwd=0,str=0;
    if(keys['KeyW']||keys['ArrowUp'])fwd+=1; if(keys['KeyS']||keys['ArrowDown'])fwd-=1;
    if(keys['KeyA'])str-=1; if(keys['KeyD'])str+=1;
    if(keys['ArrowLeft'])player.angle+=1.9*dt; if(keys['ArrowRight'])player.angle-=1.9*dt;
    if(joy.on){fwd+=-joy.dy;str+=joy.dx;}
    // Keyboard shortcuts (edge-triggered)
    if(keys['Space']&&!prevKeys['Space'])doMelee();
    if(keys['KeyF']&&!prevKeys['KeyF'])doShoot();
    if(keys['KeyR']&&!prevKeys['KeyR'])doHeal();
    if(keys['KeyE']&&!prevKeys['KeyE'])doInteract();
    for(const k in keys)prevKeys[k]=keys[k];

    if(fwd!==0||str!==0){
      const len=Math.sqrt(fwd*fwd+str*str)||1,nf=fwd/len,ns=str/len;
      const spd=(sprinting&&!player.exhausted)?SPRINT_SPD:WALK_SPD;
      const sinA=Math.sin(player.angle),cosA=Math.cos(player.angle);
      tryMove(player,(-sinA*nf+cosA*ns)*spd*dt,(-cosA*nf-sinA*ns)*spd*dt,PLAYER_R);
    }
    player.mesh.position.set(player.x,0,player.z); player.mesh.rotation.y=player.angle;
    const pl=scene.getObjectByName('pLight'); if(pl)pl.position.set(player.x,2.2,player.z);

    // ---- Camera ----
    const sinA=Math.sin(player.angle),cosA=Math.cos(player.angle);
    camera.position.x+=(player.x+sinA*CAM_DIST-camera.position.x)*CAM_LERP;
    camera.position.y+=(CAM_H-camera.position.y)*CAM_LERP;
    camera.position.z+=(player.z+cosA*CAM_DIST-camera.position.z)*CAM_LERP;
    camera.lookAt(player.x,1.1,player.z);

    // ---- Exit ----
    if(dist2(player.x,player.z,exitPos.x,exitPos.z)<EXIT_R){winGame();return;}
    if(exitMesh)exitMesh.rotation.y=t*1.1;
    const ring=scene.getObjectByName('exitRing'); if(ring)ring.material.opacity=0.3+0.25*Math.sin(t*2.5);

    // ---- Items (pickup) ----
    worldItems=worldItems.filter(it=>!it.collected);
    for(const it of worldItems){
      it.mesh.position.y=0.45+Math.sin(t*2+it.bob)*0.1; it.mesh.rotation.y=t*0.9+it.bob;
      if(dist2(player.x,player.z,it.x,it.z)<PICKUP_R){
        if((it.type==='melee'||it.type==='gun')&&nearWeaponItem)continue;
        pickupItem(it);
      }
    }

    // ---- Containers (interact) ----
    nearContainer=null;
    for(const c of containers){ if(!c.opened&&dist2(player.x,player.z,c.x,c.z)<INTERACT_R){nearContainer=c;break;} }
    $interactPrompt.style.display=nearContainer?'block':'none';
    document.getElementById('btn-interact').style.display=nearContainer?'flex':'none';

    // ---- Zombies ----
    for(let i=zombies.length-1;i>=0;i--){
      const z=zombies[i];
      if(z.flashTimer>0){
        z.flashTimer-=dt;
        const ei=z.flashTimer>0?0.8:0;
        z.mesh.traverse(c=>{if(c.isMesh&&c.material.emissive){c.material.emissive.setHex(z.flashTimer>0?0xff0000:0x000000);c.material.emissiveIntensity=ei;}});
      }
      const dx=player.x-z.x,dz=player.z-z.z,d=Math.sqrt(dx*dx+dz*dz)||0.001;
      if(d<D.zDet){
        const spd=d<5?D.zRun:D.zSpd;
        tryMove(z,(dx/d)*spd*dt,(dz/d)*spd*dt,ZOMBIE_R); z.angle=Math.atan2(dx,dz);
      } else {
        z.wTimer-=dt;
        if(z.wTimer<=0){z.wDir=Math.random()*Math.PI*2;z.wTimer=1.5+Math.random()*2.5;}
        tryMove(z,Math.sin(z.wDir)*D.zSpd*0.38*dt,Math.cos(z.wDir)*D.zSpd*0.38*dt,ZOMBIE_R);
        z.angle=z.wDir;
      }
      z.mesh.position.set(z.x,0,z.z); z.mesh.rotation.y=z.angle;
      if(d<1.15){
        player.hp-=D.zDmg*dt;
        if(now-z.lastDmg>450){z.lastDmg=now;flashDamage();}
      }
    }

    // ---- HP ----
    player.hp=Math.max(0,player.hp);
    updateHUD();
    if(player.hp<=0)gameOver();
  }

  // ================================================================
  //  HUD
  // ================================================================
  function updateHUD(){
    const hp=player.hp/HP_MAX*100;
    $hpFill.style.width=hp+'%'; $hpFill.style.background=hp>60?'#00e855':hp>30?'#ffaa00':'#ff2222';
    $hpNum.textContent=Math.ceil(player.hp);

    const st=player.stamina/ST_MAX*100;
    $stFill.style.width=st+'%'; $stFill.style.background=player.exhausted?'#666':st>40?'#00bbff':'#ff8800';
    $stNum.textContent=Math.ceil(player.stamina);
    if(player.exhausted&&!$stNum._warned){notify('スタミナ切れ！');$stNum._warned=true;}
    if(!player.exhausted)$stNum._warned=false;

    $weaponInfo.textContent=`⚔ ${player.melee.name}`;
    $weaponInfo.className='';

    if(player.gun){
      const g=GUNS[player.gun.id];
      $gunInfo.textContent=`🔫 ${g.name} ${player.gun.ammo}/${g.maxAmmo}`;
      $gunInfo.className=player.gun.ammo>0?'':'';
      $gunInfo.style.color=player.gun.ammo>0?'#ffdd88':'#ff4444';
    } else { $gunInfo.textContent='🔫 なし'; $gunInfo.style.color=''; $gunInfo.className='dim'; }

    $healCount.textContent=`💊 ×${player.heals}`;
    $healCount.className=player.heals>0?'':'dim';

    const d=dist2(player.x,player.z,exitPos.x,exitPos.z);
    $exitHint.textContent=d<20?'🟢 出口が近い！':`🟢 出口まで約${Math.round(d)}m`;

    // Button opacities
    document.getElementById('btn-attack').style.opacity=player.exhausted?'0.4':'1';
    document.getElementById('btn-fire').style.opacity=(player.gun&&player.gun.ammo>0)?'1':'0.35';
    document.getElementById('btn-heal').style.opacity=player.heals>0?'1':'0.35';
  }

  let fTO=null;
  function flashDamage(){$flash.style.opacity='1';clearTimeout(fTO);fTO=setTimeout(()=>$flash.style.opacity='0',380);}
  let nTO=null;
  function notify(txt){$pickupNotif.textContent=txt;$pickupNotif.style.opacity='1';clearTimeout(nTO);nTO=setTimeout(()=>$pickupNotif.style.opacity='0',2200);}

  // ================================================================
  //  WIN / GAMEOVER
  // ================================================================
  function winGame(){state='win';showResult('🎉 脱出成功！','ゾンビから逃げ切った！<br>おめでとう！');}
  function gameOver(){state='gameover';showResult('💀 ゲームオーバー','ゾンビにやられた…<br>次は逃げ切れるか？');}

})();
