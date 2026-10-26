// kopieert de bestanden die tsc niet verwerkt naar dist/
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
cpSync('src/index.html', 'dist/index.html');
