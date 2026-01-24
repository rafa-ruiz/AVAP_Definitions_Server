# 🏗️ AVAP Definition Engine | Architecture Reference (v4.0)

> **Version:** 0.0.1
> **Protocol:** gRPC / HTTP/2
> **Runtime:** Node.js Cluster (Zero-IO Workers)
> **Status:** Production Ready

## 1. Executive Summary

The AVAP Definition Engine is the high-performance **Single Source of Truth (SSOT)** for the platform's execution logic. Unlike traditional web services, this engine operates as a **Pure In-Memory Computing Cluster**.

It abstracts the persistence layer (PostgreSQL) from the execution layer (Python Interpreters), ensuring that database latency or locks never impact the runtime speed of the language. The system is engineered to serve Python logic definitions with **microsecond latency**.

---

## 2. Core Design Principles

This architecture deviates from standard REST patterns to achieve ultra-low latency (>35,000 RPS).

### A. The "Zero-I/O" Guarantee
Worker processes (the nodes handling client traffic) strictly follow a **Shared-Nothing, Zero-I/O architecture**.
* They **do not** connect to the database.
* They **do not** read from the disk.
* They serve 100% of requests from pre-allocated Heap Memory (RAM).

### B. Split-Plane Architecture
We separate the responsibilities into two distinct operational planes:
1.  **Control Plane (Master Process):** Handles infrastructure, database synchronization (`obex_dapl_functions`), IPC broadcasting, and process lifecycle management.
2.  **Data Plane (Worker Processes):** Pure computation units focused solely on gRPC serialization and request serving.

### C. Eager Consistency Model
Instead of "Lazy Loading" (fetch-on-demand), the engine uses **Eager Loading**. The entire logic catalog is pre-loaded at startup and kept synchronized via atomic updates. This eliminates "Cache Miss" penalties entirely.

---

## 3. Data Flow & Synchronization

The system uses an asynchronous **Master-Push** model.

```mermaid
sequenceDiagram
    participant DB as PostgreSQL (Legacy)
    participant M as Cluster Master
    participant W as Worker (CPU Core)
    participant C as Python Client

    Note over M, DB: 1. Hydration Phase (Control Plane)
    M->>DB: SELECT * FROM obex_dapl_functions
    DB-->>M: Return Dataset
    M->>M: Serialize & Optimize Payload
    M->>W: IPC Message (DATA_UPDATE)
    W->>W: Atomic RAM Swap (New Catalog)

    Note over W: Worker is now HEALTHY

    Note over C, W: 2. Execution Phase (Data Plane)
    C->>W: gRPC GetCommand(name="addVar")
    W->>W: O(1) HashMap Lookup
    W-->>C: Return Python Source Code
    
    Note over M, DB: 3. Background Sync (Every 60s)
    loop Refresh Cycle
        M->>DB: Poll for changes
        M->>W: Broadcast Updates
    end