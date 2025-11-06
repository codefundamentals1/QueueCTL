// src/test.js
import { execSync, spawn } from 'child_process';

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

async function main() {
  console.log('🏁 Enqueuing 20 test jobs...');
  for (let i = 1; i <= 50; i++) {
    if(i%2 == 0)
    run(`node src/cli.js enqueue "echo job-${i} && sleep 1"`);
  else if(i%5 == 0) // job with error , to eventually to be in dead state
        run(`node src/cli.js enqueue " job-${i}  sledkfep 1"`);

  else     
      run(`node src/cli.js enqueue "bash -c 'echo job-${i}' && sleep 2"`);

  }

  console.log('🚀 Starting 3 workers for 10s...');
  const worker = spawn('node', ['src/cli.js', 'worker-start', '--count', '5'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 100000));
  worker.kill('SIGINT');

  console.log('📊 Final status:');
  run('node src/cli.js status');
}

main();
