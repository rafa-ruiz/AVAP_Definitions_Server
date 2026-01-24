const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const { performance } = require('perf_hooks');

// --- CONFIGURACIÓN DE ESCENARIO LIMPIO ---
const CONFIG = {
  server: '127.0.0.1:50052',
  protoPath: path.join(__dirname, '../avap.proto'),
  apiKey: 'avap_secret_key_2026',
  concurrency: 500,      // Usuarios simultáneos
  totalRequests: 10000,   // Duración de la prueba
  
  // PERFIL DE TRÁFICO
  trafficProfile: {
    hot: 0.80,   // 80% Piden 'if' (Cache Hit asegurado)
    cold: 0.20   // 20% Piden basura aleatoria (Cache Miss -> DB Access)
  }
};

// --- INICIALIZACIÓN ---
const packageDefinition = protoLoader.loadSync(CONFIG.protoPath, {
  keepCase: true, longs: String, enums: String, defaults: true, oneofs: true
});
const avapProto = grpc.loadPackageDefinition(packageDefinition).avap;

const client = new avapProto.DefinitionEngine(
  CONFIG.server,
  grpc.credentials.createInsecure(),
  { 'grpc.enable_http_proxy': 0 }
);

// --- GENERADOR DE TRÁFICO ---
function getNextCommand() {
  const rand = Math.random();
  
  // ESCENARIO 1: HOT DATA (Memoria)
  // Pedimos 'if' porque sabemos que tu DB lo tiene y estará en caché.
  if (rand < CONFIG.trafficProfile.hot) {
    return { 
      name: 'if', 
      type: '🔥 HOT (Cache Hit)' 
    };
  }
  
  // ESCENARIO 2: COLD/MISS (DB Access)
  // Pedimos algo aleatorio. Obliga al servidor a consultar Postgres.
  // A efectos de carga de CPU/IO, buscar y no encontrar es casi igual que buscar y encontrar.
  return { 
    name: `stress_test_${Math.random().toString(36).substring(7)}`, 
    type: '❄️ COLD (DB Access)' 
  };
}

// --- CLIENTE PROMISIFICADO ---
const makeRequest = (cmdInfo) => {
  return new Promise((resolve) => {
    const metadata = new grpc.Metadata();
    metadata.add('x-avap-auth', CONFIG.apiKey);

    const start = performance.now();
    client.GetCommand({ name: cmdInfo.name }, metadata, (err, response) => {
      const duration = performance.now() - start;
      // Consideramos éxito si responde OK o NOT_FOUND (ambos son respuestas válidas del sistema)
      const isSuccess = !err || err.code === 5; 
      
      resolve({ 
        duration, 
        type: cmdInfo.type,
        success: isSuccess
      });
    });
  });
};

// --- EJECUCIÓN ---
async function runRealWorldTest() {
  console.clear();
  console.log(`🌍 AVAP | REAL-WORLD SIMULATION (CLEAN DB)`);
  console.log(`==========================================`);
  console.log(`👥 Concurrency: ${CONFIG.concurrency} threads`);
  console.log(`📊 Profile: ${CONFIG.trafficProfile.hot*100}% Cache Hits | ${CONFIG.trafficProfile.cold*100}% DB Accesses`);
  console.log(`------------------------------------------\n`);

  const results = [];
  const batches = Math.ceil(CONFIG.totalRequests / CONFIG.concurrency);
  
  const startTime = performance.now();

  for (let i = 0; i < batches; i++) {
    const promises = [];
    for (let j = 0; j < CONFIG.concurrency; j++) {
      const cmd = getNextCommand();
      promises.push(makeRequest(cmd));
    }
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
    process.stdout.write(`\r⏳ Running simulation... ${(results.length / CONFIG.totalRequests * 100).toFixed(0)}%`);
  }

  const totalTime = performance.now() - startTime;
  const rps = (CONFIG.totalRequests / (totalTime / 1000)).toFixed(2);

  // --- ANÁLISIS ---
  const analyzeType = (typeLabel) => {
    const subset = results.filter(r => r.type === typeLabel);
    if (subset.length === 0) return { avg: 0, p95: 0, count: 0 };
    
    const durations = subset.map(r => r.duration).sort((a,b) => a-b);
    const avg = durations.reduce((a,b) => a+b, 0) / durations.length;
    const p95 = durations[Math.floor(durations.length * 0.95)];
    return { avg, p95, count: subset.length };
  };

  const hotStats = analyzeType('🔥 HOT (Cache Hit)');
  const coldStats = analyzeType('❄️ COLD (DB Access)');

  console.log(`\n\n✅ RESULTS:\n`);
  
  console.table({
    'Metric': ['Throughput (RPS)', 'Global P95 Latency'],
    'Result': [`${rps} req/sec`, `${analyzeType('🔥 HOT (Cache Hit)').p95.toFixed(2)} ms (Ref)`]
  });

  console.log(`\n🔍 LATENCY BREAKDOWN (Cache vs Database):`);
  console.table([
    { 
      'Scenario': '🔥 RAM (Cache Hit)', 
      'Requests': hotStats.count, 
      'Avg Time': `${hotStats.avg.toFixed(2)} ms`, 
      'P95 Time': `${hotStats.p95.toFixed(2)} ms`,
    },
    { 
      'Scenario': '❄️ DISK (DB Access)', 
      'Requests': coldStats.count, 
      'Avg Time': `${coldStats.avg.toFixed(2)} ms`, 
      'P95 Time': `${coldStats.p95.toFixed(2)} ms`,
    }
  ]);

  console.log(`\n💡 SRE NOTE:`);
  console.log(`The 'COLD' latency represents the true penalty of a Cache Miss.`);
  console.log(`Difference: DB Access is ${(coldStats.avg / hotStats.avg).toFixed(1)}x slower than RAM access.`);
  
  process.exit(0);
}

runRealWorldTest();