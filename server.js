const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const session = require('express-session');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '615787033029-8scnkebqknccvuvs4blm7r82814eef3m.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'barbershop_super_secret_2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 дней
}));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://barber_user:admin123@localhost:5432/barbershop_db',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.connect((err) => {
    if (err) console.error('❌ Ошибка БД:', err);
    else console.log('✅ PostgreSQL подключена');
});

const isAdmin = (req, res, next) => {
    if (req.session.isAdmin) return next();
    res.status(401).json({ error: 'Не авторизован' });
};

const isAuthenticated = (req, res, next) => {
    if (req.session.userId) return next();
    res.status(401).json({ error: 'Требуется авторизация' });
};

// ============ АВТОРИЗАЦИЯ ============
app.post('/api/auth/google', async (req, res) => {
    const { credential } = req.body;
    try {
        const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        const { email, name, picture } = payload;

        let user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (user.rows.length === 0) {
            user = await pool.query('INSERT INTO users (name, email, photo, provider) VALUES ($1, $2, $3, $4) RETURNING *', [name, email, picture, 'google']);
        }

        req.session.userId = user.rows[0].id;
        req.session.userName = user.rows[0].name;
        req.session.userEmail = user.rows[0].email;

        const adminCheck = await pool.query('SELECT * FROM admins WHERE email = $1', [email]);
        req.session.isAdmin = adminCheck.rows.length > 0;
        req.session.save();

        res.json({ success: true, user: user.rows[0], isAdmin: req.session.isAdmin });
    } catch (error) {
        res.status(401).json({ error: 'Ошибка авторизации' });
    }
});

app.post('/api/auth/admin/login', async (req, res) => {
    const { email } = req.body;
    const adminCheck = await pool.query('SELECT * FROM admins WHERE email = $1', [email]);
    
    if (adminCheck.rows.length > 0) {
        req.session.isAdmin = true;
        req.session.userName = 'Администратор';
        req.session.userEmail = email;
        req.session.save();
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Доступ запрещён' });
    }
});

app.get('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/auth/check', (req, res) => {
    res.json({
        isAuthenticated: !!req.session.userId,
        isAdmin: req.session.isAdmin || false,
        user: req.session.userId ? { id: req.session.userId, name: req.session.userName, email: req.session.userEmail } : null
    });
});

// ============ БАРБЕРЫ ============
app.get('/api/masters', async (req, res) => {
    const result = await pool.query('SELECT * FROM masters ORDER BY id');
    res.json(result.rows);
});

app.post('/api/masters', isAdmin, async (req, res) => {
    const { name, specialization, experience, photo_url, work_start, work_end, break_start, break_end } = req.body;
    const result = await pool.query(
        'INSERT INTO masters (name, specialization, experience, photo_url, work_start, work_end, break_start, break_end) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [name, specialization, experience, photo_url, work_start, work_end, break_start || null, break_end || null]
    );
    res.json(result.rows[0]);
});

app.put('/api/masters/:id', isAdmin, async (req, res) => {
    const { name, specialization, experience, photo_url, work_start, work_end, break_start, break_end } = req.body;
    await pool.query('UPDATE masters SET name=$1, specialization=$2, experience=$3, photo_url=$4, work_start=$5, work_end=$6, break_start=$7, break_end=$8 WHERE id=$9', [name, specialization, experience, photo_url, work_start, work_end, break_start, break_end, req.params.id]);
    res.json({ success: true });
});

app.delete('/api/masters/:id', isAdmin, async (req, res) => {
    await pool.query('DELETE FROM masters WHERE id = $1', [req.params.id]);
    res.json({ success: true });
});

// ============ УСЛУГИ ============
app.get('/api/masters/:id/services', async (req, res) => {
    const result = await pool.query('SELECT * FROM master_services WHERE master_id = $1 ORDER BY price', [req.params.id]);
    res.json(result.rows);
});

app.post('/api/masters/:id/services', isAdmin, async (req, res) => {
    const { name, price, duration } = req.body;
    const result = await pool.query('INSERT INTO master_services (master_id, name, price, duration) VALUES ($1,$2,$3,$4) RETURNING *', [req.params.id, name, price, duration]);
    res.json(result.rows[0]);
});

app.delete('/api/masters/:masterId/services/:serviceId', isAdmin, async (req, res) => {
    await pool.query('DELETE FROM master_services WHERE id = $1 AND master_id = $2', [req.params.serviceId, req.params.masterId]);
    res.json({ success: true });
});

// ============ ПОЛЬЗОВАТЕЛИ ============
app.get('/api/users', isAdmin, async (req, res) => {
    const result = await pool.query('SELECT u.*, COUNT(a.id) as total_appointments FROM users u LEFT JOIN appointments a ON u.id = a.user_id GROUP BY u.id ORDER BY u.created_at DESC');
    res.json(result.rows);
});

app.delete('/api/users/:id', isAdmin, async (req, res) => {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
});

// ============ ЗАПИСИ (С ВОЗМОЖНОСТЬЮ ОТМЕНЫ) ============
app.get('/api/appointments', isAdmin, async (req, res) => {
    const result = await pool.query(`SELECT a.*, u.name as client_name, u.phone, m.name as master_name, ms.name as service_name, ms.price as service_price FROM appointments a JOIN users u ON a.user_id = u.id JOIN masters m ON a.master_id = m.id LEFT JOIN master_services ms ON a.master_service_id = ms.id ORDER BY a.appointment_date DESC, a.appointment_time`);
    res.json(result.rows);
});

app.get('/api/my-appointments', isAuthenticated, async (req, res) => {
    const result = await pool.query(`SELECT a.*, m.name as master_name, ms.name as service_name, ms.price as service_price FROM appointments a JOIN masters m ON a.master_id = m.id LEFT JOIN master_services ms ON a.master_service_id = ms.id WHERE a.user_id = $1 ORDER BY a.appointment_date DESC, a.appointment_time DESC`, [req.session.userId]);
    res.json(result.rows);
});

app.get('/api/available-slots/:masterId/:date', async (req, res) => {
    const { masterId, date } = req.params;
    const master = await pool.query('SELECT work_start, work_end, break_start, break_end FROM masters WHERE id = $1', [masterId]);
    if (master.rows.length === 0) return res.json([]);
    const workStart = parseInt(master.rows[0].work_start.split(':')[0]);
    const workEnd = parseInt(master.rows[0].work_end.split(':')[0]);
    const breakStart = master.rows[0].break_start ? parseInt(master.rows[0].break_start.split(':')[0]) : null;
    const breakEnd = master.rows[0].break_end ? parseInt(master.rows[0].break_end.split(':')[0]) : null;
    const booked = await pool.query('SELECT appointment_time FROM appointments WHERE master_id = $1 AND appointment_date = $2 AND status != $3', [masterId, date, 'cancelled']);
    const bookedTimes = booked.rows.map(r => r.appointment_time);
    const slots = [];
    for (let hour = workStart; hour < workEnd; hour++) {
        if (breakStart && breakEnd && hour >= breakStart && hour < breakEnd) continue;
        const time = `${hour.toString().padStart(2, '0')}:00:00`;
        if (!bookedTimes.includes(time)) slots.push(time);
    }
    res.json(slots);
});

app.post('/api/appointments', isAuthenticated, async (req, res) => {
    const { master_id, master_service_id, date, time, notes } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const duplicate = await client.query('SELECT id FROM appointments WHERE master_id = $1 AND appointment_date = $2 AND appointment_time = $3 AND status != $4', [master_id, date, time, 'cancelled']);
        if (duplicate.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Это время уже занято' });
        }
        await client.query('INSERT INTO appointments (user_id, master_id, master_service_id, appointment_date, appointment_time, notes) VALUES ($1,$2,$3,$4,$5,$6)', [req.session.userId, master_id, master_service_id, date, time, notes]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ОТМЕНА ЗАПИСИ (пользователем)
app.put('/api/appointments/:id/cancel', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const result = await pool.query('SELECT user_id FROM appointments WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Запись не найдена' });
    if (result.rows[0].user_id !== req.session.userId) return res.status(403).json({ error: 'Нет прав' });
    await pool.query('UPDATE appointments SET status = $1 WHERE id = $2', ['cancelled', id]);
    res.json({ success: true });
});

// ИЗМЕНЕНИЕ ЗАПИСИ (пользователем)
app.put('/api/appointments/:id', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { master_id, master_service_id, appointment_date, appointment_time } = req.body;
    
    const result = await pool.query('SELECT user_id FROM appointments WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Запись не найдена' });
    if (result.rows[0].user_id !== req.session.userId) return res.status(403).json({ error: 'Нет прав' });
    
    const duplicate = await pool.query('SELECT id FROM appointments WHERE master_id = $1 AND appointment_date = $2 AND appointment_time = $3 AND status != $4 AND id != $5', [master_id, appointment_date, appointment_time, 'cancelled', id]);
    if (duplicate.rows.length > 0) return res.status(409).json({ error: 'Это время уже занято' });
    
    await pool.query('UPDATE appointments SET master_id=$1, master_service_id=$2, appointment_date=$3, appointment_time=$4 WHERE id=$5', [master_id, master_service_id, appointment_date, appointment_time, id]);
    res.json({ success: true });
});

app.put('/api/appointments/:id/status', isAdmin, async (req, res) => {
    await pool.query('UPDATE appointments SET status = $1 WHERE id = $2', [req.body.status, req.params.id]);
    res.json({ success: true });
});

app.delete('/api/appointments/:id', isAdmin, async (req, res) => {
    await pool.query('DELETE FROM appointments WHERE id = $1', [req.params.id]);
    res.json({ success: true });
});

// ============ СТАТИСТИКА ============
app.get('/api/stats', isAdmin, async (req, res) => {
    const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
    const totalAppointments = await pool.query('SELECT COUNT(*) FROM appointments');
    const todayAppointments = await pool.query("SELECT COUNT(*) FROM appointments WHERE appointment_date = CURRENT_DATE");
    const revenue = await pool.query("SELECT COALESCE(SUM(ms.price), 0) as total FROM appointments a JOIN master_services ms ON a.master_service_id = ms.id WHERE a.status = 'completed'");
    res.json({
        clients: parseInt(totalUsers.rows[0].count),
        appointments: parseInt(totalAppointments.rows[0].count),
        today: parseInt(todayAppointments.rows[0].count),
        revenue: parseInt(revenue.rows[0].total)
    });
});

// ============ СТРАНИЦЫ ============
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));

app.listen(PORT, () => {
    console.log(`🚀 Сервер: http://localhost:${PORT}`);
    console.log(`👨‍💼 Админка: http://localhost:${PORT}/admin`);
});
