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
// VARIÁVEIS DE STATUS
// ═══════════════════════════════════════════════════════════════
let ultimaTemperatura = null;
let statusDispositivos = {
    sala: "OFF",
    quarto: "OFF",
    banheiro: "OFF",
    cozinha: "OFF"
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
    
    // Status das luzes
    if (topic.includes("/status")) {
        const local = topic.split("/")[1];
        statusDispositivos[local] = msg;
        console.log(`💡 ${local}: ${msg === "ON" ? "LIGADO" : "DESLIGADO"}`);
    }
    
    // DHT11 da Sala
    if (topic === "alefsilva/sala/temperatura") {
        dadosSala.temperatura = parseFloat(msg);
        dadosSala.ultimaAtualizacao = new Date().toISOString();
        console.log(`🌡️ Sala Temp: ${dadosSala.temperatura}°C`);
        
        // Só adiciona ao histórico se já tiver umidade (evita registro incompleto)
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

// ═══════════════════════════════════════════════════════════════
// ENDPOINTS DA API
// ═══════════════════════════════════════════════════════════════

// Saúde do servidor
app.get("/api/health", (req, res) => {
    res.json({ status: "ok", mqtt: client.connected });
});

// Dados atuais
app.get("/api/dados", (req, res) => {
    res.json({
        temperatura: ultimaTemperatura,
        dispositivos: statusDispositivos,
        sala: dadosSala,
        quarto: dadosQuarto,
        timestamp: new Date().toISOString()
    });
});

// Enviar comando
app.post("/api/comando", (req, res) => {
    const { dispositivo, acao } = req.body;
    const topic = `alefsilva/${dispositivo}/comando`;
    
    client.publish(topic, acao, (err) => {
        if (err) res.status(500).json({ erro: err.message });
        else res.json({ sucesso: true });
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
            // Cria um resumo com todos os dados
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
            res.write('\uFEFF' + cabecalho); // BOM para UTF-8
            res.write(linhas.join('\n'));
            return res.end();
    }
    
    // Converte para CSV
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
    res.write('\uFEFF' + cabecalho); // BOM para UTF-8
    res.write(linhas.join('\n'));
    res.end();
});

// Rota principal
app.get("/", (req, res) => {
    res.json({ 
        message: "IoT Backend Rodando!",
        endpoints: [
            "/api/health",
            "/api/dados",
            "/api/comando",
            "/api/historico/geral",
            "/api/historico/sala",
            "/api/historico/quarto",
            "/api/exportar/excel/:comodo"
        ]
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor na porta ${PORT}`);
});
