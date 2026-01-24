const grpc = require('@grpc/grpc-js');
const crypto = require('crypto');
const pool = require('./db');

// --- IN-MEMORY CACHE ---
const definitionCache = new Map();

/**
 * Carga inicial desde DB
 */
async function loadDefinitions() {
    console.log("⏳ Loading definitions from DB...");
    try {
        const res = await pool.query('SELECT name, type, interface, code FROM obex_dapl_functions');
        
        definitionCache.clear();
        res.rows.forEach(row => {
            // Guardamos Buffer para el código
            const codeBuf = row.code ? Buffer.from(row.code) : Buffer.from("");
            
            definitionCache.set(row.name, {
                name: row.name,
                type: row.type || 'function',
                interface: row.interface || '[]',
                code: codeBuf,
                hash: 'v1'
            });
        });
        console.log(`✅ Cache warmed up: ${definitionCache.size} definitions.`);
    } catch (err) {
        console.error("❌ Critical Error loading definitions:", err);
        throw err;
    }
}

/**
 * Lógica para obtener un solo comando
 */
const getCommandLogic = (call, callback, apiKeyBuffer) => {
    const metadata = call.metadata.getMap();
    const authVal = metadata['x-avap-auth'];

    if (!authVal || !crypto.timingSafeEqual(Buffer.from(authVal), apiKeyBuffer)) {
        return callback({
            code: grpc.status.UNAUTHENTICATED,
            details: 'Invalid Credentials'
        });
    }

    const name = call.request.name;
    const def = definitionCache.get(name);

    if (def) {
        callback(null, {
            name: def.name,
            type: def.type,
            interface_json: def.interface,
            code: def.code,
            hash: def.hash
        });
    } else {
        callback({
            code: grpc.status.NOT_FOUND,
            details: `Command '${name}' not found`
        });
    }
};

/**
 * Lógica para descargar todo (Sync)
 */
const syncCatalogLogic = (call, callback, apiKeyBuffer) => {
    const metadata = call.metadata.getMap();
    const authVal = metadata['x-avap-auth'];

    if (!authVal || !crypto.timingSafeEqual(Buffer.from(authVal), apiKeyBuffer)) {
        return callback({
            code: grpc.status.UNAUTHENTICATED,
            details: 'Invalid Credentials'
        });
    }

    const commandsList = [];
    for (const def of definitionCache.values()) {
        commandsList.push({
            name: def.name,
            type: def.type,
            interface_json: def.interface,
            code: def.code,
            hash: def.hash
        });
    }

    console.log(`⚡ SYNC: Sending ${commandsList.length} items.`);
    
    callback(null, {
        commands: commandsList,
        total_count: commandsList.length,
        version_hash: `v-${Date.now()}`
    });
};

module.exports = { 
    loadDefinitions, 
    getCommandLogic, 
    syncCatalogLogic 
};