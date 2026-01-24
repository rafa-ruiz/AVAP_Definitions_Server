const { getCommandLogic } = require('../src/logic');
const grpc = require('@grpc/grpc-js');

describe('🧠 AVAP Logic Engine (Unit Tests)', () => {
    
    // Setup: Datos falsos para las pruebas
    const MOCK_KEY = Buffer.from('test_secret_key_123');
    let mockCatalog;
    let mockCallback;

    beforeEach(() => {
        // Reiniciamos el catálogo antes de cada test
        mockCatalog = new Map();
        mockCatalog.set('testCmd', { name: 'testCmd', code: 'print("hello")' });
        
        // Espía para ver qué responde la función
        mockCallback = jest.fn();
    });

    // --- 🛡️ SECURITY TESTS ---

    test('⛔ Debe bloquear acceso sin Token', () => {
        const mockCall = {
            request: { name: 'testCmd' },
            metadata: { get: () => null } // Sin header
        };

        getCommandLogic(mockCall, mockCallback, mockCatalog, MOCK_KEY);

        // Esperamos error UNAUTHENTICATED
        expect(mockCallback).toHaveBeenCalledWith(
            expect.objectContaining({ code: grpc.status.UNAUTHENTICATED })
        );
    });

    test('⛔ Debe bloquear acceso con Token Incorrecto', () => {
        const mockCall = {
            request: { name: 'testCmd' },
            metadata: { get: (key) => [Buffer.from('HACKER_KEY')] }
        };

        getCommandLogic(mockCall, mockCallback, mockCatalog, MOCK_KEY);

        expect(mockCallback).toHaveBeenCalledWith(
            expect.objectContaining({ code: grpc.status.UNAUTHENTICATED })
        );
    });

    test('✅ Debe permitir acceso con Token Correcto', () => {
        const mockCall = {
            request: { name: 'testCmd' },
            metadata: { get: (key) => [MOCK_KEY] } // Token idéntico
        };

        getCommandLogic(mockCall, mockCallback, mockCatalog, MOCK_KEY);

        // El primer argumento (error) debe ser null
        expect(mockCallback).toHaveBeenCalledWith(null, expect.anything());
    });

    // --- 🧠 LOGIC TESTS ---

    test('✅ Debe devolver el código si el comando existe', () => {
        const mockCall = {
            request: { name: 'testCmd' },
            metadata: { get: () => [MOCK_KEY] }
        };

        getCommandLogic(mockCall, mockCallback, mockCatalog, MOCK_KEY);

        // Verificamos que devuelve el objeto correcto
        expect(mockCallback).toHaveBeenCalledWith(null, { 
            name: 'testCmd', 
            code: 'print("hello")' 
        });
    });

    test('🔍 Debe devolver 404 si el comando NO existe', () => {
        const mockCall = {
            request: { name: 'comandoFantasma' },
            metadata: { get: () => [MOCK_KEY] }
        };

        getCommandLogic(mockCall, mockCallback, mockCatalog, MOCK_KEY);

        expect(mockCallback).toHaveBeenCalledWith(
            expect.objectContaining({ code: grpc.status.NOT_FOUND })
        );
    });
});