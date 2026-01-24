// src/logic.js
const crypto = require('crypto');
const grpc = require('@grpc/grpc-js');

/**
 * Función Pura: Recibe petición, valida y decide.
 * @param {Object} call - El objeto de llamada gRPC (Mockeable)
 * @param {Function} callback - La función de respuesta (Mockeable)
 * @param {Map} catalog - La base de datos en RAM (Inyectable)
 * @param {Buffer} secretKeyBuffer - La llave maestra
 */
const getCommandLogic = (call, callback, catalog, secretKeyBuffer) => {
    // 1. Extraer Auth (Fast Path)
    // Simulamos la estructura interna de gRPC-js para los tests
    const metadata = call.metadata.internalRepr || call.metadata; 
    const authHeader = metadata.get('x-avap-auth');
    const token = authHeader ? (Array.isArray(authHeader) ? authHeader[0] : authHeader) : null;

    let valid = false;
    if (token) {
        const tokenBuf = Buffer.isBuffer(token) ? token : Buffer.from(token);
        if (tokenBuf.length === secretKeyBuffer.length) {
            valid = crypto.timingSafeEqual(tokenBuf, secretKeyBuffer);
        }
    }

    // 2. Security Check
    if (!valid) {
        return callback({ 
            code: grpc.status.UNAUTHENTICATED, 
            details: "Auth Failed" 
        });
    }

    // 3. Logic Lookup
    const name = call.request.name;
    const def = catalog.get(name);

    if (def) {
        return callback(null, def);
    }
    
    return callback({ 
        code: grpc.status.NOT_FOUND, 
        details: "Not Found" 
    });
};

module.exports = { getCommandLogic };