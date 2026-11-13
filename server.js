const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// PASSWORD (Nasa Render Environment Variable ito, hindi sa code)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "GeoDevs69"; 

// SUPABASE CONNECTION (Gamit ang keys mo)
const SUPABASE_URL = "https://mpycokvpdhbolugleypv.supabase.co"; 
const SUPABASE_KEY = "sb_publishable_1s5tfzxyqUYt5jcZ37fx-g_zHtT-gq5"; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// 1. GENERATE ROUTE
app.get('/generate', async (req, res) => {
    const { password, duration, unit } = req.query;

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ status: "error", message: "Invalid Admin Password" });
    }

    const key = `CODEX-${generateRandomString(4)}-${generateRandomString(4)}`;
    
    const { error } = await supabase
        .from('license_keys')
        .insert([{ 
            key: key, 
            duration: parseInt(duration), 
            unit: unit,
            status: "UNUSED",
            hwid: "WALA_PA",
            created_at: Date.now()
        }]);

    if (error) {
        console.error(error);
        return res.status(500).json({ status: "error", message: "Database Error" });
    }
    res.json({ status: "success", key: key });
});

// 2. VERIFY ROUTE (Lua Script)
app.post('/verify', async (req, res) => {
    const { key, hwid } = req.body;
    if (!key || !hwid) return res.status(400).json({ status: "error", message: "Missing Data" });

    const { data, error } = await supabase.from('license_keys').select('*').eq('key', key).single();
    
    if (error || !data) return res.status(404).json({ status: "invalid", message: "Key not found" });

    if (data.status === "PAUSED") return res.status(403).json({ status: "paused", message: "Key Successfully Hold!" });

    if (data.status === "UNUSED") {
        let expires = new Date();
        if (data.unit === 'seconds') expires.setSeconds(expires.getSeconds() + data.duration);
        else if (data.unit === 'minutes') expires.setMinutes(expires.getMinutes() + data.duration);
        else if (data.unit === 'hours') expires.setHours(expires.getHours() + data.duration);
        else if (data.unit === 'days') expires.setDate(expires.getDate() + data.duration);
        else if (data.unit === 'months') expires.setMonth(expires.getMonth() + data.duration);
        else if (data.unit === 'years') expires.setFullYear(expires.getFullYear() + data.duration);

        const { error: updateError } = await supabase
            .from('license_keys')
            .update({ expires: expires.toISOString(), hwid: hwid, status: "ACTIVE" })
            .eq('key', key);

        if (updateError) return res.status(500).json({ status: "error" });
        return res.json({ status: "success", message: "Key activated!" });
    }

    if (data.status === "ACTIVE") {
        if (data.hwid !== hwid) return res.status(403).json({ status: "hwid_mismatch", message: "Key locked to another device" });
        if (new Date() > new Date(data.expires)) return res.status(403).json({ status: "expired", message: "Key expired" });
        return res.json({ status: "success", message: "Valid" });
    }
});

// 3. LIST ROUTE
app.get('/list', async (req, res) => {
    if (req.query.password !== ADMIN_PASSWORD) return res.status(401).json({ status: "error" });
    
    const { data, error } = await supabase.from('license_keys').select('*');
    if (error) return res.status(500).json({ status: "error" });

    const formattedData = {};
    data.forEach(k => {
        formattedData[k.key] = {
            hwid: k.hwid, status: k.status, duration: k.duration, unit: k.unit,
            expires: k.expires, pausedTimeLeft: k.paused_time_left, createdAt: k.created_at
        };
    });
    res.json(formattedData);
});

// 4. PAUSE / RESUME
app.get('/toggle-pause', async (req, res) => {
    const { password, key } = req.query;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ status: "error" });

    const { data } = await supabase.from('license_keys').select('*').eq('key', key).single();
    if (!data) return res.status(404).json({ status: "error", message: "Key not found" });

    if (data.status === "ACTIVE") {
        let timeLeft = new Date(data.expires) - new Date();
        if (timeLeft < 0) timeLeft = 0;
        await supabase.from('license_keys').update({ paused_time_left: timeLeft, status: "PAUSED" }).eq('key', key);
        return res.json({ status: "success", message: "Key Successfully Hold!" });
    } 
    else if (data.status === "PAUSED") {
        let newExpires = new Date();
        newExpires.setMilliseconds(newExpires.getMilliseconds() + data.paused_time_left);
        await supabase.from('license_keys').update({ expires: newExpires.toISOString(), paused_time_left: null, status: "ACTIVE" }).eq('key', key);
        return res.json({ status: "success", message: "Key Successfully Resumed!" });
    }
    res.json({ status: "error", message: "Cannot pause UNUSED key" });
});

// 5. DELETE
app.get('/delete', async (req, res) => {
    const { password, key } = req.query;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ status: "error" });
    
    const { error } = await supabase.from('license_keys').delete().eq('key', key);
    if (error) return res.status(500).json({ status: "error" });
    res.json({ status: "success", message: "Keys Successfully Deleted" });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
