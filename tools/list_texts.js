// Prints every German text that gets a pre-rendered voice clip, as JSON: [{role, text}]
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'content.js'), 'utf8'), ctx);
const C = ctx.window.CONTENT, out = new Map();
const add = (role, text) => out.set(role + '|' + text, { role, text });
add('officer', C.voiceTest[0]);
C.mc.forEach(q => add('officer', q.q[0]));
C.open.forEach(q => { add('officer', q.q[0]); add('answer', q.model[0]); });
const I = C.interview;
[...I.opening, ...I.personal, I.toFdgo, I.declaration, I.toMerk, ...I.closing].forEach(t => {
  add('officer', t.say[0]); add('answer', t.reply[0]);
});
C.principles.forEach(p => { add('officer', p.simple[0]); add('officer', p.official[0]); });
C.declaration.forEach(d => d.items.forEach(i => add('officer', i[0])));
C.leaflets.forEach(d => d.items.forEach(i => add('officer', i[0])));
C.phrases.forEach(g => g.items.forEach(i => add('answer', i[0])));
C.glossary.forEach(g => add('officer', g[0]));
console.log(JSON.stringify([...out.values()]));
