// src/executor.js
import { exec } from 'node:child_process';


export function runCommand(command) {
return new Promise((resolve) => {
const child = exec(command, { shell: true }, (error, stdout, stderr) => {
const output = (stdout || '') + (stderr || '');
if (error) {
resolve({ ok: false, exitCode: error.code ?? 1, output });
} else {
resolve({ ok: true, exitCode: 0, output });
}
});
});
}