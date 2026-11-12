const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// I-serve ang index.html mula sa 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// ITO ANG ADMIN PASSWORD MO (Walang special chars para iwas error)
const ADMIN_PASSWORD = "CodexAdmin101"; 
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
// 1. GENERATE ROUTE (Tinatawag ng UI)
// ==========================================
app.get('/generate', (req, res) => {
    const { password, duration, unit } = req.query;

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ status: "error", message: "Invalid Admin Password" });
    }

    const key = `CODEX-${generateRandomString(4)}-${generateRandomString(4)}`;
    
    // I-save na "UNUSED" (Timer starts on first use)
    database[key] = {
        hwid: "WALA_PA",
        status: "UNUSED",
        duration: parseInt(duration),
        unit: unit,
        expires: null
    };

    res.json({ 
        status: "success", 
        key: key, 
        message: "Key generated. Timer starts on first use.",
        duration: `${duration} ${unit}`
    });
});

// ==========================================
// 2. VERIFY ROUTE (Para sa Lua Script)
// ==========================================
app.post('/verify', (req, res) => {
    const { key, hwid } = req.body;

    if (!key || !hwid) return res.status(400).json({ status: "error", message: "Missing Data" });

    const keyData = database[key];
    if (!keyData) return res.status(404).json({ status: "invalid", message: "Key not found" });

    // --- UNANG GAMIT (Dito magsisimula ang timer) ---
    if (keyData.status === "UNUSED") {
        let expires = new Date();
        
        // Logic para sa lahat ng units
        if (keyData.unit === 'seconds') expires.setSeconds(expires.getSeconds() + keyData.duration);
        else if (keyData.unit === 'minutes') expires.setMinutes(expires.getMinutes() + keyData.duration);
        else if (keyData.unit === 'hours') expires.setHours(expires.getHours() + keyData.duration);
        else if (keyData.unit === 'days') expires.setDate(expires.getDate() + keyData.duration);
        else if (keyData.unit === 'months') expires.setMonth(expires.getMonth() + keyData.duration);
        else if (keyData.unit === 'years') expires.setFullYear(expires.getFullYear() + keyData.duration);

        keyData.expires = expires.toISOString();
        keyData.hwid = hwid; 
        keyData.status = "ACTIVE";

        console.log(`[ACTIVATED] Key: ${key} | HWID: ${hwid} | Expires: ${expires.toLocaleString()}`);

        return res.json({ 
            status: "success", 
            message: "Key activated! Timer started.",
            expires_at: expires.toLocaleString()
        });
    }

    // --- KUNG GINAGAMIT NA ---
    if (keyData.status === "ACTIVE") {
        // Check HWID
        if (keyData.hwid !== hwid) {
            return res.status(403).json({ status: "hwid_mismatch", message: "Key locked to another device" });
        }

        // Check Expiration
        const now = new Date();
        const expiryDate = new Date(keyData.expires);
        
        if (now > expiryDate) {
            return res.status(403).json({ status: "expired", message: "Key has expired" });
        }

        const timeLeft = Math.round((expiryDate - now) / 60000); // Minutes left
        return res.json({ status: "success", message: `License Valid. Time left: ${timeLeft} mins` });
    }
});

// ==========================================
// 3. ADMIN LIST ROUTE
// ==========================================
app.get('/list', (req, res) => {
    if (req.query.password !== ADMIN_PASSWORD) {
        return res.status(401).json({ status: "error", message: "Invalid Admin Password" });
    }
    res.json(database);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
