const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_PASSWORD = "CodexSquad101"; 
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
    createdAt: { type: Date, default: Date.now },
    source: { type: String, default: "MAIN" },
    resellerIp: { type: String, default: null },
    resellerId: { type: String, default: null } 
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

// 🔥 1. Generate (Para sa Main Admin)
app.get('/generate', async (req, res) => {
    const { password, duration, unit } = req.query;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ status: "error", message: "Invalid Admin Password" });

    const key = `CODEX-${generateRandomString(4)}-${generateRandomString(4)}`;
    const newKey = new LicenseKey({ key, duration: parseInt(duration), unit, source: "MAIN" });

    try {
        await newKey.save();
        res.json({ status: "success", key: key });
    } catch (err) {
        res.status(500).json({ status: "error", message: "Database Error" });
    }
});

// 🔥 2. Generate (Para sa Reseller Panel)
app.post('/api/reseller-generate', async (req, res) => {
    const { resellerKey, duration, unit } = req.body;

    if (!resellerKey) return res.status(400).json({ status: "error", message: "Reseller Key Required" });

    try {
        const resellerData = await LicenseKey.findOne({ key: resellerKey });
        if (!resellerData || resellerData.source !== "MAIN") {
            return res.status(401).json({ status: "error", message: "Invalid Reseller Key" });
        }
        if (resellerData.status === "PAUSED") {
            return res.status(403).json({ status: "error", message: "Reseller Access Revoked" });
        }
        if (resellerData.status === "ACTIVE" && new Date() > resellerData.expires) {
            return res.status(403).json({ status: "error", message: "Reseller Key Expired" });
        }

        const key = `CODEX-${generateRandomString(4)}-${generateRandomString(4)}`;
        const newKey = new LicenseKey({ key, duration: parseInt(duration), unit, source: "RESELLER" });
        await newKey.save();

        res.json({ status: "success", key: key });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: "error", message: "Server Error" });
    }
});

// 🔥 3. Verify (Para sa GG Script / App Source / APK)
app.post('/verify', async (req, res) => {
    const { key, hwid } = req.body;
    if (!key || !hwid) return res.status(400).json({ status: "error", message: "Missing Data" });

    try {
        const keyData = await LicenseKey.findOne({ key: key });
        if (!keyData) return res.status(404).json({ status: "invalid", message: "Key not found" });

        if (keyData.status === "PAUSED") return res.status(403).json({ status: "paused", message: "Key Successfully Hold!" });

        // 🔥 KAPAG UNUSED, I-ACTIVATE
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

        // 🔥 KAPAG ACTIVE, I-CHECK KUNG TAMA ANG HWID
        if (keyData.status === "ACTIVE") {
            // Kung ang naka-save ay IP address (galing sa Reseller Login), i-update sa totoong HWID ng device
            if (keyData.hwid && keyData.hwid.includes(".") && keyData.hwid !== hwid) {
                keyData.hwid = hwid; 
                await keyData.save();
                return res.json({ status: "success", message: "Key activated!" });
            }
            
            if (keyData.hwid !== hwid) return res.status(403).json({ status: "hwid_mismatch", message: "Key locked to another device" });
            const now = new Date();
            if (now > keyData.expires) return res.status(403).json({ status: "expired", message: "Key expired" });
            return res.json({ status: "success", message: "Valid" });
        }
    } catch (err) {
        res.status(500).json({ status: "error", message: "Server Error" });
    }
});

// 🔥 4. Verify Reseller (Para sa Second Panel Login - Dito nangyayari ang activation)
app.post('/verify-reseller', async (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ status: "error", message: "Missing Key" });

    try {
        // Kunin ang Public IP Address ng Reseller
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown IP";
        const ipOnly = clientIp.split(',')[0].trim();

        const keyData = await LicenseKey.findOne({ key: key });
        
        if (!keyData) return res.status(404).json({ status: "invalid", message: "Key not found" });
        if (keyData.source !== "MAIN") return res.status(403).json({ status: "error", message: "Not a Main Key" });

        if (keyData.status === "PAUSED") return res.status(403).json({ status: "paused", message: "Key is paused" });

        // 🔥 KAPAG UNUSED, GAWING ACTIVE AT I-SAVE ANG IP PARA MAG-COUNTDOWN
        if (keyData.status === "UNUSED") {
            let expires = new Date();
            if (keyData.unit === 'seconds') expires.setSeconds(expires.getSeconds() + keyData.duration);
            else if (keyData.unit === 'minutes') expires.setMinutes(expires.getMinutes() + keyData.duration);
            else if (keyData.unit === 'hours') expires.setHours(expires.getHours() + keyData.duration);
            else if (keyData.unit === 'days') expires.setDate(expires.getDate() + keyData.duration);
            else if (keyData.unit === 'months') expires.setMonth(expires.getMonth() + keyData.duration);
            else if (keyData.unit === 'years') expires.setFullYear(expires.getFullYear() + keyData.duration);

            keyData.expires = expires;
            keyData.hwid = ipOnly; // I-save ang IP sa HWID field
            keyData.status = "ACTIVE";
            keyData.resellerId = "Reseller"; 
            await keyData.save();
        } 
        // Kapag ACTIVE na, check kung expired na
        else if (keyData.status === "ACTIVE") {
            if (new Date() > keyData.expires) {
                return res.status(403).json({ status: "expired", message: "Reseller Key Expired" });
            }
        }

        return res.json({ status: "success", message: "Valid Reseller Key" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: "error", message: "Server Error" });
    }
});

// 🔥 5. List (Ibabalik lahat, may source at IP)
app.get('/list', async (req, res) => {
    if (req.query.password !== ADMIN_PASSWORD) return res.status(401).json({ status: "error" });
    try {
        const keys = await LicenseKey.find();
        const formattedData = {};
        keys.forEach(k => {
            formattedData[k.key] = {
                hwid: k.hwid, status: k.status, duration: k.duration, unit: k.unit,
                expires: k.expires, pausedTimeLeft: k.pausedTimeLeft, createdAt: k.createdAt.getTime(),
                source: k.source || "MAIN",
                resellerIp: k.resellerIp, 
                resellerId: k.resellerId 
            };
        });
        res.json(formattedData);
    } catch (err) { res.status(500).json({ status: "error" }); }
});

// 🔥 6. Toggle Pause
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
        } else if (keyData.status === "PAUSED") {
            let newExpires = new Date();
            newExpires.setMilliseconds(newExpires.getMilliseconds() + keyData.pausedTimeLeft);
            keyData.expires = newExpires;
            keyData.pausedTimeLeft = null;
            keyData.status = "ACTIVE";
            await keyData.save();
            return res.json({ status: "success", message: "Key Successfully Resumed!" });
        }
        res.json({ status: "error", message: "Cannot pause UNUSED key" });
    } catch (err) { res.status(500).json({ status: "error" }); }
});

// 🔥 7. Delete
app.get('/delete', async (req, res) => {
    const { password, key } = req.query;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ status: "error" });
    try {
        const deleted = await LicenseKey.findOneAndDelete({ key: key });
        if (deleted) return res.json({ status: "success", message: "Keys Successfully Deleted" });
        res.status(404).json({ status: "error", message: "Not found" });
    } catch (err) { res.status(500).json({ status: "error" }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Main Server running on port ${PORT}`));
