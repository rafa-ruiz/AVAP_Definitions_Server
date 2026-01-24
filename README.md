# AVAP Core: Definition Engine

![Role](https://img.shields.io/badge/role-Single_Source_of_Truth-blue)
![Stack](https://img.shields.io/badge/stack-Node.js_Fastify-green)
![Performance](https://img.shields.io/badge/latency-sub_millisecond-orange)
![License](https://img.shields.io/badge/license-Proprietary-red)

The **AVAP Definition Engine** is the central intelligence unit of the AVAP ecosystem. It acts as the high-performance authoritative server responsible for managing, securing, and serving command logic (`obex_dapl_functions`) to distributed execution nodes.

Designed for **Enterprise Scale**, it decouples data persistence from execution, ensuring that no external runtime ever accesses the database directly.

---

## 🏗️ Architecture Role

This service implements the **"Brain"** pattern in our decoupled architecture. It is the sole guardian of the intellectual property stored in the database.

```mermaid
graph LR
    ExecNodes[External Language Servers\n(The Muscle)] -->|HTTP/2 Request| Core[Definition Engine\n(The Brain)];
    Core -->|L1 Cache Hit| ExecNodes;
    Core -->|Cache Miss| DB[(PostgreSQL)];
    DB --> Core;
```

### Key Responsibilities
1.  **Data Sovereignty**: Manages the `obex_dapl_functions` and `avap_bytecode` tables.
2.  **High-Speed Serving**: Uses Fastify and an in-memory LRU strategy to serve definitions instantly.
3.  **Access Control**: Validates which execution nodes are permitted to request logic.
4.  **Interface Enforcement**: Ensures all served definitions adhere to the strict JSON schema required by the parsers.

---

## 🚀 Performance Features

* **Zero-Overhead Routing**: Built on `fastify` for minimal request processing time.
* **Smart Caching**: Implements an active LRU (Least Recently Used) cache layer to absorb 99% of read traffic, protecting the database from high-concurrency spikes.
* **Connection Pooling**: Centralizes PostgreSQL connections, preventing pool exhaustion from multiple external clients.

---

## 🛠️ Getting Started

### Prerequisites
* **Node.js 22+**
* **PostgreSQL 15+** (or via Docker)

### Local Development

1.  **Clone & Install:**
    ```bash
    git clone [https://github.com/your-org/avap-definition-engine.git](https://github.com/your-org/avap-definition-engine.git)
    cd avap-definition-engine
    npm install
    ```

2.  **Start Services (DB + API):**
    ```bash
    docker-compose up -d
    ```

3.  **Verify Health:**
    ```bash
    curl http://localhost:5000/health
    # Response: {"status": "online", "uptime": 120, "db_connected": true}
    ```

---

## 🔐 Security Standards

This repository adheres to **Tier-1 Security Protocols**:
* **Isolation**: This service is the *only* entity with database credentials.
* **Read-Only Exposure**: The API exposes read-only endpoints for execution nodes, preventing accidental logic modification via the execution layer.
* **Input Sanitization**: All incoming parameters (e.g., command names) are validated against strict regex before querying the cache or DB.

For deep architectural details, see [ARCHITECTURE.md](./docs/ARCHITECTURE.md).

---

## 📄 License

Proprietary Software. Unauthorized access, distribution, or copying is strictly prohibited.