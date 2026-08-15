import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const trackedPaths = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  },
)
  .split('\0')
  .filter((trackedPath) => trackedPath && existsSync(trackedPath));

const reservedDeviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const invalidCharacter = /[<>:"\\|?*\u0000-\u001f]/u;

const invalidPaths = trackedPaths.filter((trackedPath) =>
  trackedPath.split('/').some((component) =>
    invalidCharacter.test(component) ||
    /[ .]$/u.test(component) ||
    reservedDeviceName.test(component),
  ),
);

if (invalidPaths.length > 0) {
  console.error(
    `Windows-incompatible tracked paths (${invalidPaths.length}):\n` +
      `${invalidPaths.slice(0, 20).join('\n')}` +
      (invalidPaths.length > 20 ? '\n...' : ''),
  );
  process.exitCode = 1;
} else {
  console.log(
    `Windows path validation passed (${trackedPaths.length} tracked paths).`,
  );
}
