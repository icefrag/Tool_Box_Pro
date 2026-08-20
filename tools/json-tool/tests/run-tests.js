// 纯函数模块测试入口：node tools/json-tool/tests/run-tests.js
import { readdirSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const files = readdirSync(dir).filter((f) => f.startsWith('test-') && f.endsWith('.js')).sort();

let failed = 0;
for (const f of files) {
  try {
    await import(new URL(f, dir).href);
    console.log(`PASS ${f}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${f}\n${e && e.stack || e}`);
  }
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
if (failed) process.exit(1);
