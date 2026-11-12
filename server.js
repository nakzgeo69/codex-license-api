const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ITO ANG PASSWORD NA TUGMA SA INDEX.HTML MO
const ADMIN_PASSWORD = "GeoDevs69"; 
let database = {}; 

function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// ==========================================
// 1. GENERATE ROUTE
// ==========================================
app.get('/generate', (req, res) => {
    const { password, duration, unit } = req.query;

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ status: "error", message: "Invalid Admin Password" });
    }

    const key = `CODEX-${generateRandomString(4)}-${generateRandomString(4)}`;
    
    database[key] = {
        hwid: "WALA_PA",
        status: "UNUSED",
        duration: parseInt(duration),
        unit: unit,
        expires: null,
        pausedTimeLeft: null,
        createdAt: Date.now() 
    };

    res.json({ status: "success", key: key });
});

// ==========================================
// 2. VERIFY ROUTE (Lua Script)
// ==========================================
app.post('/verify', (req, res) => {
    const { key, hwid } = req.body;
    if (!key || !hwid) return res.status(400).json({ status: "error", message: "Missing Data" });

    const keyData = database[key];
    if (!keyData) return res.status(404).json({ status: "invalid", message: "Key not found" });

    if (keyData.status === "PAUSED") {
        return res.status(403).json({ status: "paused", message: "Key Successfully Hold!" });
    }

    if (keyData.status === "UNUSED") {
        let expires = new Date();
        if (keyData.unit === 'seconds') expires.setSeconds(expires.getSeconds() + keyData.duration);
        else if (keyData.unit === 'minutes') expires.setMinutes(expires.getMinutes() + keyData.duration);
        else if (keyData.unit === 'hours') expires.setHours(expires.getHours() + keyData.duration);
        else if (keyData.unit === 'days') expires.setDate(expires.getDate() + keyData.duration);
        else if (keyData.unit === 'months') expires.setMonth(expires.getMonth() + keyData.duration);
        else if (keyData.unit === 'years') expires.setFullYear(expires.getFullYear() + keyData.duration);

        keyData.expires = expires.toISOString();
        keyData.hwid = hwid; 
        keyData.status = "ACTIVE";

        return res.json({ status: "success", message: "Key activated!" });
    }

    if (keyData.status === "ACTIVE") {
        if (keyData.hwid !== hwid) return res.status(403).json({ status: "hwid_mismatch", message: "Key locked to another device" });
        
        const now = new Date();
        const expiryDate = new Date(keyData.expires);
        if (now > expiryDate) return res.status(403).json({ status: "expired", message: "Key expired" });
        return res.json({ status: "success", message: "Valid" });
    }
});

// ==========================================
// 3. ADMIN LIST ROUTE
// ==========================================
app.get('/list', (req, res) => {
    if (req.query.password !== ADMIN_PASSWORD) return res.status(401).json({ status: "error" });
    res.json(database);
});

// ==========================================
// 4. PAUSE / RESUME / DELETE
// ==========================================
app.get('/toggle-pause', (req, res) => {
    const { password, key } = req.query;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ status: "error" });

    const keyData = database[key];
    if (!keyData) return res.status(404).json({ status: "error", message: "Key not found" });

    if (keyData.status === "ACTIVE") {
        let timeLeft = new Date(keyData.expires) - new Date();
        if (timeLeft < 0) timeLeft = 0;
        keyData.pausedTimeLeft = timeLeft;
        keyData.status = "PAUSED";
        return res.json({ status: "success", message: "Key Successfully Hold!" });
    } 
    else if (keyData.status === "PAUSED") {
        let newExpires = new Date();
        newExpires.setMilliseconds(newExpires.getMilliseconds() + keyData.pausedTimeLeft);
        keyData.expires = newExpires.toISOString();
        keyData.pausedTimeLeft = null;
        keyData.status = "ACTIVE";
        return res.json({ status: "success", message: "Key Successfully Resumed!" });
    }
    res.json({ status: "error", message: "Cannot pause UNUSED key" });
});

app.get('/delete', (req, res) => {
    const { password, key } = req.query;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ status: "error" });
    if (database[key]) {
        delete database[key];
        return res.json({ status: "success", message: "Keys Successfully Deleted" });
    }
    res.status(404).json({ status: "error", message: "Not found" });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
