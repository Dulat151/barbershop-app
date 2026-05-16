DROP DATABASE IF EXISTS barbershop_db;
CREATE DATABASE barbershop_db;
\c barbershop_db;

-- Барберы (с временем работы)
CREATE TABLE masters (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    specialization VARCHAR(100),
    experience INT,
    photo_url TEXT,
    work_start TIME NOT NULL DEFAULT '10:00',
    work_end TIME NOT NULL DEFAULT '20:00',
    break_start TIME,
    break_end TIME
);

-- Услуги конкретных барберов
CREATE TABLE master_services (
    id SERIAL PRIMARY KEY,
    master_id INT REFERENCES masters(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    duration INT NOT NULL
);

-- Общие услуги (для обратной совместимости)
CREATE TABLE services (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    duration INT NOT NULL
);

CREATE TABLE clients (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE appointments (
    id SERIAL PRIMARY KEY,
    client_id INT REFERENCES clients(id) ON DELETE CASCADE,
    master_id INT REFERENCES masters(id) ON DELETE CASCADE,
    service_id INT REFERENCES services(id),
    master_service_id INT REFERENCES master_services(id),
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Добавляем тестовых барберов с разным временем работы
INSERT INTO masters (name, specialization, experience, photo_url, work_start, work_end, break_start, break_end) VALUES
('Алексей', 'Fade, классика', 8, 'https://randomuser.me/api/portraits/men/1.jpg', '09:00', '18:00', '13:00', '14:00'),
('Дмитрий', 'Борода, усы', 5, 'https://randomuser.me/api/portraits/men/2.jpg', '12:00', '21:00', '15:00', '16:00'),
('Максим', 'Детские стрижки', 10, 'https://randomuser.me/api/portraits/men/3.jpg', '10:00', '19:00', NULL, NULL);

-- Добавляем услуги для каждого барбера
INSERT INTO master_services (master_id, name, price, duration) VALUES
(1, 'Мужская стрижка', 1500, 60),
(1, 'Стрижка + борода', 2500, 90),
(1, 'Топ-стиль', 3000, 120),
(2, 'Коррекция бороды', 800, 30),
(2, 'Бритьё головы', 1000, 30),
(2, 'Усы + борода', 2000, 60),
(3, 'Детская стрижка', 1200, 45),
(3, 'Подростковая стрижка', 1500, 60);
