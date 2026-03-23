const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const WORLD_SIZE = 5000;
let players = {};
let enemies = [];
let resources = [];
let projectiles = [];
let placedBlocks = [];
let placedTowers = [];

// Static Map Elements
const rivers = [
    { x: 1500, y: 0, w: 400, h: WORLD_SIZE },
    { x: 0, y: 2500, w: WORLD_SIZE, h: 400 }
];

const obstacles = Array.from({ length: 40 }, () => ({
    x: Math.random() * WORLD_SIZE,
    y: Math.random() * WORLD_SIZE,
    w: 100 + Math.random() * 200,
    h: 100 + Math.random() * 200
}));

// Spawning Logic
function spawnResource() {
    const type = Math.random() > 0.4 ? 'tree' : 'rock';
    resources.push({
        id: Math.random().toString(36).substr(2, 9),
        type,
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        hp: type === 'tree' ? 50 : 100,
        maxHp: type === 'tree' ? 50 : 100,
        radius: type === 'tree' ? 30 : 25
    });
}
for (let i = 0; i < 100; i++) spawnResource();

function spawnEnemy() {
    enemies.push({
        id: Math.random().toString(36).substr(2, 9),
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        hp: 30,
        maxHp: 30,
        speed: 2 + Math.random()
    });
}
setInterval(spawnEnemy, 3000);

// Core Loop
setInterval(() => {
    const now = Date.now();

    // Tower Firing
    placedTowers.forEach(t => {
        if (now - (t.lastShot || 0) > 1000) {
            let target = enemies.find(e => Math.hypot(e.x - t.x, e.y - t.y) < 400);
            if (target) {
                const angle = Math.atan2(target.y - t.y, target.x - t.x);
                projectiles.push({
                    x: t.x + 20, y: t.y + 20,
                    vx: Math.cos(angle) * 8, vy: Math.sin(angle) * 8,
                    ownerId: t.ownerId, life: 60, dmg: 15
                });
                t.lastShot = now;
            }
        }
    });

    // Projectile Physics (Pass through allied walls, hit enemy walls)
    for (let i = projectiles.length - 1; i >= 0; i--) {
        let p = projectiles[i];
        p.x += p.vx; p.y += p.vy; p.life--;
        
        let hit = false;
        // Check Walls
        for (let j = placedBlocks.length - 1; j >= 0; j--) {
            let b = placedBlocks[j];
            if (p.x > b.x && p.x < b.x + 40 && p.y > b.y && p.y < b.y + 40) {
                const owner = players[p.ownerId];
                const isAlly = (b.ownerId === p.ownerId) || (owner && owner.team.includes(b.ownerId));
                if (!isAlly) {
                    b.hp -= p.dmg;
                    if (b.hp <= 0) placedBlocks.splice(j, 1);
                    hit = true; break;
                }
            }
        }

        // Check Enemies
        enemies.forEach((en, idx) => {
            if (Math.hypot(p.x - en.x, p.y - en.y) < 25) {
                en.hp -= p.dmg;
                if (en.hp <= 0) {
                    const owner = players[p.ownerId];
                    if (owner) owner.xp += 20;
                    enemies.splice(idx, 1);
                }
                hit = true;
            }
        });

        if (hit || p.life <= 0) projectiles.splice(i, 1);
    }

    io.emit('serverUpdate', { players, enemies, resources, projectiles, placedBlocks, placedTowers });
}, 1000 / 60);

io.on('connection', (socket) => {
    socket.emit('initWorld', { obstacles, rivers });

    socket.on('joinGame', (data) => {
        players[socket.id] = {
            id: socket.id, name: data.name, color: data.color,
            x: 500, y: 500, hp: 100, maxHp: 100, xp: 0, level: 1,
            blocks: 20, towers: 2, team: [], teamRequests: []
        };
    });

    socket.on('playerMoved', (data) => {
        if (players[socket.id]) { players[socket.id].x = data.x; players[socket.id].y = data.y; }
    });

    // Team Invite Logic
    socket.on('sendTeamReq', (targetId) => {
        if (players[targetId] && !players[targetId].teamRequests.includes(socket.id)) {
            players[targetId].teamRequests.push(socket.id);
        }
    });

    socket.on('acceptTeamReq', (reqId) => {
        const p = players[socket.id];
        const requester = players[reqId];
        if (p && requester) {
            p.team.push(reqId);
            requester.team.push(socket.id);
            p.teamRequests = p.teamRequests.filter(id => id !== reqId);
        }
    });

    socket.on('place', (data) => {
        const p = players[socket.id];
        if (!p) return;
        if (data.type === 'block' && p.blocks > 0) {
            placedBlocks.push({ x: data.x, y: data.y, hp: 100, ownerId: socket.id });
            p.blocks--;
        } else if (data.type === 'tower' && p.towers > 0) {
            placedTowers.push({ x: data.x, y: data.y, hp: 150, ownerId: socket.id });
            p.towers--;
        }
    });

    socket.on('disconnect', () => { delete players[socket.id]; });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
