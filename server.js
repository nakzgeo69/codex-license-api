const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('fs'); 
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Security: Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { status: "error", message: "Too many requests, please try again later." }
});
app.use('/verify', limiter);
app.use('/verify-reseller', limiter);
app.use('/api/', limiter);
app.use('/get-latest-script', limiter);

// SIGURADONG TAMA ANG PASSWORD DITO
const ADMIN_PASSWORD = "CodexSquad101"; 
const MONGO_URI = process.env.MONGO_URI; 

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas!'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

const keySchema = new mongoose.Schema({
    key: { type: String, unique: true, required: true },
    hwid: { type: String, default: "WALA_PA" },
    status: { type: String, default: "UNUSED" },
    duration: { type: Number, required: true },
    unit: { type: String, required: true },
    expires: { type: Date, default: null },
    pausedTimeLeft: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now },
    source: { type: String, default: "MAIN" },
    resellerId: { type: String, default: null }
});

const LicenseKey = mongoose.model('LicenseKey', keySchema);

function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

function calculateExpiry(unit, duration) {
    let expires = new Date();
    if (unit === 'seconds') expires.setSeconds(expires.getSeconds() + duration);
    else if (unit === 'minutes') expires.setMinutes(expires.getMinutes() + duration);
    else if (unit === 'hours') expires.setHours(expires.getHours() + duration);
    else if (unit === 'days') expires.setDate(expires.getDate() + duration);
    else if (unit === 'months') expires.setMonth(expires.getMonth() + duration);
    else if (unit === 'years') expires.setFullYear(expires.getFullYear() + duration);
    return expires;
}

// 1. MAIN GENERATE
app.get('/generate', async (req, res) => {
    const { password, duration, unit } = req.query;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ status: "error", message: "Invalid Admin Password" });
    if (!duration || !unit) return res.status(400).json({ status: "error", message: "Missing duration or unit" });

    const key = `CODEX-${generateRandomString(4)}-${generateRandomString(4)}`;
    const newKey = new LicenseKey({ key, duration: parseInt(duration), unit, source: "MAIN" });

    try {
        await newKey.save();
        res.json({ status: "success", key: key });
    } catch (err) {
        res.status(500).json({ status: "error", message: "Database Error" });
    }
});

// 2. RESELLER GENERATE
app.post('/api/reseller-generate', async (req, res) => {
    const { resellerKey, duration, unit } = req.body;
    if (!resellerKey || !duration || !unit) return res.status(400).json({ status: "error", message: "Missing required fields" });

    try {
        const resellerData = await LicenseKey.findOne({ key: resellerKey });
        if (!resellerData || resellerData.source !== "MAIN") return res.status(401).json({ status: "error", message: "Invalid Key Found" });
        if (resellerData.status === "PAUSED") return res.status(403).json({ status: "error", message: "Reseller Access Revoked" });
        if (resellerData.status === "UNUSED") return res.status(403).json({ status: "error", message: "Please activate your reseller key first" });
        if (resellerData.status === "ACTIVE" && new Date() > resellerData.expires) return res.status(403).json({ status: "error", message: "Your Key Expired" });

        const key = `CODEX-${generateRandomString(4)}-${generateRandomString(4)}`;
        const newKey = new LicenseKey({ 
            key, 
            duration: parseInt(duration), 
            unit, 
            source: "RESELLER",
            resellerId: resellerKey 
        });
        await newKey.save();

        res.json({ status: "success", key: key });
    } catch (err) {
        res.status(500).json({ status: "error", message: "Server Error" });
    }
});

// 3. CLIENT VERIFY (AYOS NA PARA SA EXPIRY AT HWID)
app.post('/verify', async (req, res) => {
    const { key, hwid } = req.body;
    if (!key || !hwid) return res.status(400).json({ status: "error", message: "Missing Data" });

    try {
        const keyData = await LicenseKey.findOne({ key: key });
        if (!keyData) return res.status(404).json({ status: "invalid", message: "Key not found" });

        if (keyData.status === "PAUSED") return res.status(403).json({ status: "paused", message: "Key Successfully Hold!" });

        if (keyData.status === "UNUSED") {
            keyData.expires = calculateExpiry(keyData.unit, keyData.duration);
            keyData.hwid = hwid; 
            keyData.status = "ACTIVE";
            await keyData.save();
            return res.json({ status: "success", message: "Key activated!", expires: keyData.expires });
        }

        if (keyData.status === "ACTIVE") {
            if (keyData.hwid !== hwid) {
                if (keyData.hwid.includes("nil") || keyData.hwid.includes("FALLBACK") || keyData.hwid === "WALA_PA") {
                    keyData.hwid = hwid;
                    await keyData.save();
                } else {
                    return res.status(403).json({ status: "hwid_mismatch", message: "Key locked to another device" });
                }
            }
            if (new Date() > keyData.expires) {
                return res.status(403).json({ status: "expired", message: "Key expired" });
            }
            return res.json({ status: "success", message: "Valid", expires: keyData.expires });
        }
    } catch (err) {
        res.status(500).json({ status: "error", message: "Server Error" });
    }
});

// 4. RESELLER VERIFY
app.post('/verify-reseller', async (req, res) => {
    const { key, hwid } = req.body;
    if (!key || !hwid) return res.status(400).json({ status: "error", message: "Missing Key or Device ID" });

    try {
        const keyData = await LicenseKey.findOne({ key: key });
        if (!keyData) return res.status(404).json({ status: "invalid", message: "Key not found" });
        if (keyData.source !== "MAIN") return res.status(403).json({ status: "error", message: "Not a Main Key" });
        if (keyData.status === "PAUSED") return res.status(403).json({ status: "paused", message: "Key is paused" });

        if (keyData.status === "UNUSED") {
            keyData.expires = calculateExpiry(keyData.unit, keyData.duration);
            keyData.hwid = hwid;
            keyData.status = "ACTIVE";
            keyData.resellerId = "Reseller"; 
            await keyData.save();
        } 
        else if (keyData.status === "ACTIVE") {
            if (keyData.hwid !== hwid) {
                return res.status(403).json({ status: "error", message: "Key locked to another device/browser." });
            }
            if (new Date() > keyData.expires) {
                return res.status(403).json({ status: "expired", message: "Your Key Expired" });
            }
        }

        return res.json({ status: "success", message: "Valid Key Found" });
    } catch (err) {
        res.status(500).json({ status: "error", message: "Server Error" });
    }
});

// 5. LIST ALL KEYS
app.get('/list', async (req, res) => {
    if (req.query.password !== ADMIN_PASSWORD) return res.status(401).json({ status: "error" });
    try {
        const keys = await LicenseKey.find().select('key hwid status duration unit expires pausedTimeLeft createdAt source resellerId').lean();
        const formattedData = {};
        keys.forEach(k => {
            formattedData[k.key] = {
                hwid: k.hwid, status: k.status, duration: k.duration, unit: k.unit,
                expires: k.expires, pausedTimeLeft: k.pausedTimeLeft, createdAt: k.createdAt.getTime(),
                source: k.source || "MAIN", resellerIp: null, resellerId: k.resellerId 
            };
        });
        res.json(formattedData);
    } catch (err) { res.status(500).json({ status: "error" }); }
});

// 6. LIST RESELLER KEYS
app.get('/list-reseller', async (req, res) => {
    const { resellerKey } = req.query;
    if (!resellerKey) return res.status(400).json({ status: "error", message: "Missing Reseller Key" });
    try {
        const keys = await LicenseKey.find({ source: "RESELLER", resellerId: resellerKey }).select('key hwid status duration unit expires pausedTimeLeft createdAt source').lean();
        const formattedData = {};
        keys.forEach(k => {
            formattedData[k.key] = {
                hwid: k.hwid, status: k.status, duration: k.duration, unit: k.unit,
                expires: k.expires, pausedTimeLeft: k.pausedTimeLeft, createdAt: k.createdAt.getTime(), source: k.source
            };
        });
        res.json(formattedData);
    } catch (err) { res.status(500).json({ status: "error" }); }
});

// 7. TOGGLE PAUSE
app.get('/toggle-pause', async (req, res) => {
    const { password, key } = req.query;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ status: "error" });
    try {
        const keyData = await LicenseKey.findOne({ key: key });
        if (!keyData) return res.status(404).json({ status: "error", message: "Key not found" });

        if (keyData.status === "ACTIVE") {
            let timeLeft = new Date(keyData.expires) - new Date();
            if (timeLeft < 0) timeLeft = 0;
            keyData.pausedTimeLeft = timeLeft; keyData.status = "PAUSED";
            await keyData.save();
            return res.json({ status: "success", message: "Key Successfully Hold!" });
        } else if (keyData.status === "PAUSED") {
            let newExpires = new Date(); newExpires.setMilliseconds(newExpires.getMilliseconds() + keyData.pausedTimeLeft);
            keyData.expires = newExpires; keyData.pausedTimeLeft = null; keyData.status = "ACTIVE";
            await keyData.save();
            return res.json({ status: "success", message: "Key Successfully Resumed!" });
        }
        res.json({ status: "error", message: "Cannot pause UNUSED key" });
    } catch (err) { res.status(500).json({ status: "error" }); }
});

// 8. DELETE KEY
app.get('/delete', async (req, res) => {
    const { password, key } = req.query;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ status: "error" });
    try {
        const deleted = await LicenseKey.findOneAndDelete({ key: key });
        if (deleted) return res.json({ status: "success", message: "Keys Successfully Deleted" });
        res.status(404).json({ status: "error", message: "Not found" });
    } catch (err) { res.status(500).json({ status: "error" }); }
});

// 9. GET LATEST SCRIPT
app.post('/get-latest-script', async (req, res) => {
    const { key, hwid } = req.body;
    if (!key || !hwid) return res.status(400).json({ status: "error", message: "Missing Data" });

    try {
        const keyData = await LicenseKey.findOne({ key: key });
        if (!keyData) return res.status(404).json({ status: "error", message: "Key not found" });
        if (keyData.status === "PAUSED") return res.status(403).json({ status: "error", message: "Key is paused" });

        if (keyData.status === "UNUSED") {
            keyData.expires = calculateExpiry(keyData.unit, keyData.duration);
            keyData.hwid = hwid; keyData.status = "ACTIVE";
            await keyData.save();
        } else if (keyData.status === "ACTIVE") {
            if (keyData.hwid !== hwid) return res.status(403).json({ status: "error", message: "Key locked" });
            if (new Date() > keyData.expires) return res.status(403).json({ status: "error", message: "Key expired" });
        }

        const scriptPath = path.join(__dirname, 'latest_script.lua');
        if (!fs.existsSync(scriptPath)) return res.status(500).json({ status: "error", message: "Script file not found." });

        const scriptContent = fs.readFileSync(scriptPath, 'utf8');
        return res.json({ status: "success", script: scriptContent });
    } catch (err) {
        res.status(500).json({ status: "error", message: "Server Error" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Main Server running on port ${PORT}`));
