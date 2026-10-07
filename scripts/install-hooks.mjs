// Points git at the checked-in hooks. Skips quietly outside a git checkout (for example when installed from npm).
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

if (existsSync('.git') && existsSync('.githooks')) {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
}
