const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ITO ANG PASSWORD NA TUGMA SA INDEX.HTML MO
const ADMIN_PASSWORD = "GeoDevs69"; 

// ==========================================
// MONGODB CONNECTION
// ==========================================
// Kinukuha ang connection string sa Render Environment Variable.
// Kung wala, mag-fa-fallback sa hardcoded (para sa testing).
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://geodevz69:GeoDevs69@cluster0.leanvjg.mongodb.net/licenseDB?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas!'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Schema para sa License Keys
const keySchema = new mongoose.Schema({
    key: { type: String, unique: true, required: true },
    hwid: { type: String, default: "WALA_PA" },
    status: { type: String, default: "UNUSED" },
    duration: { type: Number, required: true },
    unit: { type: String, required: true },
    expires: { type: Date, default: null },
    pausedTimeLeft: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now }
});

const LicenseKey = mongoose.model('LicenseKey', keySchema);

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
app.get('/generate', async (req, res) => {
    const { password, duration, unit } = req.query;

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ status: "error", message: "Invalid Admin Password" });
    }

    const key = `CODEX-${generateRandomString(4)}-${generateRandomString(4)}`;
    
    const newKey = new LicenseKey({
        key: key,
        duration: parseInt(duration),
        unit: unit
    });

    try {
        await newKey.save();
        res.json({ status: "success", key: key });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: "error", message: "Database Error" });
    }
});

// ==========================================
// 2. VERIFY ROUTE (Lua Script)
// ==========================================
app.post('/verify', async (req, res) => {
    const { key, hwid } = req.body;
    if (!key || !hwid) return res.status(400).json({ status: "error", message: "Missing Data" });

    try {
        const keyData = await LicenseKey.findOne({ key: key });
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

            keyData.expires = expires;
            keyData.hwid = hwid; 
            keyData.status = "ACTIVE";
            await keyData.save();

            return res.json({ status: "success", message: "Key activated!" });
        }

        if (keyData.status === "ACTIVE") {
            if (keyData.hwid !== hwid) return res.status(403).json({ status: "hwid_mismatch", message: "Key locked to another device" });
            
            const now = new Date();
            if (now > keyData.expires) return res.status(403).json({ status: "expired", message: "Key expired" });
            
            return res.json({ status: "success", message: "Valid" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: "error", message: "Server Error" });
    }
});

// ==========================================
// 3. ADMIN LIST ROUTE
// ==========================================
app.get('/list', async (req, res) => {
    if (req.query.password !== ADMIN_PASSWORD) return res.status(401).json({ status: "error" });
    
    try {
        const keys = await LicenseKey.find();
        const formattedData = {};
        
        keys.forEach(k => {
            formattedData[k.key] = {
                hwid: k.hwid,
                status: k.status,
                duration: k.duration,
                unit: k.unit,
                expires: k.expires,
                pausedTimeLeft: k.pausedTimeLeft,
                createdAt: k.createdAt.getTime()
            };
        });
        
        res.json(formattedData);
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: "error" });
    }
});

// ==========================================
// 4. PAUSE / RESUME / DELETE
// ==========================================
app.get('/toggle-pause', async (req, res) => {
    const { password, key } = req.query;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ status: "error" });

    try {
        const keyData = await LicenseKey.findOne({ key: key });
        if (!keyData) return res.status(404).json({ status: "error", message: "Key not found" });

        if (keyData.status === "ACTIVE") {
            let timeLeft = new Date(keyData.expires) - new Date();
            if (timeLeft < 0) timeLeft = 0;
            keyData.pausedTimeLeft = timeLeft;
            keyData.status = "PAUSED";
            await keyData.save();
            return res.json({ status: "success", message: "Key Successfully Hold!" });
        } 
        else if (keyData.status === "PAUSED") {
            let newExpires = new Date();
            newExpires.setMilliseconds(newExpires.getMilliseconds() + keyData.pausedTimeLeft);
            keyData.expires = newExpires;
            keyData.pausedTimeLeft = null;
            keyData.status = "ACTIVE";
            await keyData.save();
            return res.json({ status: "success", message: "Key Successfully Resumed!" });
        }
        res.json({ status: "error", message: "Cannot pause UNUSED key" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: "error" });
    }
});

app.get('/delete', async (req, res) => {
    const { password, key } = req.query;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ status: "error" });
    
    try {
        const deleted = await LicenseKey.findOneAndDelete({ key: key });
        if (deleted) {
            return res.json({ status: "success", message: "Keys Successfully Deleted" });
        }
        res.status(404).json({ status: "error", message: "Not found" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: "error" });
    }
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
