// server.js - VERSÃO PARA DEPLOY NA NUVEM
const express = require('express');
const mqtt = require('mqtt');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ═══════════════════════════════════════════════════════════════
// CONFIGURAÇÃO COM VARIÁVEIS DE AMBIENTE (Render vai preencher)
// ═══════════════════════════════════════════════════════════════
const MQTT_CONFIG = {
    host: process.env.MQTT_HOST || "wss://broker.hivemq.com:8884/mqtt",
    username: process.env.MQTT_USER || "",
    password: process.env.MQTT_PASS || ""
};

// Conecta ao MQTT
const client = mqtt.connect(MQTT_CONFIG.host, {
    username: MQTT_CONFIG.username,
    password: MQTT_CONFIG.password
});

let ultimaTemperatura = null;
let statusDispositivos = {
    sala: "OFF",
    quarto: "OFF",
    banheiro: "OFF",
    cozinha: "OFF"
};

client.on("connect", () => {
    console.log("✅ Conectado ao HiveMQ!");
    client.subscribe([
        "alefsilva/temperatura",
        "alefsilva/sala/status",
        "alefsilva/quarto/status",
        "alefsilva/banheiro/status",
        "alefsilva/cozinha/status"
    ]);
});

client.on("message", (topic, message) => {
    const msg = message.toString();
    
    if (topic === "alefsilva/temperatura") {
        ultimaTemperatura = parseFloat(msg);
        console.log(`🌡️ Temperatura: ${msg}°C`);
    }
    
    if (topic.includes("/status")) {
        const local = topic.split("/")[1];
        statusDispositivos[local] = msg;
        console.log(`💡 ${local}: ${msg === "ON" ? "LIGADO" : "DESLIGADO"}`);
    }
});

// ═══════════════════════════════════════════════════════════════
// APIS
// ═══════════════════════════════════════════════════════════════
app.get("/api/dados", (req, res) => {
    res.json({
        temperatura: ultimaTemperatura,
        dispositivos: statusDispositivos
    });
});

app.post("/api/comando", (req, res) => {
    const { dispositivo, acao } = req.body;
    const topic = `alefsilva/${dispositivo}/comando`;
    
    client.publish(topic, acao, (err) => {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else {
            res.json({ sucesso: true });
        }
    });
});

// Histórico (em memória - vai resetar quando o servidor reiniciar)
let historico = [];
app.post("/api/historico", (req, res) => {
    const { temperatura } = req.body;
    historico.push({
        data: new Date().toLocaleDateString(),
        hora: new Date().toLocaleTimeString(),
        valor: temperatura
    });
    if (historico.length > 100) historico.shift();
    res.json({ sucesso: true });
});

app.get("/api/historico", (req, res) => {
    res.json(historico);
});

// ═══════════════════════════════════════════════════════════════
// INICIA O SERVIDOR (Render fornece a porta via process.env.PORT)
// ═══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});