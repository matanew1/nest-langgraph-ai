import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as os from 'os';

export const systemInfoTool = tool(
  async () => {
    const info = {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpus: os.cpus().length,
      memory: {
        total: `${Math.round(os.totalmem() / 1024 / 1024)} MB`,
        free: `${Math.round(os.freemem() / 1024 / 1024)} MB`,
      },
      uptime: `${Math.round(os.uptime() / 60)} minutes`,
    };

    return JSON.stringify(info, null, 2);
  },
  {
    name: 'system_info',
    description:
      'Get information about the current system environment, including OS, CPU, memory usage, and uptime.',
    schema: z.object({}),
  },
);
