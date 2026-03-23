const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const WORLD_SIZE = 8000;
let players = {};
let enemies = [];
let xpBoxes = [];
let droppedItems = []; 
let placedBlocks = []; 
let placedTowers = []; 
let projectiles = [];  
let resources = []; 
let frameCount = 0;
let difficultyMult = 1;

const WEAPONS = {
    wood: { damage: 15, range: 45 },
    iron: { damage: 30, range: 55 },
    gold: { damage: 50, range: 65 },
    diamond: { damage: 100, range: 80 }
};

const rivers = [
    { x: 2500, y: 0, w: 600, h: WORLD_SIZE },
    { x: 0, y: 4500, w: WORLD_SIZE, h: 500 }
];

const obstacles = [];
for (let i = 0; i < 150; i++) obstacles.push({ x: Math.random() * (WORLD_SIZE - 200), y: Math.random() * (WORLD_SIZE - 200), w: 80 + Math.random() * 200, h: 80 + Math.random() * 200 });

function spawnResource() {
    let type = Math.random() > 0.5 ? 'tree' : 'rock';
    let size = type === 'tree' ? 35 : 25;
    let hp = type === 'tree' ? 45 : 90;
    let xp = type === 'tree' ? 20 : 50;
    resources.push({ id: Math.random().toString(36).substr(2, 9), type: type, x: Math.random() * WORLD_SIZE, y: Math.random() * WORLD_SIZE, radius: size, hp: hp, maxHp: hp, xpReward: xp });
}
for (let i = 0; i < 300; i++) spawnResource();

function spawnXpBox() { xpBoxes.push({ id: Math.random().toString(36).substr(2, 9), x: Math.random() * (WORLD_SIZE - 20), y: Math.random() * (WORLD_SIZE - 20), size: 20, hp: 15, maxHp: 15 }); }
for (let i = 0; i < 15; i++) spawnXpBox();

function checkCollision(cx, cy, cr, rx, ry, rw, rh) {
    let testX = cx, testY = cy;
    if (cx < rx) testX = rx; else if (cx > rx + rw) testX = rx + rw;
    if (cy < ry) testY = ry; else if (cy > ry + rh) testY = ry + rh;
    return Math.hypot(cx - testX, cy - testY) <= cr;
}

function spawnEnemy(isBoss = false) {
    let ex = Math.random() * WORLD_SIZE, ey = Math.random() * WORLD_SIZE;
    if (Math.random() < 0.5) ex = Math.random() < 0.5 ? 0 : WORLD_SIZE; else ey = Math.random() < 0.5 ? 0 : WORLD_SIZE;
    let typeRoll = Math.random();
    let radius = 14, speed = 2.5 + Math.random(), hp = 20, color = '#ff0055'; 
    if (isBoss) { radius = 40; speed = 1.5; hp = 500; color = '#aa00ff'; } 
    enemies.push({ id: Math.random().toString(36).substr(2, 9), x: ex, y: ey, isBoss: isBoss, color: color, radius: radius, speed: speed, hp: hp * difficultyMult, maxHp: hp * difficultyMult });
}

setInterval(() => {
    let now = Date.now();
    frameCount++;
    if (frameCount % 25 === 0) spawnEnemy(false); 
    if (frameCount % 1200 === 0) spawnEnemy(true);
    if (frameCount % 600 === 0) difficultyMult += 0.2;

    // Tower Logic
    for (let t of placedTowers) {
        if (now - t.lastShot > 1000) { 
            let target = null, minDist = 350, owner = players[t.ownerId], team = owner ? owner.team : [];
            for (let en of enemies) { let d = Math.hypot(en.x - (t.x+20), en.y - (t.y+20)); if (d < minDist) { minDist = d; target = {x: en.x, y: en.y}; } }
            if (owner) { for (let id in players) { if (id === t.ownerId || team.includes(id)) continue; let p2 = players[id]; if (p2.isDead) continue; let d = Math.hypot(p2.x - (t.x+20), p2.y - (t.y+20)); if (d < minDist) { minDist = d; target = {x: p2.x, y: p2.y}; } } }
            if (target) { t.lastShot = now; let angle = Math.atan2(target.y - (t.y+20), target.x - (t.x+20)); projectiles.push({ x: t.x+20, y: t.y+20, vx: Math.cos(angle)*10, vy: Math.sin(angle)*10, dmg: 20 * t.dmgMult, ownerId: t.ownerId, color: t.ownerColor, life: 40 }); }
        }
    }

    // Projectile Logic (Passing through allied walls)
    for (let i = projectiles.length - 1; i >= 0; i--) {
        let proj = projectiles[i]; proj.x += proj.vx; proj.y += proj.vy; proj.life--;
        if (proj.life <= 0) { projectiles.splice(i, 1); continue; }
        let owner = players[proj.ownerId], team = owner ? owner.team : [], hitSomething = false;

        for (let k = placedBlocks.length - 1; k >= 0; k--) {
            let b = placedBlocks[k];
            if (proj.x > b.x && proj.x < b.x + b.w && proj.y > b.y && proj.y < b.y + b.h) {
                if (b.ownerId !== proj.ownerId && !team.includes(b.ownerId)) {
                    b.hp -= proj.dmg; if (b.hp <= 0) placedBlocks.splice(k, 1);
                    hitSomething = true; break;
                }
            }
        }
        if (hitSomething) { projectiles.splice(i, 1); continue; }
        for (let en of enemies) { if (Math.hypot(proj.x - en.x, proj.y - en.y) < en.radius) { en.hp -= proj.dmg; hitSomething = true; break; } }
        if (hitSomething) { projectiles.splice(i, 1); }
    }

    // Enemy AI
    for (let en of enemies) {
        let target = null, minDist = Infinity;
        for (let id in players) { let p = players[id]; if (!p.isDead) { let d = Math.hypot(p.x - en.x, p.y - en.y); if (d < minDist) { minDist = d; target = p; } } }
        if (target) {
            let angle = Math.atan2(target.y - en.y, target.x - en.x);
            en.x += Math.cos(angle) * en.speed; en.y += Math.sin(angle) * en.speed;
        }
    }

    io.emit('serverUpdate', { enemies, players, xpBoxes, droppedItems, placedBlocks, placedTowers, projectiles, resources });
}, 1000 / 60);

io.on('connection', (socket) => {
    socket.emit('initWorld', { obstacles, rivers });
    socket.on('joinGame', (data) => {
        players[socket.id] = { ...data, hp: 100, maxHp: 100, xp: 0, level: 1, xpNeeded: 100, blocks: 10, towers: 0, team: [], teamRequests: [], x: 100, y: 100, color: data.color, weapon: 'wood', damageMult: 1, blockHpMult: 1, towerHpMult: 1, towerDmgMult: 1 };
    });

    socket.on('playerMoved', (data) => { if (players[socket.id]) { players[socket.id].x = data.x; players[socket.id].y = data.y; } });

    socket.on('sendTeamReq', (id) => { if (players[id] && !players[id].teamRequests.includes(socket.id)) players[id].teamRequests.push(socket.id); });
    socket.on('acceptTeamReq', (id) => {
        let p = players[socket.id], req = players[id];
        if (p && req) { p.team.push(id); req.team.push(socket.id); p.teamRequests = p.teamRequests.filter(x => x !== id); }
    });

    socket.on('placeBlock', (d) => {
        let p = players[socket.id];
        if (p && p.blocks > 0) { p.blocks--; placedBlocks.push({ x: d.x, y: d.y, w: 40, h: 40, hp: 100 * p.blockHpMult, ownerId: socket.id, ownerColor: p.color }); }
    });
    
    socket.on('placeTower', (d) => {
        let p = players[socket.id];
        if (p && p.towers > 0) { p.towers--; placedTowers.push({ x: d.x, y: d.y, w: 40, h: 40, hp: 150 * p.towerHpMult, dmgMult: p.towerDmgMult, ownerId: socket.id, lastShot: 0, ownerColor: p.color }); }
    });

    socket.on('disconnect', () => { delete players[socket.id]; });
});

server.listen(3000, () => console.log("Server Live on Port 3000"));
