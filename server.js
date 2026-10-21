/**
 * IoT 数据可视化服务器
 *
 * 为 publisher.js 发布的 MQTT 数据提供网页可视化界面。
 * - 订阅 MQTT 主题，实时接收 publisher 发布的温湿度数据；
 * - 若本地 MQTT broker 不可用，则退化为内置模拟数据，保证页面始终可用；
 * - 暴露 REST 接口 + Server-Sent Events 推送，并托管静态前端页面。
 */
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const EventEmitter = require('events');

const PORT = process.env.PORT || 3000;
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const TOPIC = process.env.TOPIC || 'iot/demo/temperature';
const MQTT_USERNAME = process.env.MQTT_USERNAME || undefined;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || undefined;

const app = express();
const server = http.createServer(app);

// -------- 数据存储 --------
const MAX_HISTORY = 60;          // 保留最近 60 条记录（约 2 分钟 @ 2 秒/条）
const history = [];               // [{ ts, temperature, humidity, deviceId }]
let latest = null;                 // 最新一条
const bus = new EventEmitter();    // 给 SSE 推数据
bus.setMaxListeners(0);

function pushReading(reading) {
    latest = reading;
    history.push(reading);
    if (history.length > MAX_HISTORY) history.shift();
    bus.emit('reading', reading);
}

// -------- 数据源：MQTT --------
let useSimulation = false;
let mqttClient = null;
let simTimer = null;

function startSimulation() {
    if (simTimer) return;
    console.log('[VIS] MQTT broker 不可用，退化为内置模拟数据。');
    simTimer = setInterval(() => {
        pushReading({
            deviceId: 'sensor-001',
            ts: Date.now(),
            temperature: parseFloat((20 + Math.random() * 5).toFixed(2)),
            humidity: parseFloat((40 + Math.random() * 10).toFixed(2)),
            source: 'simulation',
        });
    }, 2000);
    useSimulation = true;
}

function stopSimulation() {
    if (simTimer) { clearInterval(simTimer); simTimer = null; }
    useSimulation = false;
}

async function connectMqtt() {
    try {
        const mqtt = require('mqtt');
        mqttClient = mqtt.connect(MQTT_URL, {
            username: MQTT_USERNAME,
            password: MQTT_PASSWORD,
            reconnectPeriod: 3000,
            connectTimeout: 4000,
        });

        mqttClient.on('connect', () => {
            console.log('[VIS] 已连接 MQTT broker:', MQTT_URL);
            stopSimulation();
            mqttClient.subscribe(TOPIC, { qos: 0 }, (err) => {
                if (err) console.error('[VIS] 订阅失败:', err.message);
                else console.log('[VIS] 已订阅主题:', TOPIC);
            });
        });

        mqttClient.on('message', (topic, payload) => {
            try {
                const data = JSON.parse(payload.toString());
                pushReading({
                    deviceId: data.deviceId || 'unknown',
                    ts: data.ts || Date.now(),
                    temperature: parseFloat(data.temperature),
                    humidity: parseFloat(data.humidity),
                    source: 'mqtt',
                });
            } catch (e) {
                console.warn('[VIS] 无法解析消息:', payload.toString());
            }
        });

        mqttClient.on('error', (err) => {
            console.error('[VIS] MQTT 错误:', err.message);
            if (!useSimulation) startSimulation();
        });

        // 若 4 秒后仍未连接，启动模拟数据兜底
        setTimeout(() => {
            if (!mqttClient.connected) startSimulation();
        }, 4000);
    } catch (e) {
        console.error('[VIS] mqtt 模块加载失败，使用模拟数据:', e.message);
        startSimulation();
    }
}

connectMqtt();

// -------- 路由 --------
app.use(express.static(path.join(__dirname, 'public')));

// 最新一条
app.get('/api/data', (req, res) => {
    res.json({ ok: true, source: useSimulation ? 'simulation' : 'mqtt', data: latest });
});

// 历史记录
app.get('/api/history', (req, res) => {
    res.json({ ok: true, source: useSimulation ? 'simulation' : 'mqtt', count: history.length, data: history });
});

// 服务器推送事件（SSE）
app.get('/stream', (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    if (latest) res.write(`data: ${JSON.stringify({ source: useSimulation ? 'simulation' : 'mqtt', data: latest })}\n\n`);

    const handler = (reading) => {
        res.write(`data: ${JSON.stringify({ source: useSimulation ? 'simulation' : 'mqtt', data: reading })}\n\n`);
    };
    bus.on('reading', handler);
    req.on('close', () => bus.off('reading', handler));
});

app.get('/health', (req, res) => {
    res.json({
        ok: true,
        source: useSimulation ? 'simulation' : 'mqtt',
        mqttConnected: !!(mqttClient && mqttClient.connected),
        historyCount: history.length,
    });
});

server.listen(PORT, () => {
    console.log(`\n[VIS] 可视化服务已启动 → http://localhost:${PORT}\n`);
});
