const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg'); 
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- THE WAKE-UP ENDPOINT ---
// Our automated bot will hit this to prevent the free server from sleeping
app.get('/ping', (req, res) => {
    res.status(200).send('Server is awake and active!');
});

// --- CLOUD DATABASE CONNECTION ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

const initDB = async () => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(255) UNIQUE,
            password TEXT,
            bio TEXT DEFAULT 'Secure connection established.'
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS friendships (
            id SERIAL PRIMARY KEY,
            sender VARCHAR(255),
            receiver VARCHAR(255),
            status VARCHAR(50)
        )`);
        console.log("Connected securely to Cloud PostgreSQL.");
    } catch (err) {
        console.error("Database initialization failed:", err);
    }
};
initDB();

// --- AUTH API ---
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(`INSERT INTO users (username, password) VALUES ($1, $2)`, [username, hashedPassword]);
        res.status(200).json({ success: true });
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ error: "Username taken!" }); 
        res.status(500).json({ error: "Server error" });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const { rows } = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
        if (rows.length === 0) return res.status(400).json({ error: "User not found!" });
        
        const match = await bcrypt.compare(password, rows[0].password);
        if (match) res.status(200).json({ success: true, username: rows[0].username, bio: rows[0].bio });
        else res.status(400).json({ error: "Incorrect password!" });
    } catch (error) { res.status(500).json({ error: "Server error" }); }
});

app.post('/update-bio', async (req, res) => {
    const { username, bio } = req.body;
    try {
        await pool.query(`UPDATE users SET bio = $1 WHERE username = $2`, [bio, username]);
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Database error" }); }
});

// --- FRIEND SYSTEM API ---
app.post('/send-request', async (req, res) => {
    const { sender, receiver } = req.body;
    try {
        const { rows } = await pool.query(`SELECT * FROM users WHERE username = $1`, [receiver]);
        if (rows.length === 0) return res.status(400).json({ error: "User does not exist." });
        
        await pool.query(`INSERT INTO friendships (sender, receiver, status) VALUES ($1, $2, 'pending')`, [sender, receiver]);
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Already requested." }); }
});

app.post('/accept-request', async (req, res) => {
    const { sender, receiver } = req.body; 
    try {
        await pool.query(`UPDATE friendships SET status = 'accepted' WHERE sender = $1 AND receiver = $2`, [sender, receiver]);
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Database error" }); }
});

app.post('/delete-contact', async (req, res) => {
    const { user1, user2 } = req.body;
    try {
        await pool.query(`DELETE FROM friendships WHERE (sender = $1 AND receiver = $2) OR (sender = $2 AND receiver = $1)`, [user1, user2]);
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: "Database error" }); }
});

app.get('/friends/:username', async (req, res) => {
    const { username } = req.params;
    try {
        const { rows } = await pool.query(`SELECT * FROM friendships WHERE sender = $1 OR receiver = $1`, [username]);
        
        const accepted = rows.filter(r => r.status === 'accepted').map(r => r.sender === username ? r.receiver : r.sender);
        const pending = rows.filter(r => r.status === 'pending' && r.receiver === username).map(r => r.sender);
        
        if (accepted.length > 0) {
            const placeholders = accepted.map((_, i) => `$${i + 1}`).join(',');
            const { rows: userRows } = await pool.query(`SELECT username, bio FROM users WHERE username IN (${placeholders})`, accepted);
            res.status(200).json({ accepted: userRows, pending });
        } else {
            res.status(200).json({ accepted: [], pending });
        }
    } catch (error) { res.status(500).json({ error: "Database error" }); }
});

// --- SOCKET.IO RELAY ---
const connectedUsers = {}; 

io.on('connection', (socket) => {
    socket.on('register_user', (username) => { connectedUsers[username] = socket.id; });

    socket.on('send_private_message', (data) => {
        const receiverSocketId = connectedUsers[data.receiverId];
        if (receiverSocketId) io.to(receiverSocketId).emit('receive_message', data);
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