const express = require('express');
const mqtt = require('mqtt');
const cors = require('cors');

const app = express();

// CORS - Permite qualquer origem (para teste)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ═══════════════════════════════════════════════════════════════
// CONFIGURAÇÃO MQTT - EMQX Cloud
// ═══════════════════════════════════════════════════════════════
const MQTT_BROKER = "k3f3a610.ala.us-east-1.emqxsl.com";
const MQTT_PORT = 8883;
const MQTT_USER = "alef";
const MQTT_PASS = "@Alef123";

console.log(`📡 Conectando ao MQTT: ${MQTT_BROKER}:${MQTT_PORT}`);

// Conexão MQTT
const client = mqtt.connect(`mqtts://${MQTT_BROKER}:${MQTT_PORT}`, {
    username: MQTT_USER,
    password: MQTT_PASS,
    rejectUnauthorized: false
});

let ultimaTemperatura = null;
let statusDispositivos = {
    sala: "OFF",
    quarto: "OFF",
    banheiro: "OFF",
    cozinha: "OFF"
};

client.on("connect", () => {
    console.log("✅ Conectado ao EMQX Cloud!");
    
    client.subscribe([
        "alefsilva/temperatura",
        "alefsilva/sala/status",
        "alefsilva/quarto/status",
        "alefsilva/banheiro/status",
        "alefsilva/cozinha/status"
    ], (err) => {
        if (err) {
            console.error("❌ Erro ao inscrever:", err);
        } else {
            console.log("✅ Inscrito nos tópicos!");
        }
    });
});

client.on("error", (err) => {
    console.error("❌ Erro MQTT:", err);
});

client.on("message", (topic, message) => {
    const msg = message.toString();
    console.log(`📨 MQTT: ${topic} = ${msg}`);
    
    if (topic === "alefsilva/temperatura") {
        ultimaTemperatura = parseFloat(msg);
        console.log(`🌡️ Temperatura: ${ultimaTemperatura}°C`);
    }
    
    if (topic.includes("/status")) {
        const local = topic.split("/")[1];
        statusDispositivos[local] = msg;
        console.log(`💡 ${local}: ${msg === "ON" ? "LIGADO" : "DESLIGADO"}`);
    }
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINTS DA API
// ═══════════════════════════════════════════════════════════════

// Rota de saúde (health check)
app.get("/api/health", (req, res) => {
    res.json({
        status: "online",
        mqtt: client.connected ? "conectado" : "desconectado",
        timestamp: new Date().toISOString()
    });
});

// GET /api/dados
app.get("/api/dados", (req, res) => {
    res.json({
        temperatura: ultimaTemperatura,
        dispositivos: statusDispositivos,
        mqttConectado: client.connected
    });
});

// POST /api/comando
app.post("/api/comando", (req, res) => {
    const { dispositivo, acao } = req.body;
    
    console.log(`📤 Comando recebido: ${dispositivo} -> ${acao}`);
    
    if (!dispositivo || !acao) {
        return res.status(400).json({ erro: "Dispositivo e ação são obrigatórios" });
    }
    
    const topic = `alefsilva/${dispositivo}/comando`;
    
    client.publish(topic, acao, (err) => {
        if (err) {
            console.error("❌ Erro ao publicar:", err);
            res.status(500).json({ erro: err.message });
        } else {
            console.log(`✅ Publicado: ${topic} = ${acao}`);
            res.json({ sucesso: true, mensagem: `Comando ${acao} enviado para ${dispositivo}` });
        }
    });
});

// Histórico
let historico = [];

app.post("/api/historico", (req, res) => {
    const { temperatura } = req.body;
    if (temperatura !== undefined && !isNaN(temperatura)) {
        historico.push({
            data: new Date().toLocaleDateString(),
            hora: new Date().toLocaleTimeString(),
            valor: temperatura
        });
        if (historico.length > 100) historico.shift();
    }
    res.json({ sucesso: true });
});

app.get("/api/historico", (req, res) => {
    res.json(historico);
});

// Rota raiz para teste
app.get("/", (req, res) => {
    res.json({
        nome: "IoT Backend",
        versao: "1.0",
        endpoints: ["/api/health", "/api/dados", "/api/comando", "/api/historico"]
    });
});

// Inicia o servidor
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📡 Teste: https://iot-backend-3nqz.onrender.com/api/health`);
});
