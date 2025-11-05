// src/config.js
// This module provides persistent configuration management using SQLite.
// It allows setting global parameters like max_retries and backoff_base
// via CLI commands and ensures these persist across restarts.


import { cfgGet, cfgSet } from './db.js';


/**
* Fetch current configuration.
* Priority: database > environment variables > defaults.
*/
export function getConfig() {
return {
max_retries: cfgGet('max_retries', Number(process.env.MAX_RETRIES || 3)),
backoff_base: cfgGet('backoff_base', Number(process.env.BACKOFF_BASE || 2))
};
}


/**
* Set a configuration key to a numeric value.
* Supported keys: max_retries, backoff_base
*/
export function setConfig(key, value) {
const allowed = ['max_retries', 'backoff_base'];
if (!allowed.includes(key)) throw new Error(`Unknown config key: ${key}`);
const num = Number(value);
if (!Number.isFinite(num) || num < 0) throw new Error('Value must be a non-negative number');
cfgSet(key, num);
return getConfig();
}