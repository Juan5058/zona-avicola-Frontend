import { Buffer } from 'buffer';
(window as any).Buffer = Buffer;
(window as any).process = { env: {} };