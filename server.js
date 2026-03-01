require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg'); 
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.get('/ping', (req, res) => res.status(200).send('Awake!'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

const initDB = async () => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(255) UNIQUE, password TEXT, bio TEXT DEFAULT 'Secure connection established.')`);
        await pool.query(`CREATE TABLE IF NOT EXISTS friendships (id SERIAL PRIMARY KEY, sender VARCHAR(255), receiver VARCHAR(255), status VARCHAR(50))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS media_vault (id VARCHAR(255) PRIMARY KEY, payload TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        
        // NEW: Persistent Messages Table
        await pool.query(`CREATE TABLE IF NOT EXISTS messages (
            id VARCHAR(255) PRIMARY KEY,
            sender VARCHAR(255),
            receiver VARCHAR(255),
            encrypted_payload TEXT,
            mode VARCHAR(50),
            expires_at BIGINT,
            media_id VARCHAR(255),
            status VARCHAR(20) DEFAULT 'sent',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log("Connected securely to Cloud PostgreSQL.");
    } catch (err) { console.error("DB error:", err); }
};
initDB();

// --- AUTH & FRIENDS API (Unchanged) ---
app.post('/register', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        await pool.query(`INSERT INTO users (username, password) VALUES ($1, $2)`, [req.body.username, hashedPassword]);
        res.status(200).json({ success: true });
    } catch (error) { res.status(400).json({ error: "Username taken!" }); }
});

app.post('/login', async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM users WHERE username = $1`, [req.body.username]);
        if (rows.length === 0) return res.status(400).json({ error: "User not found!" });
        const match = await bcrypt.compare(req.body.password, rows[0].password);
        if (match) res.status(200).json({ success: true, username: rows[0].username, bio: rows[0].bio });
        else res.status(400).json({ error: "Incorrect password!" });
    } catch (error) { res.status(500).json({ error: "Server error" }); }
});

app.post('/update-bio', async (req, res) => {
    try {
        await pool.query(`UPDATE users SET bio = $1 WHERE username = $2`, [req.body.bio, req.body.username]);
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Database error" }); }
});

app.post('/send-request', async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM users WHERE username = $1`, [req.body.receiver]);
        if (rows.length === 0) return res.status(400).json({ error: "User does not exist." });
        await pool.query(`INSERT INTO friendships (sender, receiver, status) VALUES ($1, $2, 'pending')`, [req.body.sender, req.body.receiver]);
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Already requested." }); }
});

app.post('/accept-request', async (req, res) => {
    try {
        await pool.query(`UPDATE friendships SET status = 'accepted' WHERE sender = $1 AND receiver = $2`, [req.body.sender, req.body.receiver]);
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Database error" }); }
});

app.post('/delete-contact', async (req, res) => {
    try {
        await pool.query(`DELETE FROM friendships WHERE (sender = $1 AND receiver = $2) OR (sender = $2 AND receiver = $1)`, [req.body.user1, req.body.user2]);
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Database error" }); }
});

app.get('/friends/:username', async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM friendships WHERE sender = $1 OR receiver = $1`, [req.params.username]);
        const accepted = rows.filter(r => r.status === 'accepted').map(r => r.sender === req.params.username ? r.receiver : r.sender);
        const pending = rows.filter(r => r.status === 'pending' && r.receiver === req.params.username).map(r => r.sender);
        if (accepted.length > 0) {
            const placeholders = accepted.map((_, i) => `$${i + 1}`).join(',');
            const { rows: userRows } = await pool.query(`SELECT username, bio FROM users WHERE username IN (${placeholders})`, accepted);
            res.status(200).json({ accepted: userRows, pending });
        } else res.status(200).json({ accepted: [], pending });
    } catch (error) { res.status(500).json({ error: "Database error" }); }
});

// --- MEDIA VAULT API ---
app.post('/upload-media', async (req, res) => {
    try {
        await pool.query(`INSERT INTO media_vault (id, payload) VALUES ($1, $2)`, [req.body.id, req.body.payload]);
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Upload failed" }); }
});

app.get('/media/:id', async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT payload FROM media_vault WHERE id = $1`, [req.params.id]);
        if (rows.length > 0) res.status(200).json({ payload: rows[0].payload });
        else res.status(404).json({ error: "Media not found" });
    } catch (error) { res.status(500).json({ error: "Database error" }); }
});

// --- NEW: CHAT HISTORY API ---
app.get('/chat-history/:user1/:user2', async (req, res) => {
    const { user1, user2 } = req.params;
    try {
        // Fetch persistent messages. Exclude expired burn messages.
        const { rows } = await pool.query(
            `SELECT * FROM messages 
             WHERE ((sender = $1 AND receiver = $2) OR (sender = $2 AND receiver = $1))
             AND (expires_at IS NULL OR expires_at > $3)
             ORDER BY created_at ASC`, 
            [user1, user2, Date.now()]
        );
        res.status(200).json({ history: rows });
    } catch (error) { res.status(500).json({ error: "Database error" }); }
});

// --- SOCKET.IO RELAY WITH RECEIPT TRACKING ---
const connectedUsers = {}; 

io.on('connection', (socket) => {
    socket.on('register_user', (username) => { connectedUsers[username] = socket.id; });

    socket.on('send_private_message', async (data) => {
        const receiverSocketId = connectedUsers[data.receiverId];
        let status = receiverSocketId ? 'delivered' : 'sent';

        // 1. Store permanently in PostgreSQL
        try {
            await pool.query(
                `INSERT INTO messages (id, sender, receiver, encrypted_payload, mode, expires_at, media_id, status) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [data.id, data.senderId, data.receiverId, data.encryptedPayload, data.mode, data.expiresAt, data.mediaId, status]
            );
        } catch(e) { console.error("Failed to save message", e); }
        
        // 2. Route message
        if (receiverSocketId) io.to(receiverSocketId).emit('receive_message', { ...data, status });
        
        // 3. Send Delivered receipt back to sender if receiver is online
        if (receiverSocketId) socket.emit('receipt_update', { id: data.id, status: 'delivered' });
    });

    socket.on('mark_read', async (data) => {
        // Update DB to read
        await pool.query(`UPDATE messages SET status = 'read' WHERE id = $1`, [data.id]);
        // Forward read receipt to the original sender
        const senderSocketId = connectedUsers[data.originalSender];
        if (senderSocketId) io.to(senderSocketId).emit('receipt_update', { id: data.id, status: 'read' });
    });

    socket.on('send_mode_change', (data) => {
        const receiverSocketId = connectedUsers[data.receiverId];
        if (receiverSocketId) io.to(receiverSocketId).emit('mode_changed', { senderId: data.senderId, mode: data.mode });
    });

    socket.on('trigger_network_sync', (targetUser) => {
        const targetSocket = connectedUsers[targetUser];
        if (targetSocket) io.to(targetSocket).emit('refresh_friends');
    });

    socket.on('disconnect', () => {
        for (const [username, id] of Object.entries(connectedUsers)) {
            if (id === socket.id) delete connectedUsers[username];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Secure Server running on port ${PORT}`));

