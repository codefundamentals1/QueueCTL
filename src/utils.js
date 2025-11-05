// src/utils.js
import { customAlphabet } from 'nanoid';
export const nowMs = () => Date.now();
export const isoNow = () => new Date().toISOString();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);