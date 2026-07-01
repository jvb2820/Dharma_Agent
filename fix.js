import fs from 'fs';
let c = fs.readFileSync('server/index.js', 'utf8');

c = c.replace(/return 'Zepbound'/g, "return 'Weight Loss Injections'");
c = c.replace(/return 'Weight Loss'/g, "return 'Weight Loss Injections'");
c = c.replace(/return 'Nutrition'/g, "return 'Nutrition Consultation'");

if (!c.includes('Other peptides')) {
  c = c.replace(
    /if \(\/\\b\(zep\|zepbound\)\\b\/\.test\(searchable\)\) \{/,
    "if (/\\b(peptide|peptides|peptidos|péptidos)\\b/.test(searchable)) {\\n    return 'Other peptides'\\n  }\\n\\n  if (/\\b(zep|zepbound)\\b/.test(searchable)) {"
  );
}

fs.writeFileSync('server/index.js', c);
console.log('Fixed index.js');
