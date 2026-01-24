const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const { performance } = require('perf_hooks');

// --- CONFIGURACIÓN ---
const PORT = '50052'; // El puerto "bueno"
const HOST = '127.0.0.1';
const PROTO_PATH = path.join(__dirname, '../avap.proto');
const API_KEY = 'avap_secret_key_2026';
const TOTAL_REQUESTS = 100; // Número de peticiones para la prueba de carga

// --- CARGA DEL PROTO ---
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});
const avapProto = grpc.loadPackageDefinition(packageDefinition).avap;

// --- CLIENTE ---
const client = new avapProto.DefinitionEngine(
  `${HOST}:${PORT}`,
  grpc.credentials.createInsecure(),
  { 'grpc.enable_http_proxy': 0 }
);

// --- UTILIDAD: Promesa para hacer peticiones ---
function getCommandAsync(name) {
  return new Promise((resolve) => {
    const metadata = new grpc.Metadata();
    metadata.add('x-avap-auth', API_KEY);

    const start = performance.now();
    
    client.GetCommand({ name }, metadata, (err, response) => {
      const end = performance.now();
      const duration = parseFloat((end - start).toFixed(2));

      if (err) {
        // Si el error es "NOT_FOUND" lo consideramos "éxito técnico" (el servidor respondió bien)
        // Pero para estadísticas diferenciamos found vs not found
        resolve({ 
          success: false, 
          status: err.code, 
          details: err.details, 
          duration,
          name 
        });
      } else {
        resolve({ 
          success: true, 
          status: 0, // OK
          size: response.code.length, 
          duration,
          name
        });
      }
    });
  });
}

// --- MOTOR DE PRUEBAS ---
async function runTestSuite() {
  console.log(`\n🚀 INICIANDO TEST SUITE CONTRA ${HOST}:${PORT}`);
  console.log('==================================================');

  // 1. Warm-up (Calentamiento)
  console.log('🔥 Calentando motores (1 petición)...');
  await getCommandAsync('if');

  // 2. Prueba de Carga
  console.log(`⚡ Lanzando ráfaga de ${TOTAL_REQUESTS} peticiones mixtas...`);
  
  const promises = [];
  const commands = ['if', 'while', 'for', 'comando_fantasma', 'print', 'return'];

  for (let i = 0; i < TOTAL_REQUESTS; i++) {
    // Escoge un comando aleatorio
    const cmd = commands[Math.floor(Math.random() * commands.length)];
    promises.push(getCommandAsync(cmd));
  }

  // Esperar a todas
  const results = await Promise.all(promises);

  // 3. Procesar Resultados
  const stats = {
    total: results.length,
    ok: results.filter(r => r.success).length,
    errors: results.filter(r => !r.success && r.status !== 5).length, // 5 es NOT_FOUND (esperado)
    notFound: results.filter(r => r.status === 5).length,
    minTime: Math.min(...results.map(r => r.duration)),
    maxTime: Math.max(...results.map(r => r.duration)),
    avgTime: results.reduce((acc, r) => acc + r.duration, 0) / results.length
  };

  console.log('\n📊 ESTADÍSTICAS DE RENDIMIENTO');
  console.table({
    'Total Peticiones': stats.total,
    '✅ Éxitos (Encontrados)': stats.ok,
    '👻 No Encontrados (OK)': stats.notFound,
    '❌ Errores Reales': stats.errors,
    '⏱️ Latencia Media': `${stats.avgTime.toFixed(2)} ms`,
    '🚀 Latencia Mínima': `${stats.minTime} ms`,
    '🐢 Latencia Máxima': `${stats.maxTime} ms`
  });

  if (stats.errors > 0) {
    console.log('⚠️  ALERTA: Hubo errores inesperados (distintos a Not Found). Revisa los logs del servidor.');
  } else {
    console.log('🏆  RESULTADO: El sistema es estable y responde correctamente.');
  }

  // Cerrar conexión
  setTimeout(() => process.exit(0), 500);
}

// --- EJECUCIÓN ---
client.waitForReady(Date.now() + 5000, (err) => {
  if (err) {
    console.error('❌ No se pudo conectar al servidor:', err);
    process.exit(1);
  }
  runTestSuite();
});