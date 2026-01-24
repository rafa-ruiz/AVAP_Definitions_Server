import sys
import os
import time
import grpc
import concurrent.futures

# --- CONFIGURATION ---
CONCURRENCY = 50           # Simultaneous threads (simulating 50 active scripts)
TOTAL_REQUESTS = 10000     # Total requests to launch
TARGET = 'localhost:50052' # Docker Port
AUTH_TOKEN = 'avap_secret_key_2026'

# --- PERFORMANCE BUDGET (CI/CD ALERT) ---
# If RPS drops below this threshold, the script will exit with error code 1.
# - Local Machine (M1/M2/i7): Expect > 10,000 RPS
# - CI Runner (GitHub/Azure): Expect > 2,000 RPS (Conservative limit)
PERFORMANCE_THRESHOLD_RPS = 2000 

# --- SETUP PATHS ---
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

try:
    from app.core import avap_pb2
    from app.core import avap_pb2_grpc
except ImportError:
    print("❌ Proto files not found. Run compilation step first.")
    sys.exit(1)

def worker_get_command(stub, metadata):
    """Worker function: Fetches a single command."""
    try:
        stub.GetCommand(avap_pb2.CommandRequest(name='if'), metadata=metadata)
        return True
    except grpc.RpcError:
        return False

def run_stress_test():
    print(f"🔥 STARTING PYTHON BENCHMARK")
    print(f"🎯 Target: {TARGET} | Concurrency: {CONCURRENCY} threads")
    print("=" * 60)

    # 1. Create Shared Channel
    # gRPC channels are thread-safe and expensive to create. We use one for all threads.
    channel = grpc.insecure_channel(target=TARGET)
    stub = avap_pb2_grpc.DefinitionEngineStub(channel)
    metadata = (('x-avap-auth', AUTH_TOKEN),)

    # --- TEST 1: HIGH FREQUENCY (GetCommand) ---
    print(f"\n🚀 TEST 1: High Frequency 'GetCommand' ({TOTAL_REQUESTS} reqs)...")
    
    start_time = time.time()
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        # Submit tasks to the pool
        futures = [executor.submit(worker_get_command, stub, metadata) for _ in range(TOTAL_REQUESTS)]
        # Wait for completion
        concurrent.futures.wait(futures)

    end_time = time.time()
    duration = end_time - start_time
    rps = TOTAL_REQUESTS / duration

    print(f"✅ Completed in {duration:.2f} seconds")
    print(f"📊 RPS (Requests Per Second): {rps:,.2f}")
    print(f"⏱️  Avg Latency per Req:      {(duration * 1000 / TOTAL_REQUESTS):.3f} ms")

    # --- TEST 2: HEAVY PAYLOAD (SyncCatalog) ---
    print(f"\n📦 TEST 2: Heavy Payload 'SyncCatalog' (100 full dumps)...")
    
    start_time = time.time()
    total_bytes = 0
    dumps = 100

    for _ in range(dumps):
        resp = stub.SyncCatalog(avap_pb2.Empty(), metadata=metadata)
        # Approximate size calculation
        total_bytes += sum(len(c.code) for c in resp.commands)

    end_time = time.time()
    duration = end_time - start_time
    
    mb_processed = (total_bytes / 1024 / 1024)
    speed = mb_processed / duration

    print(f"✅ Downloaded {mb_processed:.2f} MB in {duration:.2f} seconds")
    print(f"⚡ Transfer Speed: {speed:.2f} MB/s")
    print("=" * 60)

    channel.close()

    # --- 🔥 PERFORMANCE REGRESSION CHECK ---
    if rps < PERFORMANCE_THRESHOLD_RPS:
        print(f"\n❌ FAILED: Performance regression detected!")
        print(f"   Current: {rps:.2f} RPS")
        print(f"   Required: > {PERFORMANCE_THRESHOLD_RPS} RPS")
        print("   Action: Check for blocking code or serialization issues.")
        sys.exit(1) # Triggers CI Failure 🔴
    else:
        print(f"\n✨ SUCCESS: Performance is within budget (> {PERFORMANCE_THRESHOLD_RPS} RPS)")
        sys.exit(0) # Triggers CI Success 🟢

if __name__ == '__main__':
    run_stress_test()