import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = [];
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
p.on('pageerror', (e) => errs.push(String(e)));
// Fail loudly if anything tries to reach a server.
p.on('request', (r) => { if (r.url().includes('/api/')) errs.push('NETWORK CALL: ' + r.url()); });

await p.goto('http://localhost:5175/demo-test.html');
await p.waitForTimeout(2500);
await p.screenshot({ path: 'demo-signin.png' });
console.log('sign-in shown:', await p.getByLabel(/username/i).count());

await p.getByLabel(/username/i).fill('mreyes');
await p.getByLabel(/password/i).fill('cedar-falls-2026');
await p.getByRole('button', { name: 'Sign in', exact: true }).click();
await p.waitForTimeout(2000);
await p.screenshot({ path: 'demo-dash.png' });
console.log('demo bar:', await p.getByText(/Demonstration/).count());
console.log('reports listed:', await p.getByRole('button', { name: /2026-000/ }).count());
console.log('errors:', errs.slice(0, 6));
await b.close();
