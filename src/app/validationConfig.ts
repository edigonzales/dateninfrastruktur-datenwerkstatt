import {z} from 'zod';
// Zod's optional JIT probes Function(), which violates the document CSP even
// when its exception is caught. Parsing stays strict without code generation.
z.config({jitless: true});
