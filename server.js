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

// Conecta MQTT
const client = mqtt.connect(`mqtts://${MQTT_BROKER}:${MQTT_PORT}`, {
    username: MQTT_USER,
    password: MQTT_PASS,
    rejectUnauthorized: false
});

// ═══════════════════════════════════════════════════════════════
// ESTRUTURA DE HISTÓRICO POR CÔMODO
// ═══════════════════════════════════════════════════════════════
let historicoGeral = [];      // Temperatura geral (DS18B20)
let historicoSala = [];       // Temperatura e Umidade da Sala
let historicoQuarto = [];     // Temperatura e Umidade do Quarto
let historicoBanheiro = [];   // Temperatura do Banheiro (se tiver)
let historicoCozinha = [];    // Temperatura da Cozinha (se tiver)

// Limite de registros por histórico (mantém últimos 500)
const MAX_HISTORICO = 500;

// ═══════════════════════════════════════════════════════════════
// VARIÁVEIS DE STATUS (INICIALIZADAS CORRETAMENTE)
// ═══════════════════════════════════════════════════════════════
let ultimaTemperatura = null;
let statusDispositivos = {
    sala: "OFF",
    quarto: "OFF",
    banheiro: "OFF",
    cozinha: "OFF",
    QUARTINHO: "OFF"  // ADICIONADO
};

// Dados dos sensores DHT11
let dadosSala = {
    temperatura: null,
    umidade: null,
    ultimaAtualizacao: null
};

let dadosQuarto = {
    temperatura: null,
    umidade: null,
    ultimaAtualizacao: null
};

// ═══════════════════════════════════════════════════════════════
// FUNÇÃO PARA ATUALIZAR STATUS E PUBLICAR MQTT
// ═══════════════════════════════════════════════════════════════
function atualizarStatusDispositivo(dispositivo, estado) {
    // Atualiza o status local
    statusDispositivos[dispositivo] = estado;
    console.log(`💡 ${dispositivo}: ${estado === "ON" ? "LIGADO" : "DESLIGADO"}`);
    
    // Publica no MQTT para o dispositivo físico
    const topic = `alefsilva/${dispositivo}/comando`;
    client.publish(topic, estado, (err) => {
        if (err) {
            console.error(`❌ Erro ao publicar ${dispositivo}:`, err.message);
        } else {
            console.log(`✅ Comando ${estado} publicado para ${dispositivo}`);
        }
    });
    
    // Também publica o status no tópico de status (para manter sincronia)
    const statusTopic = `alefsilva/${dispositivo}/status`;
    client.publish(statusTopic, estado, (err) => {
        if (err) {
            console.error(`❌ Erro ao publicar status ${dispositivo}:`, err.message);
        }
    });
}

// ═══════════════════════════════════════════════════════════════
// FUNÇÃO PARA ADICIONAR AO HISTÓRICO
// ═══════════════════════════════════════════════════════════════
function adicionarAoHistorico(historicoArray, dados) {
    const registro = {
        data: new Date().toLocaleDateString('pt-BR'),
        hora: new Date().toLocaleTimeString('pt-BR'),
        timestamp: new Date().toISOString(),
        ...dados
    };
    
    historicoArray.unshift(registro); // Adiciona no início
    
    // Mantém apenas os últimos MAX_HISTORICO registros
    if (historicoArray.length > MAX_HISTORICO) {
        historicoArray.pop();
    }
    
    return registro;
}

// ═══════════════════════════════════════════════════════════════
// MQTT CALLBACKS
// ═══════════════════════════════════════════════════════════════
client.on("connect", () => {
    console.log("✅ Conectado ao EMQX!");
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

client.on("message", (topic, message) => {
    const msg = message.toString();
    
    // Temperatura geral (DS18B20)
    if (topic === "alefsilva/temperatura") {
        ultimaTemperatura = parseFloat(msg);
        console.log(`🌡️ Temp Geral: ${ultimaTemperatura}°C`);
        
        adicionarAoHistorico(historicoGeral, {
            tipo: "Temperatura Geral",
            temperatura: ultimaTemperatura
        });
    }
    
    // Status das luzes (vindo do ESP32)
    if (topic.includes("/status")) {
        const parts = topic.split("/");
        const local = parts[1];
        if (statusDispositivos.hasOwnProperty(local)) {
            statusDispositivos[local] = msg;
            console.log(`📡 Status recebido do ${local}: ${msg === "ON" ? "LIGADO" : "DESLIGADO"}`);
        }
    }
    
    // DHT11 da Sala
    if (topic === "alefsilva/sala/temperatura") {
        dadosSala.temperatura = parseFloat(msg);
        dadosSala.ultimaAtualizacao = new Date().toISOString();
        console.log(`🌡️ Sala Temp: ${dadosSala.temperatura}°C`);
        
        if (dadosSala.umidade !== null) {
            adicionarAoHistorico(historicoSala, {
                local: "Sala",
                temperatura: dadosSala.temperatura,
                umidade: dadosSala.umidade
            });
        }
    }
    
    if (topic === "alefsilva/sala/umidade") {
        dadosSala.umidade = parseFloat(msg);
        console.log(`💧 Sala Umid: ${dadosSala.umidade}%`);
        
        if (dadosSala.temperatura !== null) {
            adicionarAoHistorico(historicoSala, {
                local: "Sala",
                temperatura: dadosSala.temperatura,
                umidade: dadosSala.umidade
            });
        }
    }
    
    // DHT11 do Quarto
    if (topic === "alefsilva/quarto/temperatura") {
        dadosQuarto.temperatura = parseFloat(msg);
        dadosQuarto.ultimaAtualizacao = new Date().toISOString();
        console.log(`🌡️ Quarto Temp: ${dadosQuarto.temperatura}°C`);
        
        if (dadosQuarto.umidade !== null) {
            adicionarAoHistorico(historicoQuarto, {
                local: "Quarto",
                temperatura: dadosQuarto.temperatura,
                umidade: dadosQuarto.umidade
            });
        }
    }
    
    if (topic === "alefsilva/quarto/umidade") {
        dadosQuarto.umidade = parseFloat(msg);
        console.log(`💧 Quarto Umid: ${dadosQuarto.umidade}%`);
        
        if (dadosQuarto.temperatura !== null) {
            adicionarAoHistorico(historicoQuarto, {
                local: "Quarto",
                temperatura: dadosQuarto.temperatura,
                umidade: dadosQuarto.umidade
            });
        }
    }
});

client.on("error", (err) => {
    console.error("❌ Erro MQTT:", err);
});

client.on("offline", () => {
    console.warn("⚠️ Cliente MQTT offline");
});

client.on("reconnect", () => {
    console.log("🔄 Tentando reconectar ao MQTT...");
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINTS DA API
// ═══════════════════════════════════════════════════════════════

// Saúde do servidor
app.get("/api/health", (req, res) => {
    res.json({ 
        status: "ok", 
        mqtt: client.connected,
        dispositivos: statusDispositivos
    });
});

// Dados atuais
app.get("/api/dados", (req, res) => {
    res.json({
        temperatura: ultimaTemperatura,
        dispositivos: statusDispositivos,
        sala: dadosSala,
        quarto: dadosQuarto,
        timestamp: new Date().toISOString(),
        mqttConnected: client.connected
    });
});

// Enviar comando (CORRIGIDO - atualiza status imediatamente)
app.post("/api/comando", (req, res) => {
    const { dispositivo, acao } = req.body;
    
    console.log(`📨 Comando recebido: ${dispositivo} -> ${acao}`);
    
    // Verifica se o dispositivo existe
    if (!statusDispositivos.hasOwnProperty(dispositivo)) {
        return res.status(400).json({ erro: `Dispositivo "${dispositivo}" não encontrado` });
    }
    
    // Atualiza o status local IMEDIATAMENTE
    statusDispositivos[dispositivo] = acao;
    console.log(`💡 Status atualizado: ${dispositivo} = ${acao}`);
    
    // Publica no MQTT
    const topic = `alefsilva/${dispositivo}/comando`;
    client.publish(topic, acao, (err) => {
        if (err) {
            console.error(`❌ Erro MQTT ao enviar para ${dispositivo}:`, err.message);
            // Não reverte o status local para não confundir o usuário
            return res.status(500).json({ 
                erro: "Falha na comunicação MQTT", 
                detalhe: err.message,
                statusLocal: statusDispositivos[dispositivo]
            });
        }
        
        console.log(`✅ Comando ${acao} enviado via MQTT para ${dispositivo}`);
        
        // Também publica no tópico de status para manter sincronia
        const statusTopic = `alefsilva/${dispositivo}/status`;
        client.publish(statusTopic, acao);
        
        res.json({ 
            sucesso: true, 
            dispositivo, 
            acao,
            statusAtual: statusDispositivos[dispositivo]
        });
    });
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINT PARA SIMULAR COMANDO (QUANDO MQTT ESTÁ OFFLINE)
// ═══════════════════════════════════════════════════════════════
app.post("/api/comando/simular", (req, res) => {
    const { dispositivo, acao } = req.body;
    
    if (!statusDispositivos.hasOwnProperty(dispositivo)) {
        return res.status(400).json({ erro: `Dispositivo "${dispositivo}" não encontrado` });
    }
    
    // Atualiza apenas localmente (modo demonstração)
    statusDispositivos[dispositivo] = acao;
    console.log(`🔄 SIMULAÇÃO: ${dispositivo} -> ${acao} (apenas local)`);
    
    res.json({ 
        sucesso: true, 
        simulacao: true,
        dispositivo, 
        acao,
        statusAtual: statusDispositivos[dispositivo],
        aviso: "Modo simulação - dispositivo físico não foi alterado"
    });
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINTS DE HISTÓRICO
// ═══════════════════════════════════════════════════════════════

// Histórico Geral
app.get("/api/historico/geral", (req, res) => {
    res.json(historicoGeral);
});

// Histórico da Sala
app.get("/api/historico/sala", (req, res) => {
    res.json(historicoSala);
});

// Histórico do Quarto
app.get("/api/historico/quarto", (req, res) => {
    res.json(historicoQuarto);
});

// Todos os históricos juntos
app.get("/api/historico/todos", (req, res) => {
    res.json({
        geral: historicoGeral,
        sala: historicoSala,
        quarto: historicoQuarto
    });
});

// ═══════════════════════════════════════════════════════════════
// EXPORTAR PARA EXCEL (Formato CSV que o Excel abre)
// ═══════════════════════════════════════════════════════════════
app.get("/api/exportar/excel/:comodo", (req, res) => {
    const { comodo } = req.params;
    let dados = [];
    let nomeArquivo = "";
    let cabecalho = "";
    
    switch(comodo) {
        case "geral":
            dados = historicoGeral;
            nomeArquivo = "historico_temperatura_geral";
            cabecalho = "Data,Hora,Temperatura (°C)\n";
            break;
        case "sala":
            dados = historicoSala;
            nomeArquivo = "historico_sala_temp_umidade";
            cabecalho = "Data,Hora,Temperatura Sala (°C),Umidade Sala (%)\n";
            break;
        case "quarto":
            dados = historicoQuarto;
            nomeArquivo = "historico_quarto_temp_umidade";
            cabecalho = "Data,Hora,Temperatura Quarto (°C),Umidade Quarto (%)\n";
            break;
        case "todos":
            const maxLen = Math.max(historicoGeral.length, historicoSala.length, historicoQuarto.length);
            let linhas = [];
            for (let i = 0; i < maxLen; i++) {
                const g = historicoGeral[i] || {};
                const s = historicoSala[i] || {};
                const q = historicoQuarto[i] || {};
                linhas.push(`${g.data || ''},${g.hora || ''},${g.temperatura || ''},${s.data || ''},${s.hora || ''},${s.temperatura || ''},${s.umidade || ''},${q.data || ''},${q.hora || ''},${q.temperatura || ''},${q.umidade || ''}`);
            }
            cabecalho = "Data Geral,Hora Geral,Temp Geral (°C),Data Sala,Hora Sala,Temp Sala (°C),Umid Sala (%),Data Quarto,Hora Quarto,Temp Quarto (°C),Umid Quarto (%)\n";
            nomeArquivo = "historico_completo_todos_comodos";
            
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename=${nomeArquivo}.csv`);
            res.write('\uFEFF' + cabecalho);
            res.write(linhas.join('\n'));
            return res.end();
    }
    
    let linhas = [];
    for (const item of dados) {
        if (comodo === "sala" || comodo === "quarto") {
            linhas.push(`${item.data},${item.hora},${item.temperatura},${item.umidade}`);
        } else {
            linhas.push(`${item.data},${item.hora},${item.temperatura}`);
        }
    }
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${nomeArquivo}.csv`);
    res.write('\uFEFF' + cabecalho);
    res.write(linhas.join('\n'));
    res.end();
});

// Reset do histórico (opcional - útil para testes)
app.post("/api/historico/reset", (req, res) => {
    const { comodo } = req.body;
    
    switch(comodo) {
        case "geral":
            historicoGeral = [];
            break;
        case "sala":
            historicoSala = [];
            break;
        case "quarto":
            historicoQuarto = [];
            break;
        case "todos":
            historicoGeral = [];
            historicoSala = [];
            historicoQuarto = [];
            break;
        default:
            return res.status(400).json({ erro: "Cômodo inválido" });
    }
    
    res.json({ sucesso: true, comodo: comodo || "todos", mensagem: "Histórico resetado" });
});

// Rota principal
app.get("/", (req, res) => {
    res.json({ 
        message: "IoT Backend Rodando!",
        status: {
            mqtt: client.connected ? "conectado" : "desconectado",
            dispositivos: statusDispositivos
        },
        endpoints: [
            "/api/health",
            "/api/dados",
            "/api/comando",
            "/api/comando/simular",
            "/api/historico/geral",
            "/api/historico/sala",
            "/api/historico/quarto",
            "/api/exportar/excel/:comodo",
            "/api/historico/reset"
        ]
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📡 Status MQTT: ${client.connected ? "Conectado" : "Conectando..."}`);
});
