const express = require('express');
const mqtt = require('mqtt');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Configuração EMQX
const MQTT_BROKER = "k3f3a610.ala.us-east-1.emqxsl.com";
const MQTT_PORT = 8883;
const MQTT_USER = "alef";
const MQTT_PASS = "@Alef123";

// Conecta MQTT (sem bloquear o funcionamento)
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

// Tenta conectar (mas não impede o servidor de rodar)
conectarMQTT();

// ═══════════════════════════════════════════════════════════════
// ESTRUTURA DE HISTÓRICO
// ═══════════════════════════════════════════════════════════════
let historicoGeral = [];
let historicoSala = [];
let historicoQuarto = [];

const MAX_HISTORICO = 500;

// ═══════════════════════════════════════════════════════════════
// VARIÁVEIS DE STATUS (TUDO INICIA DESLIGADO)
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// FUNÇÃO PARA ATUALIZAR STATUS (SEMPRE ATUALIZA LOCALMENTE)
// ═══════════════════════════════════════════════════════════════
function atualizarStatusDispositivo(dispositivo, estado) {
    // SEMPRE atualiza o status local primeiro
    statusDispositivos[dispositivo] = estado;
    console.log(`💡 ${dispositivo}: ${estado === "ON" ? "LIGADO ✅" : "DESLIGADO ❌"}`);
    
    // Tenta enviar via MQTT (mas não falha se não conseguir)
    if (client && mqttConnected) {
        const topic = `alefsilva/${dispositivo}/comando`;
        client.publish(topic, estado, (err) => {
            if (err) {
                console.log(`⚠️ MQTT falhou para ${dispositivo}, mas status local mantido`);
            } else {
                console.log(`📡 MQTT: ${estado} enviado para ${dispositivo}`);
            }
        });
    } else {
        console.log(`⚠️ MQTT desconectado - status apenas local para ${dispositivo}`);
    }
}

function adicionarAoHistorico(historicoArray, dados) {
    const registro = {
        data: new Date().toLocaleDateString('pt-BR'),
        hora: new Date().toLocaleTimeString('pt-BR'),
        timestamp: new Date().toISOString(),
        ...dados
    };
    historicoArray.unshift(registro);
    if (historicoArray.length > MAX_HISTORICO) historicoArray.pop();
    return registro;
}

// ═══════════════════════════════════════════════════════════════
// MQTT CALLBACKS (para receber dados dos sensores)
// ═══════════════════════════════════════════════════════════════
if (client) {
    client.on("message", (topic, message) => {
        const msg = message.toString();
        
        if (topic === "alefsilva/temperatura") {
            ultimaTemperatura = parseFloat(msg);
            console.log(`🌡️ Temp Geral: ${ultimaTemperatura}°C`);
            adicionarAoHistorico(historicoGeral, { temperatura: ultimaTemperatura });
        }
        
        if (topic.includes("/status")) {
            const local = topic.split("/")[1];
            if (statusDispositivos.hasOwnProperty(local)) {
                statusDispositivos[local] = msg;
                console.log(`📡 Status recebido do ${local}: ${msg}`);
            }
        }
        
        if (topic === "alefsilva/sala/temperatura") {
            dadosSala.temperatura = parseFloat(msg);
            if (dadosSala.umidade !== null) {
                adicionarAoHistorico(historicoSala, { temperatura: dadosSala.temperatura, umidade: dadosSala.umidade });
            }
        }
        
        if (topic === "alefsilva/sala/umidade") {
            dadosSala.umidade = parseFloat(msg);
            if (dadosSala.temperatura !== null) {
                adicionarAoHistorico(historicoSala, { temperatura: dadosSala.temperatura, umidade: dadosSala.umidade });
            }
        }
        
        if (topic === "alefsilva/quarto/temperatura") {
            dadosQuarto.temperatura = parseFloat(msg);
            if (dadosQuarto.umidade !== null) {
                adicionarAoHistorico(historicoQuarto, { temperatura: dadosQuarto.temperatura, umidade: dadosQuarto.umidade });
            }
        }
        
        if (topic === "alefsilva/quarto/umidade") {
            dadosQuarto.umidade = parseFloat(msg);
            if (dadosQuarto.temperatura !== null) {
                adicionarAoHistorico(historicoQuarto, { temperatura: dadosQuarto.temperatura, umidade: dadosQuarto.umidade });
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════
// ENDPOINTS DA API
// ═══════════════════════════════════════════════════════════════

app.get("/api/health", (req, res) => {
    res.json({ 
        status: "ok", 
        mqtt: mqttConnected,
        dispositivos: statusDispositivos
    });
});

app.get("/api/dados", (req, res) => {
    res.json({
        temperatura: ultimaTemperatura,
        dispositivos: statusDispositivos,
        sala: dadosSala,
        quarto: dadosQuarto,
        timestamp: new Date().toISOString()
    });
});

// ENDPOINT DE COMANDO PRINCIPAL - SEMPRE FUNCIONA
app.post("/api/comando", (req, res) => {
    const { dispositivo, acao } = req.body;
    
    console.log(`📨 Comando recebido: ${dispositivo} -> ${acao}`);
    
    if (!statusDispositivos.hasOwnProperty(dispositivo)) {
        return res.status(400).json({ erro: `Dispositivo "${dispositivo}" não encontrado` });
    }
    
    // ATUALIZA O STATUS LOCAL IMEDIATAMENTE (a lâmpada vai acender na interface)
    atualizarStatusDispositivo(dispositivo, acao);
    
    // Retorna sucesso imediato (a interface já está atualizada)
    res.json({ 
        sucesso: true, 
        dispositivo, 
        acao,
        statusAtual: statusDispositivos[dispositivo],
        mqttEnviado: mqttConnected
    });
});

// Histórico
app.get("/api/historico/geral", (req, res) => res.json(historicoGeral));
app.get("/api/historico/sala", (req, res) => res.json(historicoSala));
app.get("/api/historico/quarto", (req, res) => res.json(historicoQuarto));

// Exportar Excel
app.get("/api/exportar/excel/:comodo", (req, res) => {
    const { comodo } = req.params;
    let dados = [];
    let cabecalho = "";
    
    switch(comodo) {
        case "geral":
            dados = historicoGeral;
            cabecalho = "Data,Hora,Temperatura (°C)\n";
            break;
        case "sala":
            dados = historicoSala;
            cabecalho = "Data,Hora,Temperatura Sala (°C),Umidade Sala (%)\n";
            break;
        case "quarto":
            dados = historicoQuarto;
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
});

// Reset (opcional)
app.post("/api/historico/reset", (req, res) => {
    historicoGeral = [];
    historicoSala = [];
    historicoQuarto = [];
    res.json({ sucesso: true, mensagem: "Históricos resetados" });
});

app.get("/", (req, res) => {
    res.json({ 
        message: "IoT Backend Rodando!",
        dispositivos: statusDispositivos,
        mqtt: mqttConnected ? "conectado" : "desconectado (modo local)"
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📡 Modo: ${mqttConnected ? "MQTT Conectado" : "Apenas Local (interface funcionando)"}`);
});
