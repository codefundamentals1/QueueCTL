

import { cfgGet, cfgSet } from './db.js';


export function getConfig() {
return {
max_retries: cfgGet('max_retries', Number(process.env.MAX_RETRIES || 3)),
backoff_base: cfgGet('backoff_base', Number(process.env.BACKOFF_BASE || 2))
};
}



export function setConfig(key, value) {
const allowed = ['max_retries', 'backoff_base'];
if (!allowed.includes(key)) throw new Error(`Unknown config key: ${key}`);
const num = Number(value);
if (!Number.isFinite(num) || num < 0) throw new Error('Value must be a non-negative number');
cfgSet(key, num);
return getConfig();
}