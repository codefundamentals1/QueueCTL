
🚀 QueueCTL — CLI-Based Background Job Queue System

    A robust, CLI-driven background job queue built in Node.js using SQLite for persistence. Supports multi-worker execution, automatic retries with exponential backoff, Dead Letter Queue (DLQ), and crash recovery with audit logging.

Tech Stack

    Language: Node.js (ESM)
    Database: SQLite (better-sqlite3)
    CLI Framework: Commander.js
    Environment Config: Dotenv
    Persistence: Local SQLite file (db/queue.db)
    Logging: JSON logs in /logs/

⚙️ Setup Instructions
1️⃣ Clone the Repository

git clone 
cd queuectl

2️⃣ Install Dependencies

npm install

3️⃣ Initialize Environment

Create a .env file from the example:

cp .env.example .env

Default values:

DB_PATH=./db/queue.db
BACKOFF_BASE=2
MAX_RETRIES=3

4️⃣ Run CLI

node src/cli.js --help

5️⃣ Example Commands

# Enqueue a job
node src/cli.js enqueue "echo 'Hello World'"

# Start 3 workers
node src/cli.js worker start --count 3

# Check status
node src/cli.js status

All commands

 get all the listed command

node src/cli.js

Command 	Description
enqueue <command> 	Add a new job
worker start --count <n> 	Start N worker processes
status 	Show summary of job states
list --state <s> 	List jobs by state
dlq list 	Show jobs in DLQ
dlq retry <id> 	Retry a DLQ job
config get 	View configuration
config set <key> <value> 	Update config values
inspect <id> 	Show full details of one job
stop-workers 	Stop all workers
recover 	kill all Zombie processs
🖥️ Usage Examples
✅ Enqueue Jobs

node src/cli.js enqueue '{"id":"job1","command":"bash -c \"echo Start && sleep 3 && echo Done\""}'

Start Multiple Workers

node src/cli.js worker start --count 4

Check System Status

node src/cli.js status

Example output:

{
  "pending": 0,
  "processing": 0,
  "completed": 8,
  "failed": 1,
  "dead": 1,
  "total": 10,
  "workers": 3
}

Dead Letter Queue

node src/cli.js dlq list
node src/cli.js dlq retry <job_id>

Config Management

node src/cli.js config get
node src/cli.js config set max-retries 5
node src/cli.js config set backoff-base 3

Kill All Workers

node src/cli.js stop-workers

🧠 Supervisor / Recovery

Start background recovery process:

npm run monitor

Architecture Overview
Core Components
Component 	Description
CLI (src/cli.js) 	Entry point for all user commands
Database (src/db.js) 	SQLite persistence with schema for jobs, config, and workers
Worker (src/worker.js) 	Executes queued jobs in parallel with heartbeat updates
Executor (src/executor.js) 	Runs shell commands and tracks exit codes
Supervisor (src/supervisor.js) 	Detects long-running or crashed jobs
Config (src/config.js) 	Global configuration management
Utils (src/utils.js) 	Helper utilities for timestamps, sleep, ID generation
🔄 Job Lifecycle
State 	Description
pending 	Waiting to be picked up by a worker
processing 	Being executed by a worker
completed 	Successfully executed
failed 	Failed, no more retries
dead 	Permanently failed (moved to DLQ)
Retry & Backoff Strategy

Each job retries automatically with exponential backoff:

delay = base ^ attempts

Example:

    base = 2, attempts = 3 → delay = 8s After exceeding max_retries, the job moves to the DLQ.

💿 Persistence

    Jobs, config, and worker heartbeats are stored in SQLite.
    Database is durable across restarts.
    WAL (Write-Ahead Logging) mode ensures concurrency safety.
    Worker heartbeats allow detection of dead workers.

⚔️ Fault Tolerance & Recovery
🧺h Automatic Recovery Logic

    Every 5s, monitor checks for:
        Jobs processing for > 60s
        Workers with no heartbeat for > 15s

    Jobs from stale workers are:
        Marked as failed
        Logged in logs/recovered_jobs_<timestamp>.json
        Workers removed from DB

🧹 Manual Recovery

You can manually run:

node src/cli.js recover

to clean up and zombie processes
🧠 Assumptions & Trade-offs
Decision 	Reason
SQLite over Redis 	Simple and self-contained, ideal for evaluation
Synchronous DB 	better-sqlite3 provides safe concurrency for local use
Job Timeout = 60s 	Prevents stuck processes
Manual Recovery 	Avoids risk of re-executing side-effectful jobs
JSON Logging 	Provides auditability and traceability
Supervisor Optional 	Optional process for reliability; leader-worker fallback included
Testing Instructions
1️⃣ Basic Flow

node src/cli.js enqueue "echo hello"
node src/cli.js worker start --count 1
node src/cli.js status

2️⃣ Retry & Backoff

node src/cli.js enqueue "bash -c 'exit 1'" --max-retries 3

3️⃣ Dead Letter Queue

node src/cli.js dlq list

4️⃣ Worker Crash Recovery

node src/cli.js worker start --count 1
# Kill process (Ctrl+C)
node src/cli.js recover-fail

5️⃣ Multi-Worker Parallel Test

node src/test.js

Automatically enqueues 50 jobs and starts 5 workers after 100 sec all worker stops automatically.
🦾 Logs & Monitoring

All recovery and failure events are logged in /logs:
🧱 Project Structure

queuectl/
├── src/
│   ├── cli.js              # CLI entrypoint
│   ├── worker.js           # Worker logic
│   ├── db.js               # SQLite persistence layer
│   ├── executor.js         # Command executor
│   ├── config.js           # Config management
│   ├── monitor.js       # Background recovery process
│   ├── utils.js            # Utility helpers
│   └── test.js             # Automated local test
├── db/
│   └── queue.db            # Auto-created SQLite database
├── logs/
│   └── recovered_jobs_*.json
├── .env.example
├── package.json
└── README.md

🧩 Author Notes

Built with ❤️ by Anish Raja Focused on reliability, concurrency safety, and clear code architecture for scalable background job processing.
