const express = require('express');
const mqtt = require('mqtt');
const cors = require('cors');
const mongoose = require('mongoose');
const { HistoricoGeral, HistoricoSala, HistoricoQuarto } = require('./models/Historico');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================
// CONFIGURAÇÃO DO MONGODB (use suas credenciais)
// ============================================================
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://seu_usuario:sua_senha@cluster0.xxxxx.mongodb.net/iot?retryWrites=true&w=majority";

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Conectado ao MongoDB Atlas'))
  .catch(err => console.error('❌ Erro ao conectar MongoDB:', err));

// ============================================================
// CONFIGURAÇÃO MQTT (EMQX)
// ============================================================
const MQTT_BROKER = "k3f3a610.ala.us-east-1.emqxsl.com";
const MQTT_PORT = 8883;
const MQTT_USER = "alef";
const MQTT_PASS = "@Alef123";

let client = null;
let mqttConnected = false;

function conectarMQTT() {
    try {
        client = mqtt.connect(`mqtts://${MQTT_BROKER}:${MQTT_PORT}`, {
            username: MQTT_USER,
            password: MQTT_PASS,
            rejectUnauthorized: false,
            connectTimeout: 5000
        });
        
        client.on("connect", () => {
            console.log("✅ Conectado ao EMQX!");
            mqttConnected = true;
            client.subscribe([
                "alefsilva/temperatura",
                "alefsilva/sala/status",
                "alefsilva/quarto/status",
                "alefsilva/banheiro/status",
                "alefsilva/cozinha/status",
                "alefsilva/QUARTINHO/status",
                "alefsilva/sala/temperatura",
                "alefsilva/sala/umidade",
                "alefsilva/quarto/temperatura",
                "alefsilva/quarto/umidade"
            ]);
        });
        
        client.on("error", (err) => {
            console.error("❌ Erro MQTT:", err.message);
            mqttConnected = false;
        });
        
        client.on("offline", () => {
            console.warn("⚠️ MQTT offline");
            mqttConnected = false;
        });
    } catch (err) {
        console.error("❌ Falha ao conectar MQTT:", err.message);
        mqttConnected = false;
    }
}

conectarMQTT();

// ============================================================
// VARIÁVEIS DE STATUS (em memória – para respostas rápidas)
// ============================================================
let ultimaTemperatura = null;
let statusDispositivos = {
    sala: "OFF",
    quarto: "OFF",
    banheiro: "OFF",
    cozinha: "OFF",
    QUARTINHO: "OFF"
};
let dadosSala = { temperatura: null, umidade: null };
let dadosQuarto = { temperatura: null, umidade: null };

// ============================================================
// FUNÇÕES PARA SALVAR NO BANCO (assíncronas)
// ============================================================
async function salvarHistoricoGeral(temperatura) {
    try {
        const now = new Date();
        const registro = new HistoricoGeral({
            data: now.toLocaleDateString('pt-BR'),
            hora: now.toLocaleTimeString('pt-BR'),
            temperatura: temperatura
        });
        await registro.save();
        console.log(`📝 Histórico geral salvo: ${temperatura}°C`);
    } catch (err) {
        console.error("Erro ao salvar histórico geral:", err);
    }
}

async function salvarHistoricoSala(temp, umid) {
    try {
        const now = new Date();
        const registro = new HistoricoSala({
            data: now.toLocaleDateString('pt-BR'),
            hora: now.toLocaleTimeString('pt-BR'),
            temperatura: temp,
            umidade: umid
        });
        await registro.save();
        console.log(`📝 Histórico sala salvo: ${temp}°C, ${umid}%`);
    } catch (err) {
        console.error("Erro ao salvar histórico sala:", err);
    }
}

async function salvarHistoricoQuarto(temp, umid) {
    try {
        const now = new Date();
        const registro = new HistoricoQuarto({
            data: now.toLocaleDateString('pt-BR'),
            hora: now.toLocaleTimeString('pt-BR'),
            temperatura: temp,
            umidade: umid
        });
        await registro.save();
        console.log(`📝 Histórico quarto salvo: ${temp}°C, ${umid}%`);
    } catch (err) {
        console.error("Erro ao salvar histórico quarto:", err);
    }
}

// ============================================================
// CALLBACK MQTT – processa mensagens e salva no banco
// ============================================================
if (client) {
    client.on("message", async (topic, message) => {
        const msg = message.toString();
        
        // Temperatura geral (DS18B20)
        if (topic === "alefsilva/temperatura") {
            ultimaTemperatura = parseFloat(msg);
            console.log(`🌡️ Temp Geral: ${ultimaTemperatura}°C`);
            await salvarHistoricoGeral(ultimaTemperatura);
        }
        
        // Status dos dispositivos
        if (topic.includes("/status")) {
            const local = topic.split("/")[1];
            if (statusDispositivos.hasOwnProperty(local)) {
                statusDispositivos[local] = msg;
                console.log(`📡 Status recebido do ${local}: ${msg}`);
            }
        }
        
        // Dados da Sala (DHT11)
        if (topic === "alefsilva/sala/temperatura") {
            dadosSala.temperatura = parseFloat(msg);
            if (dadosSala.umidade !== null) {
                await salvarHistoricoSala(dadosSala.temperatura, dadosSala.umidade);
            }
        }
        if (topic === "alefsilva/sala/umidade") {
            dadosSala.umidade = parseFloat(msg);
            if (dadosSala.temperatura !== null) {
                await salvarHistoricoSala(dadosSala.temperatura, dadosSala.umidade);
            }
        }
        
        // Dados do Quarto (DHT11)
        if (topic === "alefsilva/quarto/temperatura") {
            dadosQuarto.temperatura = parseFloat(msg);
            if (dadosQuarto.umidade !== null) {
                await salvarHistoricoQuarto(dadosQuarto.temperatura, dadosQuarto.umidade);
            }
        }
        if (topic === "alefsilva/quarto/umidade") {
            dadosQuarto.umidade = parseFloat(msg);
            if (dadosQuarto.temperatura !== null) {
                await salvarHistoricoQuarto(dadosQuarto.temperatura, dadosQuarto.umidade);
            }
        }
    });
}

// ============================================================
// ENDPOINTS DA API
// ============================================================

// Retorna dados atuais (rápido, da memória)
app.get("/api/dados", (req, res) => {
    res.json({
        temperatura: ultimaTemperatura,
        dispositivos: statusDispositivos,
        sala: dadosSala,
        quarto: dadosQuarto,
        timestamp: new Date().toISOString()
    });
});

// Endpoint para enviar comandos MQTT (liga/desliga lâmpadas)
app.post("/api/comando", (req, res) => {
    const { dispositivo, acao } = req.body;
    if (!statusDispositivos.hasOwnProperty(dispositivo)) {
        return res.status(400).json({ erro: "Dispositivo inválido" });
    }
    // Atualiza status local
    statusDispositivos[dispositivo] = acao;
    // Publica no MQTT
    if (client && mqttConnected) {
        client.publish(`alefsilva/${dispositivo}/comando`, acao);
    }
    res.json({ sucesso: true, dispositivo, acao });
});

// Endpoints de histórico (buscando do MongoDB)
app.get("/api/historico/geral", async (req, res) => {
    try {
        const historico = await HistoricoGeral.find().sort({ timestamp: -1 }).limit(500);
        res.json(historico);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.get("/api/historico/sala", async (req, res) => {
    try {
        const historico = await HistoricoSala.find().sort({ timestamp: -1 }).limit(500);
        res.json(historico);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.get("/api/historico/quarto", async (req, res) => {
    try {
        const historico = await HistoricoQuarto.find().sort({ timestamp: -1 }).limit(500);
        res.json(historico);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Exportar Excel (agora busca do banco)
app.get("/api/exportar/excel/:comodo", async (req, res) => {
    const { comodo } = req.params;
    let dados = [];
    let cabecalho = "";
    
    try {
        switch(comodo) {
            case "geral":
                dados = await HistoricoGeral.find().sort({ timestamp: -1 });
                cabecalho = "Data,Hora,Temperatura (°C)\n";
                break;
            case "sala":
                dados = await HistoricoSala.find().sort({ timestamp: -1 });
                cabecalho = "Data,Hora,Temperatura Sala (°C),Umidade Sala (%)\n";
                break;
            case "quarto":
                dados = await HistoricoQuarto.find().sort({ timestamp: -1 });
                cabecalho = "Data,Hora,Temperatura Quarto (°C),Umidade Quarto (%)\n";
                break;
            default:
                return res.status(400).json({ erro: "Cômodo inválido" });
        }
        
        let linhas = dados.map(item => {
            if (comodo === "sala" || comodo === "quarto") {
                return `${item.data},${item.hora},${item.temperatura || ''},${item.umidade || ''}`;
            }
            return `${item.data},${item.hora},${item.temperatura || ''}`;
        });
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=historico_${comodo}.csv`);
        res.write('\uFEFF' + cabecalho);
        res.write(linhas.join('\n'));
        res.end();
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Health check
app.get("/api/health", (req, res) => {
    res.json({ status: "ok", mqtt: mqttConnected, db: mongoose.connection.readyState === 1 });
});

app.get("/", (req, res) => {
    res.json({ message: "IoT Backend com persistência MongoDB" });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
