const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { HealthImplementation } = require('grpc-health-check'); // STANDARD 1
const client = require('prom-client'); // STANDARD 2
const path = require('path');
const cluster = require('cluster');
const os = require('os');
const crypto = require('crypto');

const { getCommandLogic } = require('./logic');

// --- 0. CONFIGURATION & METRICS SETUP ---
const API_KEY = process.env.API_KEY || 'avap_secret_key_2026';
const PORT = process.env.PORT || '50051';
const REFRESH_INTERVAL_MS = 60 * 1000;
const API_KEY_BUFFER = Buffer.from(API_KEY);

// Prometheus Registry (Metrics)
const register = new client.Registry();
const gaugeCacheSize = new client.Gauge({ name: 'avap_cache_size', help: 'Number of definitions in RAM' });
const counterRequests = new client.Counter({ name: 'avap_requests_total', help: 'Total requests served', labelNames: ['status'] });
register.setDefaultLabels({ app: 'avap-engine' });

// JSON Logger (STANDARD 3)
const log = (level, msg, meta = {}) => {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    pid: process.pid,
    ...meta
  }));
};

// --- 1. CLUSTER MASTER ---
if (cluster.isPrimary) {
  const { Pool } = require('pg');
  const numCPUs = os.cpus().length;
  
  log('INFO', `🚀 MASTER initializing Cloud-Native Cluster with ${numCPUs} cores.`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  const broadcastData = async () => {
    try {
      const start = process.hrtime.bigint();
      const res = await pool.query('SELECT name, code FROM obex_dapl_functions WHERE code IS NOT NULL');
      
      const payload = res.rows.map(r => ({ n: r.name, c: r.code }));
      
      // Update Master Metric
      gaugeCacheSize.set(payload.length);

      const msg = { type: 'DATA_UPDATE', data: payload };
      for (const id in cluster.workers) {
        cluster.workers[id].send(msg);
      }
      
      const duration = Number(process.hrtime.bigint() - start) / 1e6;
      log('INFO', 'Definitions Broadcasted', { count: payload.length, duration_ms: duration });

    } catch (err) {
      log('ERROR', 'DB Fetch Failed', { error: err.message });
    }
  };

  (async () => {
    try {
        const client = await pool.connect();
        await client.query("SELECT 1");
        client.release();
    } catch (e) {
        log('FATAL', 'DB Connection Failed'); process.exit(1);
    }

    for (let i = 0; i < numCPUs; i++) cluster.fork();

    await broadcastData();
    setInterval(broadcastData, REFRESH_INTERVAL_MS);
  })();

  cluster.on('exit', (worker) => {
    log('WARN', 'Worker died. Respawning.', { dead_pid: worker.process.pid });
    cluster.fork();
    setTimeout(broadcastData, 2000);
  });

} else {
  // --- 2. WORKER LOGIC ---

  let catalog = new Map();
  // Health Check Status Map
  const statusMap = {
    "avap.DefinitionEngine": "NOT_SERVING", // Start as not ready
    "": "NOT_SERVING"
  };
  const healthImpl = new HealthImplementation(statusMap);

  // --- IPC DATA SYNC ---
  process.on('message', (msg) => {
    if (msg.type === 'DATA_UPDATE') {
      const newCatalog = new Map();
      for (let i = 0; i < msg.data.length; i++) {
        const item = msg.data[i];
        const codeBuf = Buffer.isBuffer(item.c) ? item.c : Buffer.from(item.c);
        newCatalog.set(item.n, {
            name: item.n,
            hash: 'v1',
            code: codeBuf
        });
      }
      catalog = newCatalog;
      
      // Mark as Healthy (SERVING) only after data is loaded
      statusMap["avap.DefinitionEngine"] = "SERVING";
      statusMap[""] = "SERVING";
      healthImpl.setStatus("avap.DefinitionEngine", "SERVING");
    }
  });

  // --- gRPC SERVER ---
  const PROTO_PATH = path.join(__dirname, '../avap.proto');
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true, longs: String, enums: String, defaults: true, oneofs: true
  });
  const avapProto = grpc.loadPackageDefinition(packageDefinition).avap;
  
  const getCommandImpl = (call, callback) => {
        return getCommandLogic(call, callback, catalog, API_KEY_BUFFER);
  };

  const server = new grpc.Server({
      'grpc.max_concurrent_streams': 1000,
  });

  // A. Add Main Service
  server.addService(avapProto.DefinitionEngine.service, {
    GetCommand: getCommandImpl
  });

  // B. Add Health Check Service (STANDARD 1)
  // This allows AWS/K8s to check health via gRPC
  healthImpl.addToServer(server);

  const bindAddr = `0.0.0.0:${PORT}`;
  server.bindAsync(bindAddr, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
        log('FATAL', 'Bind Failed', { error: err.message });
        return;
    }
    
    // Warmup
    const dummyCall = { 
        request: { name: 'warmup' }, 
        metadata: { internalRepr: new Map([['x-avap-auth', [API_KEY_BUFFER]]]) } 
    };
    const dummyCb = () => {};
    for(let i=0; i<5000; i++) getCommandImpl(dummyCall, dummyCb);
    
    if (global.gc) global.gc();

    // log('INFO', 'Worker Listening', { pid: process.pid });
  });
}