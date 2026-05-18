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
    cookie: { secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

const pool = new Pool({
    user: process.env.DB_USER || 'dulatamangeldy',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'barbershop_db',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
    ssl: false,
    connectionTimeoutMillis: 10000,
});

async function deleteOldAppointments() {
    try {
        const result = await pool.query(`
            DELETE FROM appointments 
            WHERE appointment_date < CURRENT_DATE - INTERVAL '4 days' 
            AND status IN ('completed', 'cancelled')
        `);
        if (result.rowCount > 0) {
            console.log(`🗑️ Удалено ${result.rowCount} старых записей`);
        }
    } catch (err) {
        console.error('❌ Ошибка удаления старых записей:', err.message);
    }
}

async function initDatabase() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name VARCHAR(100), email VARCHAR(100) UNIQUE, phone VARCHAR(20), provider VARCHAR(50), created_at TIMESTAMP DEFAULT NOW());`);
        await pool.query(`CREATE TABLE IF NOT EXISTS masters (id SERIAL PRIMARY KEY, name VARCHAR(100), specialization VARCHAR(100), experience INT, work_start TIME DEFAULT '10:00', work_end TIME DEFAULT '20:00', break_start TIME, break_end TIME);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS master_services (id SERIAL PRIMARY KEY, master_id INT REFERENCES masters(id), name VARCHAR(100), price DECIMAL(10,2), duration INT);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS appointments (id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), master_id INT REFERENCES masters(id), master_service_id INT REFERENCES master_services(id), appointment_date DATE, appointment_time TIME, status VARCHAR(20) DEFAULT 'pending', notes TEXT, created_at TIMESTAMP DEFAULT NOW());`);
        await pool.query(`CREATE TABLE IF NOT EXISTS admins (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE, name VARCHAR(100), created_at TIMESTAMP DEFAULT NOW());`);
        
        await pool.query(`ALTER TABLE masters ADD COLUMN IF NOT EXISTS break_start TIME;`);
        await pool.query(`ALTER TABLE masters ADD COLUMN IF NOT EXISTS break_end TIME;`);
        
        const masters = await pool.query('SELECT COUNT(*) FROM masters');
        if (parseInt(masters.rows[0].count) === 0) {
            await pool.query(`INSERT INTO masters (name, specialization, experience, work_start, work_end) VALUES 
                ('Алексей', 'Fade, классика', 8, '10:00', '20:00'),
                ('Дмитрий', 'Борода, усы', 5, '10:00', '20:00'),
                ('Максим', 'Детские стрижки', 10, '10:00', '19:00');`);
            console.log('✅ Добавлены мастера');
        }
        
        const services = await pool.query('SELECT COUNT(*) FROM master_services');
        if (parseInt(services.rows[0].count) === 0) {
            await pool.query(`INSERT INTO master_services (master_id, name, price, duration) VALUES 
                (1, 'Мужская стрижка', 8250, 60),
                (1, 'Стрижка + борода', 13750, 90),
                (2, 'Коррекция бороды', 4400, 30),
                (2, 'Бритьё головы', 5500, 30),
                (3, 'Детская стрижка', 6600, 45);`);
            console.log('✅ Добавлены услуги');
        }
        
        const admin = await pool.query("SELECT COUNT(*) FROM admins");
        if (parseInt(admin.rows[0].count) === 0) {
            await pool.query("INSERT INTO admins (email, name) VALUES ('admin@barbershop.com', 'Admin')");
            console.log('✅ Добавлен админ');
        }
        
        await deleteOldAppointments();
        console.log('✅ База данных инициализирована');
    } catch (err) {
        console.error('❌ Ошибка инициализации БД:', err.message);
    }
}

setInterval(deleteOldAppointments, 60 * 60 * 1000);

pool.connect(async (err) => {
    if (err) {
        console.error('❌ Ошибка БД:', err);
        console.log('\n💡 Попробуй запустить PostgreSQL: brew services start postgresql');
    } else {
        console.log('✅ PostgreSQL подключена');
        await initDatabase();
    }
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
        const { email, name } = payload;

        let user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (user.rows.length === 0) {
            user = await pool.query('INSERT INTO users (name, email, provider) VALUES ($1, $2, $3) RETURNING id, name, email, phone', [name, email, 'google']);
        }

        req.session.userId = user.rows[0].id;
        req.session.userName = user.rows[0].name;
        req.session.userEmail = user.rows[0].email;
        req.session.userPhone = user.rows[0].phone;

        const adminCheck = await pool.query('SELECT * FROM admins WHERE email = $1', [email]);
        req.session.isAdmin = adminCheck.rows.length > 0;
        req.session.save();

        res.json({ success: true, user: user.rows[0], isAdmin: req.session.isAdmin, needPhone: !user.rows[0].phone });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(401).json({ error: 'Ошибка авторизации' });
    }
});

app.post('/api/auth/update-phone', isAuthenticated, async (req, res) => {
    const { phone } = req.body;
    try {
        await pool.query('UPDATE users SET phone = $1 WHERE id = $2', [phone, req.session.userId]);
        req.session.userPhone = phone;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сохранения телефона' });
    }
});

app.post('/api/auth/admin/login', async (req, res) => {
    const { password } = req.body;
    
    if (password === '112233') {
        req.session.isAdmin = true;
        req.session.userName = 'Администратор';
        req.session.userEmail = 'admin@barbershop.com';
        req.session.save();
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Неверный пароль' });
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
        user: req.session.userId ? { 
            id: req.session.userId, 
            name: req.session.userName, 
            email: req.session.userEmail,
            phone: req.session.userPhone
        } : null
    });
});

// ============ БАРБЕРЫ ============
app.get('/api/masters', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM masters ORDER BY id');
        res.json(result.rows);
    } catch (err) {
        console.error('Masters error:', err);
        res.status(500).json({ error: 'Ошибка загрузки мастеров' });
    }
});

app.post('/api/masters', isAdmin, async (req, res) => {
    const { name, specialization, experience, work_start, work_end, break_start, break_end } = req.body;
    const result = await pool.query('INSERT INTO masters (name, specialization, experience, work_start, work_end, break_start, break_end) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [name, specialization, experience, work_start, work_end, break_start || null, break_end || null]);
    res.json(result.rows[0]);
});

app.put('/api/masters/:id', isAdmin, async (req, res) => {
    const { name, specialization, experience, work_start, work_end, break_start, break_end } = req.body;
    await pool.query('UPDATE masters SET name=$1, specialization=$2, experience=$3, work_start=$4, work_end=$5, break_start=$6, break_end=$7 WHERE id=$8', [name, specialization, experience, work_start, work_end, break_start, break_end, req.params.id]);
    res.json({ success: true });
});

app.delete('/api/masters/:id', isAdmin, async (req, res) => {
    await pool.query('DELETE FROM masters WHERE id = $1', [req.params.id]);
    res.json({ success: true });
});

app.get('/api/masters/:id/active-appointments', isAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.*, u.name as client_name, u.phone, ms.name as service_name, ms.price
            FROM appointments a
            JOIN users u ON a.user_id = u.id
            JOIN master_services ms ON a.master_service_id = ms.id
            WHERE a.master_id = $1 AND a.status != 'cancelled'
            ORDER BY a.appointment_date, a.appointment_time
        `, [req.params.id]);
        console.log(`📋 Найдено ${result.rows.length} записей для барбера ${req.params.id}`);
        res.json(result.rows);
    } catch (err) {
        console.error('Active appointments error:', err);
        res.status(500).json({ error: 'Ошибка загрузки записей' });
    }
});

// ============ УСЛУГИ ============
app.get('/api/masters/:id/services', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM master_services WHERE master_id = $1 ORDER BY price', [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        console.error('Services error:', err);
        res.status(500).json({ error: 'Ошибка загрузки услуг' });
    }
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

// ============ ЗАПИСИ ============
app.get('/api/appointments', isAdmin, async (req, res) => {
    const result = await pool.query(`SELECT a.*, u.name as client_name, u.phone, m.name as master_name, ms.name as service_name, ms.price as service_price FROM appointments a JOIN users u ON a.user_id = u.id JOIN masters m ON a.master_id = m.id LEFT JOIN master_services ms ON a.master_service_id = ms.id ORDER BY a.appointment_date DESC, a.appointment_time`);
    res.json(result.rows);
});

app.get('/api/my-appointments', isAuthenticated, async (req, res) => {
    const result = await pool.query(`SELECT a.*, m.name as master_name, ms.name as service_name, ms.price as service_price FROM appointments a JOIN masters m ON a.master_id = m.id LEFT JOIN master_services ms ON a.master_service_id = ms.id WHERE a.user_id = $1 AND a.appointment_date >= CURRENT_DATE - INTERVAL '4 days' ORDER BY a.appointment_date DESC, a.appointment_time DESC`, [req.session.userId]);
    res.json(result.rows);
});

app.get('/api/available-slots/:masterId/:date', async (req, res) => {
    try {
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
    } catch (err) {
        console.error('Available slots error:', err);
        res.status(500).json({ error: 'Ошибка загрузки слотов' });
    }
});

app.post('/api/appointments', isAuthenticated, async (req, res) => {
    const { master_id, master_service_id, date, time, phone, notes } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        if (phone) {
            await client.query('UPDATE users SET phone = $1 WHERE id = $2', [phone, req.session.userId]);
            req.session.userPhone = phone;
        }
        
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

app.put('/api/appointments/:id/cancel', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const result = await pool.query('SELECT user_id FROM appointments WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Запись не найдена' });
    if (result.rows[0].user_id !== req.session.userId) return res.status(403).json({ error: 'Нет прав' });
    await pool.query('UPDATE appointments SET status = $1 WHERE id = $2', ['cancelled', id]);
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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.listen(PORT, () => {
    console.log(`🚀 Сервер: http://localhost:${PORT}`);
    console.log(`👨‍💼 Админка: http://localhost:${PORT}/admin`);
});
