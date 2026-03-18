const express = require('express');
const fs = require('fs');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 3000;
const DB_PATH = './heiba_royal_db.json';

// إعدادات التلجرام
const TELEGRAM_TOKEN = '7543475859:AAENXZxHPQZafOlvBwFr6EatUFD31iYq-ks';
const MY_CHAT_ID = '5042495708';
const ADMIN_PASSWORD = '771232690'; 

app.use(express.json());
app.use(express.static('public'));

// قاعدة البيانات
let db = { users: [] };
if (fs.existsSync(DB_PATH)) {
    try { 
        db = JSON.parse(fs.readFileSync(DB_PATH)); 
    } catch (e) { 
        db = { users: [] }; 
    }
}

const saveDB = () => fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

// دالة إرسال الرسائل لتليجرام
async function sendToTelegram(message) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: MY_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (e) { 
        console.error("خطأ في إرسال التليجرام"); 
    }
}

// الـ Webhook الخاص بتليجرام
app.post('/api/tg-webhook', async (req, res) => {
    const update = req.body;
    if (!update.message || !update.message.text) return res.sendStatus(200);
    
    const chatId = String(update.message.chat.id);
    const fullText = update.message.text.trim();

    // التحقق من الهوية وكلمة السر الإجبارية في بداية كل رسالة
    if (chatId !== MY_CHAT_ID || !fullText.startsWith(ADMIN_PASSWORD)) {
        return res.sendStatus(200);
    }

    // استخراج الأمر الفعلي بعد حذف كلمة السر من البداية
    const cmd = fullText.substring(ADMIN_PASSWORD.length).trim();

    if (!cmd) return res.sendStatus(200);

    // 1. أمر الإحصائيات
    if (cmd === "العدد") {
        const total = db.users.length;
        const m = db.users.filter(u => u.type === 'merchant').length;
        const d = db.users.filter(u => u.type === 'debtor').length;
        await sendToTelegram(`📊 *الإحصائيات:*\n\n👥 الكل: ${total}\n👑 تجار: ${m}\n👤 مواطنين: ${d}`);
    } 
    // 2. عرض الكل
    else if (cmd === "كل الأعضاء" || cmd === "كل العضا") {
        if (db.users.length === 0) return sendToTelegram("⚠️ القائمة فارغة.");
        let list = "📋 *قائمة الأعضاء:*\n";
        db.users.forEach((u, i) => {
            list += `\n${i + 1}. ${u.name} ${u.verified ? '✅' : ''} (${u.type === 'merchant' ? 'تاجر' : 'مواطن'})`;
        });
        await sendToTelegram(list);
    }
    // 3. التوثيق
    else if (cmd.endsWith(" توثيق")) {
        const name = cmd.replace(" توثيق", "").trim();
        const targets = db.users.filter(u => u.name.toLowerCase() === name.toLowerCase());
        if (targets.length > 0) {
            targets.forEach(u => u.verified = true);
            saveDB();
            await sendToTelegram(`✅ *تم التوثيق:* [${name}]`);
        } else await sendToTelegram(`❌ الاسم [${name}] غير موجود.`);
    }
    // 4. إلغاء التوثيق
    else if (cmd.endsWith(" الغاء توثيق")) {
        const name = cmd.replace(" الغاء توثيق", "").trim();
        const targets = db.users.filter(u => u.name.toLowerCase() === name.toLowerCase());
        if (targets.length > 0) {
            targets.forEach(u => u.verified = false);
            saveDB();
            await sendToTelegram(`🚫 *إلغاء التوثيق:* [${name}]`);
        } else await sendToTelegram(`❌ الاسم [${name}] غير موجود.`);
    }
    // 5. الحذف
    else if (cmd.endsWith(" حذف")) {
        const name = cmd.replace(" حذف", "").trim();
        const initialCount = db.users.length;
        db.users = db.users.filter(u => u.name.toLowerCase() !== name.toLowerCase());
        if (db.users.length < initialCount) {
            saveDB();
            await sendToTelegram(`🗑 *تم الحذف:* جميع حسابات [${name}]`);
        } else await sendToTelegram(`❌ الاسم [${name}] غير موجود.`);
    }
    // 6. البحث التفصيلي
    else {
        const name = cmd;
        const found = db.users.filter(u => u.name.toLowerCase() === name.toLowerCase());
        if (found.length > 0) {
            let rep = `📊 *بيانات الحساب [${name}]:*\n`;
            found.forEach(u => {
                let y = 0, usd = 0, s = 0;
                (u.myRecords || []).forEach(r => {
                    const amt = parseFloat(r.amount) || 0;
                    const isDebt = (r.type === 'دين');
                    if(r.currency === 'YER') y += isDebt ? amt : -amt;
                    else if(r.currency === 'USD') usd += isDebt ? amt : -amt;
                    else if(r.currency === 'SAR') s += isDebt ? amt : -amt;
                });
                rep += `\n👤 النوع: ${u.type === 'merchant' ? 'تاجر' : 'مواطن'}\n✨ الحالة: ${u.verified ? '✅ موثق' : '❌ غير موثق'}\n🔑 السر: \`${u.password}\`\n💰 يمني: ${y}\n💵 دولار: ${usd}\n🇸🇦 سعودي: ${s}\n---`;
            });
            await sendToTelegram(rep);
        } else {
            await sendToTelegram(`🔍 لم يتم العثور على [${name}]`);
        }
    }
    res.sendStatus(200);
});

// --- API الموقع ---

app.post('/api/auth', (req, res) => {
    const { name, password, type, action } = req.body;
    if(!name || !password) return res.status(400).json({error: "بيانات ناقصة"});
    
    const normalizedName = name.trim().toLowerCase();
    const userIndex = db.users.findIndex(u => u.name.toLowerCase() === normalizedName && u.type === type);

    if (action === 'reg') {
        if (userIndex !== -1) return res.status(400).json({ error: "الاسم مسجل مسبقاً." });
        const newUser = { 
            id: "H" + Math.random().toString(36).substr(2, 7), 
            name: name.trim(), 
            password, 
            type, 
            myRecords: [], 
            verified: false, 
            createdAt: new Date().toISOString() 
        };
        db.users.push(newUser);
        saveDB();
        sendToTelegram(`✨ *تسجيل جديد:*\nالاسم: ${newUser.name}\nالنوع: ${type === 'merchant' ? 'تاجر' : 'مواطن'}`);
        return res.json(newUser);
    } else {
        const user = db.users[userIndex];
        if (!user || user.password !== password) return res.status(403).json({ error: "بيانات خاطئة." });
        return res.json(user);
    }
});

app.post('/api/sync', (req, res) => {
    const { userId, myRecords } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (user) { 
        user.myRecords = myRecords; 
        saveDB(); 
        res.json({ success: true }); 
    } else res.status(404).json({error: "المستخدم غير موجود"});
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

app.listen(PORT, () => console.log(`سيرفر هيبة رويال يعمل على منفذ ${PORT}`));