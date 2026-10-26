// Bouwt een uitgepakte, niet-ondertekende app in release/ voor de tests van de verpakte app (geen dmg/installer).
// Met PACK_LOCAL_ELECTRON=1 wordt de Electron uit node_modules gebruikt in plaats van er een te downloaden.
import { spawnSync } from 'node:child_process';

const args = ['electron-builder', '--dir', '--publish', 'never', '-c.mac.identity=null'];
if (process.env.PACK_LOCAL_ELECTRON) args.push('-c.electronDist=node_modules/electron/dist');

const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const result = spawnSync('npx', args, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
});
process.exit(result.status ?? 1);
