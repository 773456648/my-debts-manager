const express = require('express');
const fs = require('fs');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = './heiba_royal_db.json';

const TELEGRAM_TOKEN = '7543475859:AAENXZxHPQZafOlvBwFr6EatUFD31iYq-ks';
const MY_CHAT_ID = '5042495708';
const ADMIN_PASSWORD = '771232690'; 

app.use(express.json());
app.use(express.static('public'));

let db = { users: [] };
if (fs.existsSync(DB_PATH)) {
    try { db = JSON.parse(fs.readFileSync(DB_PATH)); } catch (e) { db = { users: [] }; }
}

const saveDB = () => fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

async function sendToTelegram(message) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: MY_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (e) { console.error("Telegram Error"); }
}

app.post('/api/tg-webhook', async (req, res) => {
    const update = req.body;
    if (!update.message || !update.message.text) return res.sendStatus(200);
    
    const chatId = String(update.message.chat.id);
    const fullText = update.message.text.trim();

    if (chatId !== MY_CHAT_ID || !fullText.startsWith(ADMIN_PASSWORD)) return res.sendStatus(200);

    const cmd = fullText.replace(ADMIN_PASSWORD, "").trim();

    if (cmd === "العدد") {
        const total = db.users.length;
        sendToTelegram(`📊 الإجمالي: ${total}`);
    } 
    else if (cmd === "كل الأعضاء" || cmd === "كل العضا") {
        if (db.users.length === 0) return sendToTelegram("⚠️ فارغة.");
        let list = "📋 الأعضاء:\n";
        db.users.forEach((u, i) => { list += `\n${i + 1}. ${u.name} ${u.verified ? '✅' : ''}`; });
        sendToTelegram(list);
    }
    // التعديل هنا: البحث عن كلمة "الغاء توثيق" أولاً
    else if (cmd.includes("الغاء توثيق")) {
        const name = cmd.replace("الغاء توثيق", "").trim();
        const targets = db.users.filter(u => u.name.toLowerCase() === name.toLowerCase());
        if (targets.length > 0) {
            targets.forEach(u => u.verified = false);
            saveDB();
            sendToTelegram(`🚫 تم إلغاء التوثيق للأسم: [${name}]`);
        } else sendToTelegram(`❌ لم أجد اسم [${name}] في القاعدة.`);
    }
    else if (cmd.includes("توثيق")) {
        const name = cmd.replace("توثيق", "").trim();
        const targets = db.users.filter(u => u.name.toLowerCase() === name.toLowerCase());
        if (targets.length > 0) {
            targets.forEach(u => u.verified = true);
            saveDB();
            sendToTelegram(`✅ تم توثيق حسابات [${name}]`);
        } else sendToTelegram(`❌ لم أجد اسم [${name}]`);
    }
    else if (cmd.includes("حذف")) {
        const name = cmd.replace("حذف", "").trim();
        const initialCount = db.users.length;
        db.users = db.users.filter(u => u.name.toLowerCase() !== name.toLowerCase());
        if (db.users.length < initialCount) {
            saveDB();
            sendToTelegram(`🗑 تم حذف [${name}]`);
        } else sendToTelegram(`❌ لم أجد [${name}]`);
    }
    else {
        // بحث عادي
        const found = db.users.filter(u => u.name.toLowerCase() === cmd.toLowerCase());
        if (found.length > 0) {
            let rep = `📊 بيانات [${cmd}]:\n`;
            found.forEach(u => { rep += `\n👤 النوع: ${u.type}\n✨ الحالة: ${u.verified ? 'موثق' : 'غير موثق'}`; });
            sendToTelegram(rep);
        } else sendToTelegram(`🔍 [${cmd}] غير موجود.`);
    }
    res.sendStatus(200);
});

// باقي الكود (API) يبقى كما هو...
app.listen(PORT, () => console.log(`SERVER RUNNING`));