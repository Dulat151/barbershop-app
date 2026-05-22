const fs = require('fs');
let server = fs.readFileSync('server.js', 'utf8');

const newSlotsFunction = `
app.get('/api/available-slots/:masterId/:date', async (req, res) => {
    try {
        const { masterId, date } = req.params;
        
        // Получаем рабочее время мастера
        const master = await pool.query('SELECT work_start, work_end, day_off FROM masters WHERE id = $1', [masterId]);
        if (master.rows.length === 0) return res.json([]);
        
        // Проверка выходного дня
        if (master.rows[0].day_off) {
            const dayNames = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
            const dateDay = dayNames[new Date(date).getDay()];
            if (dateDay === master.rows[0].day_off) {
                return res.json([]);
            }
        }
        
        const workStart = master.rows[0].work_start || '10:00:00';
        const workEnd = master.rows[0].work_end || '20:00:00';
        const startHour = parseInt(workStart.split(':')[0]);
        const startMinute = parseInt(workStart.split(':')[1]);
        const endHour = parseInt(workEnd.split(':')[0]);
        
        // Получаем все занятые слоты с учетом длительности услуг
        const booked = await pool.query(
            `SELECT a.appointment_time, ms.duration 
             FROM appointments a
             JOIN master_services ms ON a.master_service_id = ms.id
             WHERE a.master_id = $1 AND a.appointment_date = $2 AND a.status != $3`,
            [masterId, date, 'cancelled']
        );
        
        // Создаем множество занятых слотов (каждые 30 минут)
        const bookedSlots = new Set();
        for (const row of booked.rows) {
            const startTime = row.appointment_time;
            const duration = row.duration || 30;
            const slotsToBlock = Math.ceil(duration / 30);
            
            const [hour, minute] = startTime.split(':');
            let currentHour = parseInt(hour);
            let currentMinute = parseInt(minute);
            
            for (let i = 0; i < slotsToBlock; i++) {
                const timeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}:00`;
                bookedSlots.add(timeStr);
                currentMinute += 30;
                if (currentMinute >= 60) {
                    currentHour++;
                    currentMinute = 0;
                }
            }
        }
        
        // Генерируем все возможные слоты каждые 30 минут
        const allSlots = [];
        for (let hour = startHour; hour < endHour; hour++) {
            // Для первого часа учитываем минуту начала
            const startMin = (hour === startHour && startMinute > 0) ? startMinute : 0;
            if (startMin <= 0) {
                allSlots.push(`${hour.toString().padStart(2, '0')}:00:00`);
            }
            if (startMin <= 30 && hour < endHour) {
                allSlots.push(`${hour.toString().padStart(2, '0')}:30:00`);
            }
        }
        // Добавляем последний час если нужно
        if (endHour > startHour) {
            allSlots.push(`${endHour.toString().padStart(2, '0')}:00:00`);
        }
        
        // Фильтруем свободные слоты
        const available = allSlots.filter(slot => !bookedSlots.has(slot));
        res.json(available);
    } catch (err) {
        console.error('Error loading slots:', err);
        res.status(500).json({ error: 'Error loading slots' });
    }
});
`;

// Находим старую функцию и заменяем
const oldPattern = /app\.get\('\/api\/available-slots\/:masterId\/:date',[\s\S]*?\);\n\}\);/;
if (server.match(oldPattern)) {
    server = server.replace(oldPattern, newSlotsFunction);
    fs.writeFileSync('server.js', server);
    console.log('✅ Функция available-slots обновлена!');
} else {
    console.log('❌ Не удалось найти старую функцию');
}
