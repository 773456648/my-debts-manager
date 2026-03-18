const express = require('express');
const fs = require('fs');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = './heiba_royal_db.json';

// إعدادات التلجرام
const TELEGRAM_TOKEN = '7543475859:AAENXZxHPQZafOlvBwFr6EatUFD31iYq-ks';
const MY_CHAT_ID = '5042495708';
const ADMIN_PASSWORD = '771232690'; // كلمة السر الإجبارية

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

    // التحقق من الهوية (Chat ID) وكلمة السر (Password)
    if (chatId !== MY_CHAT_ID || !fullText.startsWith(ADMIN_PASSWORD)) {
        // إذا كان الشخص غريب أو لم يضع كلمة السر، لن يستجيب البوت نهائياً
        return res.sendStatus(200);
    }

    // استخراج الأمر بعد كلمة السر
    const cmd = fullText.replace(ADMIN_PASSWORD, "").trim();

    // 1. أمر الإحصائيات
    if (cmd === "العدد") {
        const total = db.users.length;
        const m = db.users.filter(u => u.type === 'merchant').length;
        const d = db.users.filter(u => u.type === 'debtor').length;
        sendToTelegram(`📊 **الإحصائيات:**\n\n👥 الكل: ${total}\n👑 تجار: ${m}\n👤 مواطنين: ${d}`);
    } 
    // 2. عرض الكل
    else if (cmd === "كل الأعضاء" || cmd === "كل العضا") {
        if (db.users.length === 0) return sendToTelegram("⚠️ القائمة فارغة.");
        let list = "📋 **قائمة الأعضاء:**\n";
        db.users.forEach((u, i) => {
            list += `\n${i + 1}. ${u.name} ${u.verified ? '✅' : ''} (${u.type === 'merchant' ? 'تاجر' : 'مواطن'})`;
        });
        sendToTelegram(list);
    }
    // 3. التوثيق (يوثق التاجر والمواطن معاً لنفس الاسم)
    else if (cmd.endsWith(" توثيق")) {
        const name = cmd.replace(" توثيق", "").trim();
        const targets = db.users.filter(u => u.name.toLowerCase() === name.toLowerCase());
        if (targets.length > 0) {
            targets.forEach(u => u.verified = true);
            saveDB();
            sendToTelegram(`✅ **تم التوثيق بنجاح:**\nتم توثيق كل الحسابات باسم [${name}]`);
        } else sendToTelegram(`❌ الاسم [${name}] غير موجود.`);
    }
    // 4. إلغاء التوثيق
    else if (cmd.endsWith(" الغاء توثيق")) {
        const name = cmd.replace(" الغاء توثيق", "").trim();
        const targets = db.users.filter(u => u.name.toLowerCase() === name.toLowerCase());
        if (targets.length > 0) {
            targets.forEach(u => u.verified = false);
            saveDB();
            sendToTelegram(`🚫 **إلغاء التوثيق:**\nتم للأسم [${name}]`);
        } else sendToTelegram(`❌ الاسم [${name}] غير موجود.`);
    }
    // 5. الحذف
    else if (cmd.endsWith(" حذف")) {
        const name = cmd.replace(" حذف", "").trim();
        const initialCount = db.users.length;
        db.users = db.users.filter(u => u.name.toLowerCase() !== name.toLowerCase());
        if (db.users.length < initialCount) {
            saveDB();
            sendToTelegram(`🗑 **تم الحذف:**\nجميع حسابات [${name}]`);
        } else sendToTelegram(`❌ الاسم [${name}] غير موجود.`);
    }
    // 6. البحث (إذا أرسلت كلمة السر + الاسم فقط)
    else {
        const name = cmd;
        const found = db.users.filter(u => u.name.toLowerCase() === name.toLowerCase());
        if (found.length > 0) {
            let rep = `📊 **بيانات الحساب [${name}]:**\n`;
            found.forEach(u => {
                let y=0, usd=0, s=0;
                (u.myRecords || []).forEach(r => {
                    const a = parseFloat(r.amount); const d = r.type === 'دين';
                    if(r.currency === 'YER') y+=d?a:-a; else if(r.currency === 'USD') usd+=d?a:-a; else s+=d?a:-a;
                });
                rep += `\n👤 النوع: ${u.type === 'merchant' ? 'تاجر' : 'مواطن'}\n✨ الحالة: ${u.verified ? 'موثق' : 'غير موثق'}\n🔑 السر: \`${u.password}\`\n💰 يمني: ${y}\n💵 دولار: ${usd}\n🇸🇦 سعودي: ${s}\n---`;
            });
            sendToTelegram(rep);
        } else {
            sendToTelegram(`🔍 لم يتم العثور على [${name}]`);
        }
    }
    res.sendStatus(200);
});

// باقي الأكواد الخاصة بـ API الموقع (auth, sync, check-status) تبقى كما هي لضمان عمل تطبيقك
app.post('/api/auth', async (req, res) => {
    const { name, password, type, action } = req.body;
    const normalizedName = name.trim().toLowerCase();
    const existingUser = db.users.find(u => u.name.toLowerCase() === normalizedName && u.type === type);
    if (action === 'reg') {
        if (existingUser) return res.status(400).json({ error: "الاسم مسجل مسبقاً." });
        const newUser = { id: "H" + Math.random().toString(36).substr(2, 7), name: name.trim(), password, type, myRecords: [], verified: false, createdAt: new Date().toISOString() };
        db.users.push(newUser);
        saveDB();
        sendToTelegram(`✨ **تسجيل جديد من الموقع:**\nالاسم: ${newUser.name}\nالنوع: ${type === 'merchant' ? 'تاجر' : 'مواطن'}`);
        return res.json(newUser);
    } else {
        const user = db.users.find(u => u.name.toLowerCase() === normalizedName && u.password === password && u.type === type);
        if (!user) return res.status(403).json({ error: "بيانات خاطئة." });
        return res.json(user);
    }
});

app.post('/api/update-pass', (req, res) => {
    const { userId, newPass } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (user) { user.password = newPass; saveDB(); res.json({ success: true }); }
    else res.status(404).send();
});

app.post('/api/sync', (req, res) => {
    const { userId, myRecords } = req.body;
    const idx = db.users.findIndex(u => u.id === userId);
    if (idx !== -1) { db.users[idx].myRecords = myRecords; saveDB(); res.json({ success: true }); }
    else res.status(404).send();
});

app.post('/api/check-status', (req, res) => {
    const { names, requesterId } = req.body; 
    const response = { statuses: {}, requesterStatus: null };
    if (names && Array.isArray(names)) {
        names.forEach(n => {
            const found = db.users.find(u => u.name.toLowerCase() === n.toLowerCase() && u.type === 'debtor');
            response.statuses[n] = { registered: !!found, verified: found ? !!found.verified : false };
        });
    }
    if (requesterId) {
        const reqUser = db.users.find(u => u.id === requesterId);
        if (reqUser) response.requesterStatus = { verified: !!reqUser.verified };
    }
    res.json(response);
});

app.get('/api/auto-discover', (req, res) => {
    const { debtorName } = req.query;
    if(!debtorName) return res.json([]);
    const results = db.users.filter(u => u.type === 'merchant' && u.myRecords.some(r => r.targetName.toLowerCase() === debtorName.toLowerCase()))
    .map(u => ({ merchantName: u.name, merchantVerified: u.verified || false, records: u.myRecords.filter(r => r.targetName.toLowerCase() === debtorName.toLowerCase()) }));
    res.json(results);
});

app.listen(PORT, () => console.log(`SERVER RUNNING`));
