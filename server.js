const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MAIN_PANEL_URL = process.env.MAIN_PANEL_URL || "https://codex-license-api.onrender.com";
const ADMIN_PASS = "CodexSquad101"; 

app.get('/list', async (req, res) => {
    const resellerKey = req.query.password;
    const deviceHwid = req.query.hwid;

    if (!resellerKey || !deviceHwid) {
        return res.status(401).json({ status: "error", message: "Missing Key or Device ID" });
    }

    try {
        const verifyRes = await fetch(`${MAIN_PANEL_URL}/verify-reseller`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: resellerKey, hwid: deviceHwid })
        });
        
        const verifyData = await verifyRes.json();

        if (verifyData.status !== "success") {
            return res.status(403).json({ status: "error", message: verifyData.message || "Access Denied" });
        }

        const response = await fetch(`${MAIN_PANEL_URL}/list?password=${ADMIN_PASS}`);
        const allKeys = await response.json();
        
        const resellerKeys = {};
        Object.keys(allKeys).forEach(k => {
            if (allKeys[k].source === "RESELLER") {
                resellerKeys[k] = allKeys[k];
            }
        });

        res.json(resellerKeys);

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: "error", message: "Server Error" });
    }
});

app.get('/generate', async (req, res) => {
    const { password, duration, unit, hwid } = req.query;
    
    try {
        const verifyRes = await fetch(`${MAIN_PANEL_URL}/verify-reseller`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: password, hwid: hwid })
        });
        const verifyData = await verifyRes.json();

        if (verifyData.status !== "success") {
            return res.status(403).json({ status: "error", message: "Invalid or Expired Reseller Key" });
        }

        const response = await fetch(`${MAIN_PANEL_URL}/api/reseller-generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resellerKey: password, duration, unit })
        });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        res.status(500).json({ status: "error", message: "Server Error" });
    }
});

app.get('/toggle-pause', async (req, res) => {
    const { password, key, hwid } = req.query;
    
    try {
        const verifyRes = await fetch(`${MAIN_PANEL_URL}/verify-reseller`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: password, hwid: hwid })
        });
        const verifyData = await verifyRes.json();

        if (verifyData.status !== "success") {
            return res.status(403).json({ status: "error", message: "Invalid or Expired Reseller Key" });
        }

        const response = await fetch(`${MAIN_PANEL_URL}/toggle-pause?password=${ADMIN_PASS}&key=${key}`);
        const data = await response.json();
        res.json(data);
    } catch (err) { res.status(500).json({ status: "error" }); }
});

app.get('/delete', async (req, res) => {
    const { password, key, hwid } = req.query;
    
    try {
        const verifyRes = await fetch(`${MAIN_PANEL_URL}/verify-reseller`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: password, hwid: hwid })
        });
        const verifyData = await verifyRes.json();

        if (verifyData.status !== "success") {
            return res.status(403).json({ status: "error", message: "Invalid or Expired Reseller Key" });
        }

        const response = await fetch(`${MAIN_PANEL_URL}/delete?password=${ADMIN_PASS}&key=${key}`);
        const data = await response.json();
        res.json(data);
    } catch (err) { res.status(500).json({ status: "error" }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Reseller Server running on port ${PORT}`));
