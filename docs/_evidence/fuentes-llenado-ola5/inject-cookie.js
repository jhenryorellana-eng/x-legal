async (page) => {
  const fs = require('fs');
  const p = 'C:/Users/mauri/Documents/Trabajos/usalatino-v2/docs/_evidence/fuentes-llenado-ola5/ivis-cookie.json';
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  await page.context().addCookies([{
    name: c.name,
    value: c.value,
    domain: 'x-legal.usalatinoprime.com',
    path: '/',
    httpOnly: false,
    sameSite: 'Lax',
    secure: true,
  }]);
  const cookies = await page.context().cookies('https://x-legal.usalatinoprime.com');
  return 'injected: ' + cookies.filter(k => k.name.includes('auth-token')).map(k => k.name + '(' + k.value.length + ')').join(',');
}
