const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const crypto = require('crypto'); 
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SHA-1 HASH ng "GeoDevs69"
const ADMIN_HASH = "8a9eba55536f499ead8b472e234820b7cb4e5d94"; 

// MONGODB CONNECTION
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://geodevz69:GeoDevs69@cluster0.leanvjg.mongodb.net/licenseDB?retryWrites=true&w=majority";

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

// VERIFY LOGIN ROUTE
app.post('/login', (req, res) => {
    const { password } = req.body;
    
    if (!password) return res.status(400).json({ status: "error", message: "No password" });
    
    // Iha-hash ng server yung tinype
    const inputHash = crypto.createHash('sha1').update(password).digest('hex');
    
    // Ikukumpara sa hash
    if (inputHash === ADMIN_HASH) {
        res.json({ status: "success" });
    } else {
        res.status(401).json({ status: "error", message: "Invalid Password" });
    }
});

// GENERATE ROUTE (Naka-verify pa rin sa server)
app.get('/generate', async (req, res) => {
    const { password, duration, unit } = req.query;

    const inputHash = crypto.createHash('sha1').update(password).digest('hex');
    if (inputHash !== ADMIN_HASH) {
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
        res.status(500).json({ status: "error", message: "Database Error" });
    }
});

// VERIFY ROUTE (Para sa Lua Script)
app.post('/verify', async (req, res) => {
    const { key, hwid } = req.body;
    if (!key || !hwid) return res.status(400).json({ status: "error", message: "Missing Data" });

    try {
        const keyData = await LicenseKey.findOne({ key: key });
        if (!keyData) return res.status(404).json({ status: "invalid", message: "Key not found" });

        if (keyData.status === "PAUSED") return res.status(403).json({ status: "paused", message: "Key Successfully Hold!" });

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
            if (new Date() > keyData.expires) return res.status(403).json({ status: "expired", message: "Key expired" });
            return res.json({ status: "success", message: "Valid" });
        }
    } catch (err) {
        res.status(500).json({ status: "error", message: "Server Error" });
    }
});

// LIST ROUTE
app.get('/list', async (req, res) => {
    const { password } = req.query;
    const inputHash = crypto.createHash('sha1').update(password).digest('hex');
    if (inputHash !== ADMIN_HASH) return res.status(401).json({ status: "error" });
    
    try {
        const keys = await LicenseKey.find();
        const formattedData = {};
        keys.forEach(k => {
            formattedData[k.key] = {
                hwid: k.hwid, status: k.status, duration: k.duration, unit: k.unit,
                expires: k.expires, pausedTimeLeft: k.pausedTimeLeft, createdAt: k.createdAt.getTime()
            };
        });
        res.json(formattedData);
    } catch (err) {
        res.status(500).json({ status: "error" });
    }
});

// PAUSE / RESUME
app.get('/toggle-pause', async (req, res) => {
    const { password, key } = req.query;
    const inputHash = crypto.createHash('sha1').update(password).digest('hex');
    if (inputHash !== ADMIN_HASH) return res.status(401).json({ status: "error" });

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
        res.status(500).json({ status: "error" });
    }
});

// DELETE
app.get('/delete', async (req, res) => {
    const { password, key } = req.query;
    const inputHash = crypto.createHash('sha1').update(password).digest('hex');
    if (inputHash !== ADMIN_HASH) return res.status(401).json({ status: "error" });
    
    try {
        const deleted = await LicenseKey.findOneAndDelete({ key: key });
        if (deleted) return res.json({ status: "success", message: "Keys Successfully Deleted" });
        res.status(404).json({ status: "error", message: "Not found" });
    } catch (err) {
        res.status(500).json({ status: "error" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
